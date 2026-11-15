use chessash_review_core::{EngineLine, EngineResult, parse_fen};
use shakmaty::{CastlingMode, Color, EnPassantMode, Position, fen::Fen, uci::UciMove};
use std::{
    collections::{BTreeMap, VecDeque},
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

pub const ENGINE_VERSION: &str = "Stockfish 19.0.1 Lite (native, single thread)";
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(30);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(30);

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Analysis cancelled.")]
    Cancelled,
    #[error("Stockfish could not run: {0}")]
    Process(#[from] io::Error),
    #[error("Stockfish did not respond. Try restarting the app or lowering the review depth.")]
    Timeout,
    #[error("Stockfish returned no usable evaluation.")]
    NoEvaluation,
    #[error("Invalid engine position: {0}")]
    InvalidPosition(String),
}

#[derive(Clone, Copy)]
pub struct SearchOptions<'a> {
    pub depth: usize,
    pub multi_pv: usize,
    pub moves: &'a [String],
    pub cancel: Option<&'a AtomicBool>,
}

impl Default for SearchOptions<'_> {
    fn default() -> Self {
        Self {
            depth: 12,
            multi_pv: 2,
            moves: &[],
            cancel: None,
        }
    }
}

#[derive(PartialEq, Eq)]
struct CacheKey {
    fen: String,
    depth: usize,
    multi_pv: usize,
    moves: Vec<String>,
}

pub struct UciEngine {
    executable: PathBuf,
    process: Option<UciProcess>,
    cache: VecDeque<(CacheKey, EngineResult)>,
}

impl UciEngine {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            process: None,
            cache: VecDeque::new(),
        }
    }

    pub fn reset(&mut self) {
        self.process.take();
        self.cache.clear();
    }

    pub fn analyze(
        &mut self,
        fen: &str,
        options: SearchOptions<'_>,
    ) -> Result<EngineResult, EngineError> {
        check_cancelled(options.cancel)?;
        let position =
            parse_fen(fen).map_err(|error| EngineError::InvalidPosition(error.to_string()))?;
        let depth = options.depth.clamp(4, 22);
        if position.is_game_over() || position.halfmoves() >= 100 {
            let mate = position.is_checkmate();
            return Ok(EngineResult {
                fen: fen.to_owned(),
                depth,
                score: if mate {
                    -30_000 * white_sign(position.turn())
                } else {
                    0
                },
                mate: mate.then_some(0),
                best: String::new(),
                pv: Vec::new(),
                lines: Vec::new(),
            });
        }
        let multi_pv = options.multi_pv.clamp(1, 3);
        let moves: Vec<String> = options
            .moves
            .iter()
            .filter_map(|uci| {
                let candidate = uci.parse::<UciMove>().ok()?;
                let legal = candidate.to_move(&position).ok()?;
                Some(UciMove::from_move(legal, CastlingMode::Standard).to_string())
            })
            .collect();
        if !options.moves.is_empty() && moves.is_empty() {
            return Err(EngineError::InvalidPosition(
                "None of the requested moves are legal.".to_owned(),
            ));
        }
        let key = CacheKey {
            fen: fen.to_owned(),
            depth,
            multi_pv,
            moves,
        };
        if let Some((_, result)) = self.cache.iter().find(|(stored, _)| *stored == key) {
            return Ok(result.clone());
        }

        if self.process.is_none() {
            let optimized = optimized_stockfish(&self.executable);
            self.process = Some(match optimized {
                Some(path) => match UciProcess::start(&path, options.cancel) {
                    Ok(process) => process,
                    Err(EngineError::Cancelled) => return Err(EngineError::Cancelled),
                    Err(_) => UciProcess::start(&self.executable, options.cancel)?,
                },
                None => UciProcess::start(&self.executable, options.cancel)?,
            });
        }
        let canonical_fen = Fen::from_position(&position, EnPassantMode::Legal).to_string();
        let process = self.process.as_mut().expect("Stockfish initialized");
        let result = process.search(&key, &canonical_fen, position.turn(), options.cancel);
        match result {
            Ok(result) => {
                if self.cache.len() >= 1_000 {
                    self.cache.pop_front();
                }
                self.cache.push_back((key, result.clone()));
                Ok(result)
            }
            Err(error) => {
                self.process.take();
                Err(error)
            }
        }
    }
}

fn optimized_stockfish(baseline: &Path) -> Option<PathBuf> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    let variant = (baseline.file_name()?.to_str()? == "stockfish.exe"
        && std::is_x86_feature_detected!("avx2"))
    .then_some("stockfish-avx2.exe");
    #[cfg(all(target_os = "android", target_arch = "aarch64"))]
    let variant = (baseline.file_name()?.to_str()? == "libstockfish.so"
        && std::arch::is_aarch64_feature_detected!("dotprod"))
    .then_some("libstockfish_dotprod.so");
    #[cfg(all(target_os = "android", target_arch = "x86_64"))]
    let variant = (baseline.file_name()?.to_str()? == "libstockfish.so"
        && std::is_x86_feature_detected!("avx2"))
    .then_some("libstockfish_avx2.so");
    #[cfg(not(any(
        all(windows, target_arch = "x86_64"),
        all(
            target_os = "android",
            any(target_arch = "x86_64", target_arch = "aarch64")
        )
    )))]
    let variant: Option<&str> = None;
    let path = baseline.with_file_name(variant?);
    path.is_file().then_some(path)
}

