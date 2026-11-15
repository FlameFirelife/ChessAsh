use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use shakmaty::{Chess, Move, Position, Rank, Role, Square};

use crate::pgn::{legal_uci, position_fen};
use crate::{Color, EngineResult, Game, Label, MoveReview, Perspective, parse_fen};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrainingFocus {
    Capture,
    Check,
    Reply,
    #[default]
    Improve,
    Undefended,
    Fork,
    Backrank,
}

pub const TRAINING_FOCUSES: [TrainingFocus; 7] = [
    TrainingFocus::Capture,
    TrainingFocus::Check,
    TrainingFocus::Reply,
    TrainingFocus::Improve,
    TrainingFocus::Undefended,
    TrainingFocus::Fork,
    TrainingFocus::Backrank,
];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingEvidence {
    pub best_capture: bool,
    pub best_check: bool,
    pub reply_danger: bool,
    #[serde(default)]
    pub undefended: bool,
    #[serde(default)]
    pub fork: bool,
    #[serde(default)]
    pub backrank: bool,
}

impl TrainingEvidence {
    fn focus(self) -> TrainingFocus {
        if self.backrank {
            TrainingFocus::Backrank
        } else if self.fork {
            TrainingFocus::Fork
        } else if self.undefended {
            TrainingFocus::Undefended
        } else if self.reply_danger {
            TrainingFocus::Reply
        } else if self.best_capture {
            TrainingFocus::Capture
        } else if self.best_check {
            TrainingFocus::Check
        } else {
            TrainingFocus::Improve
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingPolicyFact {
    #[serde(flatten)]
    pub evidence: TrainingEvidence,
    pub loss: i32,
    pub attempts: u32,
    pub solved: u32,
    pub streak: u32,
    pub passed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingDecision {
    pub focus: TrainingFocus,
    pub priority: f64,
    pub interval_seconds: u64,
}

pub fn default_training_decisions(facts: &[TrainingPolicyFact]) -> Vec<TrainingDecision> {
    let mut counts = BTreeMap::new();
    for fact in facts {
        *counts.entry(fact.evidence.focus()).or_insert(0) += 1;
    }
    facts
        .iter()
        .map(|fact| {
            let focus = fact.evidence.focus();
            let previous = if fact.attempts == 0 {
                3
            } else {
                fact.attempts.saturating_sub(fact.solved) * 4
            };
            TrainingDecision {
                focus,
                priority: f64::from(previous + counts[&focus])
                    + f64::from(fact.loss.min(600)) / 100.0,
                interval_seconds: training_interval(fact.passed, fact.streak),
            }
        })
        .collect()
}

fn training_interval(passed: bool, streak: u32) -> u64 {
    if passed {
        [86_400, 259_200, 604_800, 1_209_600, 2_592_000][streak.min(4) as usize]
    } else {
        600
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrainingCard {
    pub id: String,
    pub game_id: String,
    pub result: MoveReview,
    pub fen: String,
    pub pattern: TrainingFocus,
    pub evidence: TrainingEvidence,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrainingRecord {
    pub attempts: u32,
    pub solved: u32,
    pub streak: u32,
    pub due: u64,
    pub last: u64,
}

pub type TrainingHistory = BTreeMap<String, TrainingRecord>;

pub fn parse_training_history(json: &str) -> TrainingHistory {
    serde_json::from_str::<BTreeMap<String, serde_json::Value>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, value)| {
            let entry: TrainingRecord = serde_json::from_value(value).ok()?;
            (entry.attempts <= 1_000_000
                && entry.solved <= entry.attempts
                && entry.streak <= entry.solved)
                .then_some((id, entry))
        })
        .collect()
}

pub fn player_color_for(game: &Game, username: &str) -> Option<Color> {
    match game.review_as {
        Some(Perspective::White) => return Some(Color::White),
        Some(Perspective::Black) => return Some(Color::Black),
        Some(Perspective::Neutral) => return None,
        None => {}
    }
    let identity = username.trim().to_lowercase();
    let lichess_identity = identity.strip_prefix("lichess:");
    let name = lichess_identity.unwrap_or(&identity);
    let url = game
        .url
        .as_ref()
        .or_else(|| game.headers.get("Site"))
        .map(|url| url.to_ascii_lowercase())
        .unwrap_or_default();
    let lichess = game.source == "Lichess"
        || url.starts_with("https://lichess.org/")
        || url.starts_with("https://www.lichess.org/");
    if (lichess && lichess_identity.is_none())
        || (game.source == "Chess.com" && lichess_identity.is_some())
        || name.is_empty()
    {
        return None;
    }
    let is_player = |color| {
        game.headers
            .get(color)
            .is_some_and(|header| header.trim().to_lowercase() == name)
    };
    match (is_player("White"), is_player("Black")) {
        (true, false) => Some(Color::White),
        (false, true) => Some(Color::Black),
        _ => None,
    }
}

pub fn training_cards(games: &[Game], username: &str) -> Vec<TrainingCard> {
    let mut cards = Vec::new();
    let mut positions = HashSet::new();
    for game in games {
        let Some(side) = player_color_for(game, username) else {
            continue;
        };
        let Some(review) = game.review.as_ref().filter(|review| review.completed) else {
            continue;
        };
        if game.source.to_ascii_lowercase().contains("sample") {
            continue;
        }
        for result in &review.results {
            if result.color != side
                || !matches!(
                    result.label,
                    Label::Inaccuracy | Label::Mistake | Label::Blunder | Label::Miss
                )
                || result.best == result.r#move
                || result.depth < 8
                || result.before * side.sign() <= -29_000
            {
                continue;
            }
            let Some(fen) = result
                .ply
                .checked_sub(1)
                .and_then(|index| game.positions.get(index))
            else {
                continue;
            };
            let Ok(board) = parse_fen(fen) else { continue };
            if Color::from(board.turn()) != side || board.legal_moves().len() < 2 {
                continue;
            }
            let reply = result.reply_pv.as_deref().and_then(|moves| moves.first());
            let Some(evidence) = evidence_for_board(
                board,
                &result.r#move,
                &result.best,
                reply.map(String::as_str),
            ) else {
                continue;
            };
            if positions.insert(fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")) {
                cards.push(TrainingCard {
                    id: format!("{}:{}:{}", game.id, result.ply, result.best),
                    game_id: game.id.clone(),
                    result: result.clone(),
                    fen: fen.clone(),
                    pattern: evidence.focus(),
                    evidence,
                });
            }
        }
    }
    cards
}

pub fn training_fact(
    card: &TrainingCard,
    previous: Option<&TrainingRecord>,
    passed: bool,
) -> TrainingPolicyFact {
    let previous = previous.copied().unwrap_or_default();
    TrainingPolicyFact {
        evidence: card.evidence,
        loss: card.result.loss.max(0),
        attempts: previous.attempts,
        solved: previous.solved,
        streak: previous.streak,
        passed,
    }
}

pub fn training_queue(
    cards: &[TrainingCard],
    history: &TrainingHistory,
    now: u64,
    priorities: Option<&BTreeMap<String, f64>>,
) -> Vec<TrainingCard> {
    let defaults;
    let scores = match priorities {
        Some(priorities) => priorities,
        None => {
            let facts: Vec<_> = cards
                .iter()
                .map(|card| training_fact(card, history.get(&card.id), false))
                .collect();
            defaults = cards
                .iter()
                .zip(default_training_decisions(&facts))
                .map(|(card, decision)| (card.id.clone(), decision.priority))
                .collect();
            &defaults
        }
    };
    let mut due: Vec<_> = cards
        .iter()
        .filter(|card| history.get(&card.id).is_none_or(|record| record.due <= now))
        .collect();
    due.sort_by(|a, b| {
        scores
            .get(&b.id)
            .zip(scores.get(&a.id))
            .and_then(|(b, a)| b.partial_cmp(a))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    due.into_iter().cloned().collect()
}

pub fn record_training(
    previous: Option<&TrainingRecord>,
    solved: bool,
    now: u64,
    interval_seconds: Option<u64>,
) -> TrainingRecord {
    let previous = previous.copied().unwrap_or_default();
    let seconds = interval_seconds.unwrap_or_else(|| training_interval(solved, previous.streak));
    TrainingRecord {
        attempts: previous.attempts + 1,
        solved: previous.solved + u32::from(solved),
        streak: if solved { previous.streak + 1 } else { 0 },
        due: now.saturating_add(seconds.saturating_mul(1000)),
        last: now,
    }
}

pub fn acceptable_training_move(before: &EngineResult, after: &EngineResult, side: Color) -> bool {
    let direction = side.sign();
    let winning_mate = |value: &EngineResult| {
        value
            .mate
            .is_some_and(|mate| (if mate == 0 { value.score } else { mate }) * direction > 0)
    };
    if before.mate.is_some() || after.mate.is_some() {
        return winning_mate(after);
    }
    (before.score - after.score) * direction <= 60
}

pub fn training_storage_key(username: &str) -> String {
    let mut key = String::from("chessash:training:v1:");
    let username = username.trim().to_lowercase();
    if username.is_empty() {
        key.push_str("selected-pgn-sides");
    }
    for byte in username.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            key.push(char::from(byte));
        } else {
            key.push_str(&format!("%{byte:02X}"));
        }
    }
    key
}

pub fn training_evidence(
    fen: &str,
    played: &str,
    best: &str,
    reply: Option<&str>,
) -> Option<TrainingEvidence> {
    evidence_for_board(parse_fen(fen).ok()?, played, best, reply)
}

fn evidence_for_board(
    before: Chess,
    played: &str,
    best: &str,
    reply: Option<&str>,
) -> Option<TrainingEvidence> {
    let best_move = legal_uci(&before, best)?;
    let played_move = legal_uci(&before, played)?;
    let mut best_board = before.clone();
    best_board.play_unchecked(best_move);
    let mut evidence = TrainingEvidence {
        best_capture: best_move.is_capture(),
        best_check: best_board.is_check(),
        backrank: back_rank_mate(&best_board, best_move),
        fork: creates_fork(&best_board, best_move),
        ..TrainingEvidence::default()
    };
    if let Some(reply) = reply {
        let mut played_board = before;
        played_board.play_unchecked(played_move);
        let response = legal_uci(&played_board, reply)?;
        let target_square = response.to();
        let board = played_board.board();
        let undefended = board.piece_at(target_square).is_some_and(|target| {
            !matches!(target.role, Role::Pawn | Role::King)
                && board
                    .attacks_to(target_square, target.color, board.occupied())
                    .is_empty()
        });
        played_board.play_unchecked(response);
        evidence.reply_danger = response.is_capture() || played_board.is_check();
        evidence.undefended = response.is_capture() && undefended;
        evidence.backrank |= back_rank_mate(&played_board, response);
    }
    Some(evidence)
}

fn creates_fork(after: &Chess, played: Move) -> bool {
    if !matches!(played.role(), Role::Knight | Role::Pawn) {
        return false;
    }
    let board = after.board();
    let from = played.to();
    let mover = !after.turn();
    let targets =
        board.attacks_from(from) & board.by_color(after.turn()) & !board.by_role(Role::Pawn);
    targets
        .into_iter()
        .filter(|&to| {
            if board.role_at(to) == Some(Role::King) {
                return after.is_check();
            }
            let mut capture = board.clone();
            let Some(piece) = capture.remove_piece_at(from) else {
                return false;
            };
            capture.set_piece_at(to, piece);
            capture.king_of(mover).is_some_and(|king| {
                capture
                    .attacks_to(king, !mover, capture.occupied())
                    .is_empty()
            })
        })
        .take(2)
        .count()
        == 2
}

fn back_rank_mate(board: &Chess, played: Move) -> bool {
    if !matches!(played.role(), Role::Rook | Role::Queen) || !board.is_checkmate() {
        return false;
    }
    let ledge = if board.turn().is_white() {
        Rank::First
    } else {
        Rank::Eighth
    };
    let shield = if board.turn().is_white() {
        Rank::Second
    } else {
        Rank::Seventh
    };
    let Some(king) = board.board().king_of(board.turn()) else {
        return false;
    };
    if king.rank() != ledge || played.to().rank() != ledge {
        return false;
    }
    [-1, 0, 1]
        .into_iter()
        .filter_map(|offset| king.file().offset(offset))
        .filter(|&file| {
            board.board().piece_at(Square::from_coords(file, shield)) == Some(board.turn().pawn())
        })
        .count()
        >= 2
}

pub fn mixed_training_session(queue: &[TrainingCard], limit: usize) -> Vec<TrainingCard> {
    let mut remaining: Vec<_> = queue.iter().collect();
    let mut selected = Vec::new();
    let mut patterns = BTreeMap::<TrainingFocus, usize>::new();
    let mut games = BTreeMap::<&str, usize>::new();
    while selected.len() < limit {
        let Some((index, _)) = remaining.iter().enumerate().min_by_key(|(index, card)| {
            let repeated_pattern = patterns.get(&card.pattern).copied().unwrap_or(0);
            let repeated_game = games.get(card.game_id.as_str()).copied().unwrap_or(0);
            ((repeated_pattern * 3 + repeated_game * 2), *index)
        }) else {
            break;
        };
        let card = remaining.remove(index);
        *patterns.entry(card.pattern).or_insert(0) += 1;
        *games.entry(&card.game_id).or_insert(0) += 1;
        selected.push(card.clone());
    }
    selected
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrainingReply {
    pub before_fen: String,
    pub fen: String,
    pub r#move: String,
    pub text: String,
}

pub fn training_reply_line(
    fen: &str,
    pv: &[String],
    language: &str,
    player_color: Color,
) -> Vec<TrainingReply> {
    let Ok(mut board) = parse_fen(fen) else {
        return Vec::new();
    };
    let mut before_fen = fen.to_owned();
    let mut replies = Vec::new();
    for uci in pv.iter().take(4) {
        let Some(played) = legal_uci(&board, uci) else {
            break;
        };
        let own = Color::from(board.turn()) == player_color;
        board.play_unchecked(played);
        let text = describe_reply(uci, played, &board, language == "it", own);
        let fen = position_fen(&board);
        replies.push(TrainingReply {
            before_fen,
            fen: fen.clone(),
            r#move: uci.clone(),
            text,
        });
        before_fen = fen;
    }
    replies
}

fn describe_reply(uci: &str, played: Move, after: &Chess, italian: bool, own: bool) -> String {
    let actor = match (italian, own) {
        (true, true) => "Puoi",
        (true, false) => "Il tuo avversario può",
        (false, true) => "You can",
        (false, false) => "Your opponent can",
    };
    let from = &uci[..2];
    let to = &uci[2..4];
    if let Some(side) = played.castling_side() {
        let (direction, rook) = match (italian, side.is_king_side()) {
            (false, true) => ("towards the king’s rook", "f"),
            (false, false) => ("towards the queen’s rook", "d"),
            (true, true) => ("corto", "f"),
            (true, false) => ("lungo", "d"),
        };
        let rank = &from[1..];
        return if italian {
            format!("{actor} arroccare {direction} (re in {to}, torre in {rook}{rank}).")
        } else {
            format!("{actor} castle {direction} (king to {to}, rook to {rook}{rank}).")
        };
    }
    let moving_piece = piece_name(played.role(), italian);
    let mut text = if italian {
        let article = italian_article(played.role(), own);
        format!("{actor} spostare {article}{moving_piece} da {from} a {to}")
    } else {
        let article = if own { "your" } else { "the" };
        format!("{actor} move {article} {moving_piece} from {from} to {to}")
    };
    if let Some(captured) = played.capture() {
        let piece = piece_name(captured, italian);
        let capture_square = match played {
            Move::EnPassant { from, to } => Square::from_coords(to.file(), from.rank()),
            _ => played.to(),
        };
        let phrase = if italian {
            format!(
                ", prendendo {}{piece} in {capture_square}",
                italian_article(captured, false)
            )
        } else {
            format!(", taking the {piece} on {capture_square}")
        };
        text.push_str(&phrase);
        if played.is_en_passant() {
            text.push_str(if italian {
                " con la presa en passant"
            } else {
                " as it passes (en passant)"
            });
        }
    }
    if let Some(role) = played.promotion() {
        text.push_str(if italian {
            " e promuovere a "
        } else {
            " and promote it to a "
        });
        text.push_str(piece_name(role, italian));
    }
    if after.is_checkmate() {
        text.push_str(if italian {
            ", dando scacco matto"
        } else {
            ", delivering checkmate"
        });
    } else if after.is_check() {
        text.push_str(if italian {
            ", dando scacco"
        } else {
            ", putting the king in check"
        });
    }
    text.push('.');
    text
}

fn italian_article(role: Role, own: bool) -> &'static str {
    match (role, own) {
        (Role::Rook | Role::Queen, true) => "la tua ",
        (Role::Rook | Role::Queen, false) => "la ",
        (Role::Bishop, false) => "l’",
        (_, true) => "il tuo ",
        (_, false) => "il ",
    }
}

fn piece_name(role: Role, italian: bool) -> &'static str {
    match (role, italian) {
        (Role::Pawn, false) => "pawn",
        (Role::Pawn, true) => "pedone",
        (Role::Knight, false) => "knight",
        (Role::Knight, true) => "cavallo",
        (Role::Bishop, false) => "bishop",
        (Role::Bishop, true) => "alfiere",
        (Role::Rook, false) => "rook",
        (Role::Rook, true) => "torre",
        (Role::Queen, false) => "queen",
        (Role::Queen, true) => "donna",
        (Role::King, false) => "king",
        (Role::King, true) => "re",
    }
}
