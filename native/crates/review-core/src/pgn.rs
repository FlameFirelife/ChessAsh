use std::collections::BTreeMap;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use shakmaty::{
    CastlingMode, Chess, EnPassantMode, Move, Position, fen::Fen, san::SanPlus, uci::UciMove,
};
use thiserror::Error;

use crate::{Game, MoveReview, QualityNames};

pub const INITIAL_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ROSTER: [(&str, &str); 7] = [
    ("Event", "?"),
    ("Site", "?"),
    ("Date", "????.??.??"),
    ("Round", "?"),
    ("White", "?"),
    ("Black", "?"),
    ("Result", "*"),
];

static TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^\[\s*([a-zA-Z][a-zA-Z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]"#).unwrap()
});
static TAG_ESCAPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\\(["\\])"#).unwrap());
static MOVE_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d*\.(?:\s*\.)*").unwrap());
static UCI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-h][1-8][a-h][1-8][qrbn]?$").unwrap());
static LONG_MOVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([KQRBNPkqrbnp])?([a-h][1-8])[-x]?([a-h][1-8])=?([QRBNqrbn])?$").unwrap()
});
static GAME_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https://(?:www\.)?(?:chess\.com|lichess\.org)/").unwrap());
static LICHESS_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^https://(?:www\.)?lichess\.org/(?:game/)?([a-z0-9]{8})(?:[a-z0-9]{4})?(?:/(?:white|black))?(?:[?#].*)?$").unwrap()
});
static COMMENT_NEWLINES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\r\n]+").unwrap());

#[derive(Debug, Error)]
pub enum PgnError {
    #[error("Choose a non-empty PGN smaller than 2 MB.")]
    InvalidSize,
    #[error("The {0} variant is not supported. Import a standard chess game.")]
    UnsupportedVariant(String),
    #[error("This PGN has no moves to review.")]
    NoMoves,
    #[error("Invalid FEN: {0}")]
    Fen(String),
    #[error("Invalid PGN: {0}")]
    Invalid(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayedMove {
    pub fen: String,
    pub san: String,
}

pub fn parse_fen(fen: &str) -> Result<Chess, PgnError> {
    let fen: Fen = fen
        .parse()
        .map_err(|error: shakmaty::fen::ParseFenError| PgnError::Fen(error.to_string()))?;
    fen.into_position(CastlingMode::Standard)
        .map_err(|error: shakmaty::PositionError<Chess>| PgnError::Fen(error.to_string()))
}

pub(crate) fn position_fen(board: &Chess) -> String {
    Fen::from_position(board, EnPassantMode::Legal).to_string()
}

pub fn parse_pgn(pgn: &str, source: &str) -> Result<Game, PgnError> {
    let pgn = validate_size(pgn)?;
    let (game, rest) = read_game(pgn, source)?;
    if rest.is_empty() {
        Ok(game)
    } else {
        Err(PgnError::Invalid("expected a single game".into()))
    }
}

pub fn parse_pgn_collection(pgn: &str, source: &str) -> Result<Vec<Game>, PgnError> {
    let mut rest = pgn.trim_start_matches('\u{feff}').trim();
    let mut games = Vec::new();
    while !rest.is_empty() {
        let (game, remaining) = read_game(rest, source)?;
        validate_size(&rest[..rest.len() - remaining.len()])?;
        games.push(game);
        rest = remaining;
    }
    Ok(games)
}

fn validate_size(pgn: &str) -> Result<&str, PgnError> {
    let pgn = pgn.trim_start_matches('\u{feff}').trim();
    if pgn.is_empty() || pgn.encode_utf16().take(2_000_001).count() > 2_000_000 {
        return Err(PgnError::InvalidSize);
    }
    Ok(pgn)
}

fn read_game<'a>(pgn: &'a str, source: &str) -> Result<(Game, &'a str), PgnError> {
    let mut game = Game {
        headers: ROSTER
            .map(|(tag, value)| (tag.to_owned(), value.to_owned()))
            .into(),
        source: source.to_owned(),
        imported_at: Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        ),
        ..Game::default()
    };

