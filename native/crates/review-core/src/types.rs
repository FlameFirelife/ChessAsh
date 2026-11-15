use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub pgn: String,
    pub headers: BTreeMap<String, String>,
    pub moves: Vec<String>,
    pub positions: Vec<String>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uci_moves: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub comments: BTreeMap<usize, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_as: Option<Perspective>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<Review>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<BTreeMap<usize, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ply: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_usernames: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Color {
    #[serde(rename = "w")]
    White,
    #[serde(rename = "b")]
    Black,
}

impl Color {
    pub fn sign(self) -> i32 {
        match self {
            Self::White => 1,
            Self::Black => -1,
        }
    }
}

impl From<shakmaty::Color> for Color {
    fn from(color: shakmaty::Color) -> Self {
        match color {
            shakmaty::Color::White => Self::White,
            shakmaty::Color::Black => Self::Black,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Perspective {
    #[serde(rename = "w")]
    White,
    #[serde(rename = "b")]
    Black,
    #[serde(rename = "neutral")]
    Neutral,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Label {
    Book,
    Best,
    Excellent,
    Good,
    Inaccuracy,
    Mistake,
    Blunder,
    Miss,
    Great,
    Sacrifice,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReview {
    pub ply: usize,
    pub r#move: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub san: Option<String>,
    pub color: Color,
    pub before: i32,
    pub after: i32,
    pub loss: i32,
    pub label: Label,
    pub best: String,
    pub pv: Vec<String>,
    pub depth: usize,
    pub explanation: String,
    pub hints: Vec<String>,
    pub key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facts: Option<ReviewFacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence_of: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_pv: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sacrifice_evidence: Option<SacrificeEvidence>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub version: u32,
    pub engine: String,
    pub depth: usize,
    pub results: Vec<MoveReview>,
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct EngineLine {
    pub rank: usize,
    pub depth: usize,
    pub score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate: Option<i32>,
    pub pv: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct EngineResult {
    pub fen: String,
    pub depth: usize,
    pub score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate: Option<i32>,
    pub best: String,
    pub pv: Vec<String>,
    pub lines: Vec<EngineLine>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFacts {
    pub loss: i32,
    pub played_best: bool,
    pub book: bool,
    pub missed_chance: bool,
    pub critical: bool,
    pub sacrifice: bool,
    pub verified: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SacrificeOutcome {
    Stalemate,
    Draw,
    Compensation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SacrificeEvidence {
    pub capture: String,
    pub square: String,
    pub investment: i32,
    pub outcome: SacrificeOutcome,
    pub score: i32,
}