struct UciProcess {
    child: Child,
    input: ChildStdin,
    lines: mpsc::Receiver<io::Result<String>>,
}

impl UciProcess {
    fn start(executable: &Path, cancel: Option<&AtomicBool>) -> Result<Self, EngineError> {
        let mut child = hidden_command(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let input = child.stdin.take().expect("Stockfish stdin was piped");
        let stdout = child.stdout.take().expect("Stockfish stdout was piped");
        let (tx, lines) = mpsc::sync_channel(128);
        let mut process = Self {
            child,
            input,
            lines,
        };
        thread::Builder::new()
            .name("chessash-uci-output".to_owned())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let broken = line.is_err();
                    if tx.send(line).is_err() || broken {
                        break;
                    }
                }
            })?;
        process.send("uci")?;
        process.wait_for("uciok", cancel)?;
        process.send("setoption name Hash value 32")?;
        process.send("setoption name Threads value 1")?;
        process.send("isready")?;
        process.wait_for("readyok", cancel)?;
        Ok(process)
    }

    fn send(&mut self, command: &str) -> io::Result<()> {
        writeln!(self.input, "{command}")?;
        self.input.flush()
    }

    fn read(&self, deadline: Instant, cancel: Option<&AtomicBool>) -> Result<String, EngineError> {
        loop {
            check_cancelled(cancel)?;
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(EngineError::Timeout)?;
            match self.lines.recv_timeout(remaining.min(POLL_INTERVAL)) {
                Ok(line) => return Ok(line?),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "Stockfish closed its output",
                    )
                    .into());
                }
            }
        }
    }

    fn wait_for(&self, token: &str, cancel: Option<&AtomicBool>) -> Result<(), EngineError> {
        let deadline = Instant::now() + CONNECTION_TIMEOUT;
        while self.read(deadline, cancel)?.trim() != token {}
        Ok(())
    }

    fn search(
        &mut self,
        key: &CacheKey,
        fen: &str,
        turn: Color,
        cancel: Option<&AtomicBool>,
    ) -> Result<EngineResult, EngineError> {
        self.send(&format!("setoption name MultiPV value {}", key.multi_pv))?;
        self.send(&format!("position fen {fen}"))?;
        let mut command = format!("go depth {}", key.depth);
        if !key.moves.is_empty() {
            command.push_str(" searchmoves ");
            command.push_str(&key.moves.join(" "));
        }
        self.send(&command)?;
        let deadline = Instant::now() + SEARCH_TIMEOUT;
        let mut lines: BTreeMap<usize, EngineLine> = BTreeMap::new();
        let best = loop {
            let line = self.read(deadline, cancel)?;
            if let Some(best) = line
                .strip_prefix("bestmove ")
                .and_then(|tail| tail.split_whitespace().next())
            {
                break best.to_owned();
            }
            if let Some(info) = parse_info(&line, turn) {
                if lines
                    .get(&info.rank)
                    .is_none_or(|stored| info.depth >= stored.depth)
                {
                    lines.insert(info.rank, info);
                }
            }
        };
        let principal = lines.get(&1).ok_or(EngineError::NoEvaluation)?;
        let pv = if principal.pv.first() == Some(&best) {
            principal.pv.clone()
        } else {
            vec![best.clone()]
        };
        Ok(EngineResult {
            fen: key.fen.clone(),
            depth: principal.depth,
            score: principal.score,
            mate: principal.mate,
            best,
            pv,
            lines: lines.into_values().collect(),
        })
    }
}

impl Drop for UciProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) fn hidden_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = &mut command;
    command
}

pub(crate) fn check_cancelled(cancel: Option<&AtomicBool>) -> Result<(), EngineError> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err(EngineError::Cancelled);
    }
    Ok(())
}

pub(crate) fn white_sign(turn: Color) -> i32 {
    if turn == Color::White { 1 } else { -1 }
}

pub fn parse_info(line: &str, turn: Color) -> Option<EngineLine> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.first() != Some(&"info")
        || fields.contains(&"upperbound")
        || fields.contains(&"lowerbound")
    {
        return None;
    }
    let find = |key: &str| fields.iter().position(|field| *field == key);
    let depth: usize = fields.get(find("depth")? + 1)?.parse().ok()?;
    let index = find("score")?;
    let value: i32 = fields.get(index + 2)?.parse().ok()?;
    let sign = white_sign(turn);
    let (score, mate) = match *fields.get(index + 1)? {
        "cp" => (value * sign, None),
        "mate" => {
            let winner = if value >= 0 { 1 } else { -1 };
            let score = (30_000 - 100 * value.saturating_abs().min(100)) * winner * sign;
            (score, Some(value * sign))
        }
        _ => return None,
    };
    let pv: Vec<String> = fields
        .get(find("pv")? + 1..)?
        .iter()
        .map(|field| (*field).to_owned())
        .collect();
    if depth == 0 || pv.is_empty() {
        return None;
    }
    let rank = find("multipv")
        .and_then(|i| fields.get(i + 1)?.parse().ok())
        .unwrap_or(1);
    Some(EngineLine {
        rank,
        depth,
        score,
        mate,
        pv,
    })
}