    let mut rest = pgn;
    let mut initial_fen = None;
    while rest.starts_with('[') {
        let tags = TAG
            .captures(rest)
            .ok_or_else(|| PgnError::Invalid("malformed tag".into()))?;
        let name = &tags[1];
        let value = TAG_ESCAPE.replace_all(&tags[2], "$1").into_owned();
        if name.eq_ignore_ascii_case("FEN") {
            initial_fen = Some(value.clone());
        }
        if name.eq_ignore_ascii_case("Variant")
            && !matches!(
                value.to_ascii_lowercase().as_str(),
                "standard" | "chess" | "normal"
            )
        {
            return Err(PgnError::UnsupportedVariant(value));
        }
        game.headers.insert(name.to_owned(), value);
        rest = rest[tags.get(0).unwrap().end()..].trim_start();
    }

    let initial_fen = initial_fen.as_deref().unwrap_or(INITIAL_FEN);
    let mut position = parse_fen(initial_fen)?;
    if initial_fen != INITIAL_FEN {
        game.headers.insert("SetUp".into(), "1".into());
        game.headers.insert("FEN".into(), initial_fen.to_owned());
    } else if game.headers.contains_key("FEN") {
        game.headers.remove("FEN");
        game.headers.remove("SetUp");
    }
    game.positions.push(initial_fen.to_owned());

    let mut finished = false;
    let mut depth = 0usize;
    while !rest.is_empty() {
        if let Some(open) = rest.strip_prefix('{') {
            let (comment, close) = open
                .split_once('}')
                .ok_or_else(|| PgnError::Invalid("unterminated comment".into()))?;
            if depth == 0 {
                game.comments.insert(
                    game.moves.len(),
                    COMMENT_NEWLINES.replace_all(comment, " ").into_owned(),
                );
            }
            rest = close.trim_start();
            continue;
        }
        if let Some(line) = rest.strip_prefix([';', '%']) {
            let end = line.find(['\r', '\n']).unwrap_or(line.len());
            if depth == 0 && rest.starts_with(';') {
                game.comments
                    .insert(game.moves.len(), line[..end].trim().to_owned());
            }
            rest = line[end..].trim_start();
            continue;
        }
        if depth == 0 && (finished || rest.starts_with('[')) {
            break;
        }
        if let Some(open) = rest.strip_prefix('(') {
            depth += 1;
            rest = open.trim_start();
            continue;
        }
        if let Some(close) = rest.strip_prefix(')') {
            depth = depth
                .checked_sub(1)
                .ok_or_else(|| PgnError::Invalid("unmatched variation".into()))?;
            rest = close.trim_start();
            continue;
        }
        if depth == 0
            && let Some(number) = MOVE_NUMBER.find(rest)
        {
            rest = rest[number.end()..].trim_start();
            continue;
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || "(){};[".contains(c))
            .unwrap_or(rest.len());
        if end == 0 {
            return Err(PgnError::Invalid("unexpected punctuation".into()));
        }
        let token = &rest[..end];
        rest = rest[end..].trim_start();
        if depth > 0 {
            continue;
        }
        if matches!(token, "1-0" | "0-1" | "1/2-1/2" | "*") {
            game.headers.insert("Result".into(), token.to_owned());
            finished = true;
            continue;
        }
        let san = token
            .split_once('$')
            .map_or(token, |(san, _)| san)
            .trim_end_matches(['!', '?']);
        if san.is_empty() && token.starts_with('$') {
            continue;
        }
        let played = legal_san(&position, san)
            .ok_or_else(|| PgnError::Invalid(format!("illegal or malformed move {token}")))?;
        game.uci_moves
            .push(UciMove::from_move(played, CastlingMode::Standard).to_string());
        game.moves
            .push(SanPlus::from_move_and_play_unchecked(&mut position, played).to_string());
        game.positions.push(position_fen(&position));
    }

