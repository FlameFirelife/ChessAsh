use crate::uci::hidden_command;
use chessash_review_core::{
    Label, ReviewFacts, TrainingDecision, TrainingFocus, TrainingPolicyFact,
};
use serde::{Deserialize, Serialize};
use serde_json::{from_reader, json, to_writer};
use std::{
    fs::File,
    io,
    path::PathBuf,
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tempfile::Builder;
use thiserror::Error;

const REVIEW_RULES: &str = include_str!("../../../../rules/review.foxash");
const TRAINING_RULES: &str = include_str!("../../../../rules/training.foxash");

#[derive(Debug, Error)]
pub enum FoxashError {
    #[error("Analysis cancelled.")]
    Cancelled,
    #[error("Could not run the Foxash policy: {0}")]
    Process(#[from] io::Error),
    #[error("Foxash returned invalid policy data: {0}")]
    Data(#[from] serde_json::Error),
    #[error("Foxash did not complete the policy evaluation.")]
    Failed,
    #[error("Foxash policy inputs or outputs are outside the supported range.")]
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachingPack {
    pub name: String,
    pub version: u32,
    pub excellent: f64,
    pub inaccuracy: f64,
    pub mistake: f64,
    pub blunder: f64,
}

impl Default for CoachingPack {
    fn default() -> Self {
        Self {
            name: "ChessAsh standard".to_owned(),
            version: 1,
            excellent: 15.0,
            inaccuracy: 45.0,
            mistake: 100.0,
            blunder: 250.0,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct PolicyDecision {
    pub label: Label,
    pub key: bool,
    pub template: String,
    pub hint: String,
}

#[derive(Clone)]
pub struct Foxash {
    executable: PathBuf,
    scratch_root: PathBuf,
}

impl Foxash {
    pub fn new(executable: impl Into<PathBuf>, scratch_root: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            scratch_root: scratch_root.into(),
        }
    }

    pub fn classify(
        &self,
        facts: &[ReviewFacts],
        pack: &CoachingPack,
        cancel: Option<&AtomicBool>,
    ) -> Result<Vec<PolicyDecision>, FoxashError> {
        let thresholds = [pack.excellent, pack.inaccuracy, pack.mistake, pack.blunder];
        if facts.len() > 2_000
            || thresholds
                .iter()
                .any(|value| !(0.0..=2_000.0).contains(value))
            || thresholds.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(FoxashError::Invalid);
        }
        if facts.is_empty() {
            return Ok(Vec::new());
        }
        let mut pack = pack.clone();
        pack.name = if pack.name.is_empty() {
            "Custom pack".to_owned()
        } else {
            pack.name.chars().take(80).collect()
        };
        pack.version = 1;
        let mut moves = facts.to_vec();
        for fact in &mut moves {
            fact.loss = fact.loss.clamp(0, 100_000);
        }
        let request = json!({ "count": moves.len(), "moves": moves, "rules": pack });
        let output: (Vec<(Label, bool, String, String)>, [u32; 10]) =
            self.run(REVIEW_RULES, "facts.json", &request, "review.json", cancel)?;
        if output.0.len() != facts.len()
            || output.1.iter().map(|count| *count as u64).sum::<u64>() != facts.len() as u64
        {
            return Err(FoxashError::Invalid);
        }
        Ok(output
            .0
            .into_iter()
            .map(|(label, key, template, hint)| PolicyDecision {
                label,
                key,
                template,
                hint,
            })
            .collect())
    }

    pub fn training_decisions(
        &self,
        facts: &[TrainingPolicyFact],
    ) -> Result<Vec<TrainingDecision>, FoxashError> {
        if facts.len() > 20_000
            || facts.iter().any(|fact| {
                !(0..=1_000_000).contains(&fact.loss)
                    || fact.attempts > 1_000_000
                    || fact.streak > fact.solved
                    || fact.solved > fact.attempts
            })
        {
            return Err(FoxashError::Invalid);
        }
        if facts.is_empty() {
            return Ok(Vec::new());
        }
        let request = json!({ "count": facts.len(), "facts": facts });
        let rows: Vec<(TrainingFocus, f64, u64)> = self.run(
            TRAINING_RULES,
            "training-facts.json",
            &request,
            "training-policy.json",
            None,
        )?;
        if rows.len() != facts.len()
            || rows.iter().any(|(_, priority, seconds)| {
                !(0.0..=5_000_000.0).contains(priority) || !(1..=31_536_000).contains(seconds)
            })
        {
            return Err(FoxashError::Invalid);
        }
        Ok(rows
            .into_iter()
            .map(|(focus, priority, interval_seconds)| TrainingDecision {
                focus,
                priority,
                interval_seconds,
            })
            .collect())
    }

    fn run<T: for<'de> Deserialize<'de>>(
        &self,
        script: &str,
        input: &str,
        request: &serde_json::Value,
        output: &str,
        cancel: Option<&AtomicBool>,
    ) -> Result<T, FoxashError> {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(FoxashError::Cancelled);
        }
        let executable = self.executable.canonicalize()?;
        std::fs::create_dir_all(&self.scratch_root)?;
        let folder = Builder::new()
            .prefix("chessash-foxash-")
            .tempdir_in(&self.scratch_root)?;
        to_writer(File::create(folder.path().join(input))?, request)?;
        std::fs::write(folder.path().join("policy.foxash"), script)?;
        let mut child = hidden_command(&executable)
            .args(["run", "policy.foxash"])
            .current_dir(folder.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(_)) => return Err(FoxashError::Failed),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.into());
                }
                Ok(None) => {}
            }
            let cancelled = cancel.is_some_and(|flag| flag.load(Ordering::Relaxed));
            if cancelled || Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if cancelled {
                    FoxashError::Cancelled
                } else {
                    FoxashError::Failed
                });
            }
            thread::sleep(Duration::from_millis(10));
        }
        let file = File::open(folder.path().join(output))?;
        if file.metadata()?.len() > 8 * 1024 * 1024 {
            return Err(FoxashError::Invalid);
        }
        Ok(from_reader(io::BufReader::new(file))?)
    }
}
