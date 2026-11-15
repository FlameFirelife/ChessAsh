use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    TRAINING_FOCUSES, TrainingCard, TrainingFocus, TrainingHistory, TrainingReply, play_uci,
    training_reply_line,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SessionOutcome {
    pub attempts: u32,
    pub solved: bool,
    pub assisted: bool,
    pub due: u64,
}

pub type SessionOutcomes = BTreeMap<String, SessionOutcome>;

#[derive(Clone, Debug, PartialEq)]
pub struct TrainingSummary {
    pub total: usize,
    pub solved: usize,
    pub independent: usize,
    pub retried: usize,
    pub assisted: usize,
    pub retry: Vec<TrainingCard>,
    pub next_due: u64,
}

pub fn summarize_training(
    session: &[TrainingCard],
    outcomes: &SessionOutcomes,
    history: &TrainingHistory,
) -> TrainingSummary {
    let completed: Vec<_> = session
        .iter()
        .filter_map(|card| outcomes.get(&card.id).map(|outcome| (card, outcome)))
        .collect();
    TrainingSummary {
        total: session.len(),
        solved: completed.iter().filter(|(_, r)| r.solved).count(),
        independent: completed
            .iter()
            .filter(|(_, r)| r.solved && !r.assisted && r.attempts == 1)
            .count(),
        retried: completed
            .iter()
            .filter(|(_, r)| r.solved && !r.assisted && r.attempts > 1)
            .count(),
        assisted: completed.iter().filter(|(_, r)| r.assisted).count(),
        retry: completed
            .iter()
            .filter(|(_, r)| !r.solved || r.assisted || r.attempts > 1)
            .map(|(card, _)| (*card).clone())
            .collect(),
        next_due: completed
            .iter()
            .map(|(card, r)| {
                history
                    .get(&card.id)
                    .map(|record| record.due)
                    .filter(|&due| due > 0)
                    .unwrap_or(r.due)
            })
            .min()
            .unwrap_or(0),
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticeEvent {
    pub session: String,
    pub card: String,
    pub pattern: TrainingFocus,
    pub at: u64,
    pub independent: bool,
    pub assisted: bool,
    pub attempts: u32,
}

pub fn parse_practice_events(json: &str) -> Vec<PracticeEvent> {
    let entries = serde_json::from_str::<Vec<Value>>(json).unwrap_or_default();
    let mut events: Vec<PracticeEvent> = entries
        .into_iter()
        .filter_map(|event| serde_json::from_value(event).ok())
        .collect();
    events.retain(|event| event.attempts > 0 && !(event.independent && event.assisted));
    events.drain(..events.len().saturating_sub(2000));
    events
}

pub fn merge_practice_events(
    previous: &[PracticeEvent],
    session: &str,
    cards: &[TrainingCard],
    outcomes: &SessionOutcomes,
    now: u64,
) -> Vec<PracticeEvent> {
    let replaced: HashSet<_> = cards
        .iter()
        .filter(|card| outcomes.contains_key(&card.id))
        .map(|card| &card.id)
        .collect();
    let mut events: Vec<_> = previous
        .iter()
        .filter(|event| event.session != session || !replaced.contains(&event.card))
        .cloned()
        .collect();
    events.extend(cards.iter().filter_map(|card| {
        let outcome = outcomes.get(&card.id)?;
        Some(PracticeEvent {
            session: session.to_owned(),
            card: card.id.clone(),
            pattern: card.pattern,
            at: now,
            independent: outcome.solved && !outcome.assisted,
            assisted: outcome.assisted,
            attempts: outcome.attempts,
        })
    }));
    events.drain(..events.len().saturating_sub(2000));
    events
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PracticeTrend {
    pub pattern: TrainingFocus,
    pub recent: usize,
    pub recent_total: usize,
    pub earlier: usize,
    pub earlier_total: usize,
    pub sessions: usize,
    pub delta: Option<i32>,
}

pub fn practice_trends(events: &[PracticeEvent]) -> Vec<PracticeTrend> {
    TRAINING_FOCUSES
        .into_iter()
        .filter_map(|pattern| {
            let mut rows: Vec<_> = events
                .iter()
                .filter(|event| event.pattern == pattern)
                .collect();
            if rows.is_empty() {
                return None;
            }
            rows.sort_by_key(|event| event.at);
            let recent_start = rows.len().saturating_sub(5);
            let earlier_start = rows.len().saturating_sub(10);
            let recent = &rows[recent_start..];
            let earlier = &rows[earlier_start..recent_start];
            let sessions = |events: &[&PracticeEvent]| {
                events
                    .iter()
                    .map(|event| &event.session)
                    .collect::<HashSet<_>>()
                    .len()
            };
            let score =
                |events: &[&PracticeEvent]| events.iter().filter(|event| event.independent).count();
            let comparable = earlier.len() == 5 && sessions(&rows[earlier_start..]) >= 2;
            Some(PracticeTrend {
                pattern,
                recent: score(recent),
                recent_total: recent.len(),
                earlier: score(earlier),
                earlier_total: earlier.len(),
                sessions: sessions(&rows),
                delta: comparable.then(|| (score(recent) as i32 - score(earlier) as i32) * 20),
            })
        })
        .collect()
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PracticeState {
    Checking,
    Correct,
    Missed,
    Revealed,
    Error,
    #[default]
    #[serde(other)]
    Ready,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResumedTraining {
    pub session: Vec<TrainingCard>,
    pub id: String,
    pub index: usize,
    pub state: PracticeState,
    pub fen: String,
    pub r#move: String,
    pub attempt: String,
    pub reply: Vec<TrainingReply>,
    pub reply_index: Option<usize>,
    pub outcomes: SessionOutcomes,
}

#[derive(Deserialize, Serialize)]
struct SavedCard {
    id: String,
    pattern: TrainingFocus,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTraining {
    version: u32,
    id: String,
    cards: Vec<SavedCard>,
    index: usize,
    #[serde(default)]
    state: PracticeState,
    #[serde(default)]
    attempt: String,
    #[serde(default)]
    reply: Vec<String>,
    #[serde(default)]
    reply_index: isize,
    #[serde(default)]
    outcomes: BTreeMap<String, Value>,
}

pub fn restore_training(
    json: &str,
    cards: &[TrainingCard],
    language: &str,
) -> Option<ResumedTraining> {
    let saved: SavedTraining = serde_json::from_str(json).ok()?;
    if saved.version != 1
        || !(1..=5).contains(&saved.cards.len())
        || saved.index >= saved.cards.len()
        || saved
            .cards
            .iter()
            .map(|card| &card.id)
            .collect::<HashSet<_>>()
            .len()
            != saved.cards.len()
    {
        return None;
    }
    let session: Vec<_> = saved
        .cards
        .into_iter()
        .map(|entry| {
            let mut card = cards.iter().find(|card| card.id == entry.id)?.clone();
            card.pattern = entry.pattern;
            Some(card)
        })
        .collect::<Option<_>>()?;
    let outcomes: SessionOutcomes = session
        .iter()
        .filter_map(|card| {
            let outcome: SessionOutcome =
                serde_json::from_value(saved.outcomes.get(&card.id)?.clone()).ok()?;
            (outcome.attempts > 0 && outcome.attempts <= 1_000_000)
                .then(|| (card.id.clone(), outcome))
        })
        .collect();
    let card = &session[saved.index];
    let state = match saved.state {
        PracticeState::Correct | PracticeState::Missed | PracticeState::Revealed
            if outcomes.contains_key(&card.id) =>
        {
            saved.state
        }
        _ => PracticeState::Ready,
    };
    let mut restored = ResumedTraining {
        id: saved.id,
        index: saved.index,
        state,
        fen: card.fen.clone(),
        outcomes,
        ..ResumedTraining::default()
    };
    match state {
        PracticeState::Revealed => {
            restored.attempt = saved.attempt;
            restored.fen = play_uci(&card.fen, &card.result.best)?.fen;
            restored.r#move = card.result.best.clone();
        }
        PracticeState::Correct | PracticeState::Missed => {
            restored.fen = play_uci(&card.fen, &saved.attempt)?.fen;
            restored.r#move.clone_from(&saved.attempt);
            restored.attempt = saved.attempt;
            if state == PracticeState::Missed {
                restored.reply =
                    training_reply_line(&restored.fen, &saved.reply, language, card.result.color);
                if let Ok(index) = usize::try_from(saved.reply_index)
                    && let Some(reply) = restored.reply.get(index)
                {
                    restored.reply_index = Some(index);
                    restored.fen.clone_from(&reply.fen);
                    restored.r#move.clone_from(&reply.r#move);
                }
            }
        }
        _ => {}
    }
    restored.session = session;
    Some(restored)
}

pub fn serialize_training(data: &ResumedTraining) -> Option<String> {
    if data.index >= data.session.len() {
        return None;
    }
    let saved = SavedTraining {
        version: 1,
        id: data.id.clone(),
        cards: data
            .session
            .iter()
            .map(|card| SavedCard {
                id: card.id.clone(),
                pattern: card.pattern,
            })
            .collect(),
        index: data.index,
        state: data.state,
        attempt: data.attempt.clone(),
        reply: data.reply.iter().map(|step| step.r#move.clone()).collect(),
        reply_index: data.reply_index.map(|index| index as isize).unwrap_or(-1),
        outcomes: data
            .outcomes
            .iter()
            .filter_map(|(id, outcome)| Some((id.clone(), serde_json::to_value(outcome).ok()?)))
            .collect(),
    };
    serde_json::to_string(&saved).ok()
}