    if depth != 0 {
        return Err(PgnError::Invalid("unterminated variation".into()));
    }
    if game.moves.is_empty() {
        return Err(PgnError::NoMoves);
    }
    game.url = game
        .headers
        .get("Link")
        .filter(|url| !url.is_empty())
        .or_else(|| game.headers.get("Site"))
        .filter(|url| GAME_URL.is_match(url))
        .cloned();
    game.id = match game.url.as_deref().and_then(lichess_game_id) {
        Some(id) => format!("lichess:{id}"),
        None => stable_id(&game),
    };
    game.pgn = render_pgn(&game, &game.comments, 0);
    Ok((game, rest))
}

pub fn lichess_game_id(url: &str) -> Option<&str> {
    Some(LICHESS_URL.captures(url.trim())?.get(1)?.as_str())
}

fn stable_id(game: &Game) -> String {
    let header = |name| game.headers.get(name);
    let key = serde_json::json!([
        header("White"),
        header("Black"),
        header("Date"),
        header("UTCDate"),
        header("UTCTime"),
        header("Link"),
        game.uci_moves,
        game.positions.first()
    ])
    .to_string();
    let mut first = 2_166_136_261u32;
    let mut second = 5_381u32;
    for code_unit in key.encode_utf16().map(u32::from) {
        first = (first ^ code_unit).wrapping_mul(16_777_619);
        second = second.wrapping_mul(33) ^ code_unit;
    }
    format!("game-{first:08x}{second:08x}")
}

fn legal_san(position: &Chess, san: &str) -> Option<Move> {
    let san = san.trim_end_matches(['+', '#']);
    let castle = match san {
        "0-0" => "O-O",
        "0-0-0" => "O-O-O",
        _ => san,
    };
    if let Ok(parsed) = castle.parse::<SanPlus>()
        && let Ok(played) = parsed.san.to_move(position)
    {
        return Some(played);
    }
    let notation = LONG_MOVE.captures(san)?;
    let promotion = notation
        .get(4)
        .map_or("", |piece| piece.as_str())
        .to_ascii_lowercase();
    let uci: UciMove = format!("{}{}{promotion}", &notation[2], &notation[3])
        .parse()
        .ok()?;
    let played = uci.to_move(position).ok()?;
    let piece_matches = notation.get(1).is_none_or(|role| {
        role.as_str().as_bytes()[0].eq_ignore_ascii_case(&(played.role().upper_char() as u8))
    });
    piece_matches.then_some(played)
}

pub fn play_uci(fen: &str, uci: &str) -> Option<PlayedMove> {
    let mut position = parse_fen(fen).ok()?;
    let san = apply_uci(&mut position, uci)?;
    Some(PlayedMove {
        san,
        fen: position_fen(&position),
    })
}

pub fn variation_san(fen: &str, moves: &[String]) -> Vec<String> {
    let Ok(mut position) = parse_fen(fen) else {
        return Vec::new();
    };
    moves
        .iter()
        .map_while(|uci| apply_uci(&mut position, uci))
        .collect()
}

fn apply_uci(position: &mut Chess, uci: &str) -> Option<String> {
    let played = legal_uci(position, uci)?;
    Some(SanPlus::from_move_and_play_unchecked(position, played).to_string())
}

pub fn legal_uci(position: &Chess, uci: &str) -> Option<Move> {
    if !UCI.is_match(uci) {
        return None;
    }
    let wire = uci.parse::<UciMove>().ok()?;
    let played = wire.to_move(position).ok()?;
    (UciMove::from_move(played, CastlingMode::Standard) == wire).then_some(played)
}

impl Game {
    pub fn hydrate(&mut self) -> Result<(), PgnError> {
        if !self.uci_moves.is_empty() {
            return Ok(());
        }
        let replay = parse_pgn(&self.pgn, &self.source)?;
        if self.moves != replay.moves || self.positions != replay.positions {
            return Err(PgnError::Invalid(
                "saved positions differ from the PGN replay".into(),
            ));
        }
        self.uci_moves = replay.uci_moves;
        self.comments = replay.comments;
        Ok(())
    }
}

pub fn export_pgn(game: &Game, names: QualityNames) -> String {
    export_pgn_with_review_text(game, names, |result| result.explanation.clone())
}

pub fn export_pgn_with_review_text(
    game: &Game,
    names: QualityNames,
    review_text: impl Fn(&MoveReview) -> String,
) -> String {
    let mut comments = game.comments.clone();
    if let Some(notes) = &game.notes
        && let Some(note) = notes.get(&0).filter(|note| !note.is_empty())
    {
        comments.insert(0, note.clone());
    }
    for ply in 1..=game.moves.len() {
        let mut remarks = Vec::new();
        if let Some(result) = game
            .review
            .as_ref()
            .and_then(|review| review.results.iter().find(|item| item.ply == ply))
        {
            let mut remark = format!("ChessAsh: {}.", result.label.name(names));
            let text = review_text(result);
            if !text.is_empty() {
                remark.push(' ');
                remark.push_str(&text);
            }
            remark.push_str(&format!(" [%eval {:.2}]", f64::from(result.after) / 100.0));
            remarks.push(remark);
        }
        if let Some(note) = game
            .notes
            .as_ref()
            .and_then(|notes| notes.get(&ply))
            .filter(|note| !note.is_empty())
        {
            remarks.push(note.clone());
        }
        if !remarks.is_empty() {
            comments.insert(ply, remarks.join(" "));
        }
    }
    render_pgn(game, &comments, 88)
}

fn render_pgn(game: &Game, comments: &BTreeMap<usize, String>, width: usize) -> String {
    let mut output = String::new();
    let roster = ROSTER
        .iter()
        .filter_map(|(tag, _)| game.headers.get(*tag).map(|value| (*tag, value)));
    let extras = game
        .headers
        .iter()
        .filter(|(tag, _)| !ROSTER.iter().any(|(name, _)| name == tag))
        .map(|(tag, value)| (tag.as_str(), value));
    for (tag, value) in roster.chain(extras) {
        if !value.is_empty() {
            let value = value.replace('\\', "\\\\").replace('"', "\\\"");
            output.push_str(&format!("[{tag} \"{value}\"]\n"));
        }
    }
    output.push('\n');

    let mut tokens = Vec::new();
    let initial = game
        .positions
        .first()
        .and_then(|fen| parse_fen(fen).ok())
        .unwrap_or_default();
    let mut move_number = initial.fullmoves().get();
    let mut white = initial.turn().is_white();
    for (index, san) in game.moves.iter().enumerate() {
        if let Some(comment) = comments.get(&index) {
            tokens.push(format!(
                "{{{}}}",
                comment.replace('{', "[").replace('}', "]")
            ));
        }
        if white {
            tokens.push(format!("{move_number}."));
        } else if index == 0 {
            tokens.push(format!("{move_number}. ..."));
        }
        tokens.push(san.clone());
        if !white {
            move_number += 1;
        }
        white = !white;
    }
    if let Some(comment) = comments.get(&game.moves.len()) {
        tokens.push(format!(
            "{{{}}}",
            comment.replace('{', "[").replace('}', "]")
        ));
    }
    tokens.push(
        game.headers
            .get("Result")
            .filter(|result| !result.is_empty())
            .map_or("*", String::as_str)
            .to_owned(),
    );
    let mut line_width = 0;
    for token in tokens {
        let token_width = token.encode_utf16().count();
        if line_width > 0 && width > 0 && line_width + 1 + token_width > width {
            output.push('\n');
            line_width = 0;
        }
        if line_width > 0 {
            output.push(' ');
            line_width += 1;
        }
        output.push_str(&token);
        line_width += token_width;
    }
    output
}
