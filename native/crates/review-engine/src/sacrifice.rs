use crate::{
    EngineError, SearchOptions,
    uci::{check_cancelled, white_sign},
};
use chessash_review_core::{EngineResult, SacrificeEvidence, SacrificeOutcome, parse_fen};
use shakmaty::{CastlingMode, Chess, Move, Position, Role, uci::UciMove};
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SacrificeOffer {
    pub capture: String,
    pub square: String,
    pub investment: i32,
}

fn piece_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 1,
        Role::Knight | Role::Bishop => 3,
        Role::Rook => 5,
        Role::Queen => 9,
        Role::King => 0,
    }
}

pub(crate) fn material_gained(played: Move) -> i32 {
    played.capture().map_or(0, piece_value)
        + played.promotion().map_or(0, |role| piece_value(role) - 1)
}

fn exchange_gain(position: &Chess, capture: Move, budget: &mut usize, depth: usize) -> Option<i32> {
    *budget = budget.checked_sub(1)?;
    if depth > 10 {
        return None;
    }
    let next = position.clone().play(capture).ok()?;
    let mut best_recapture = 0;
    for reply in next
        .capture_moves()
        .into_iter()
        .filter(|reply| reply.to() == capture.to())
    {
        best_recapture = best_recapture.max(exchange_gain(&next, reply, budget, depth + 1)?);
    }
    Some(material_gained(capture) - best_recapture)
}

pub fn sacrifice_offers(before_fen: &str, uci: &str) -> Vec<SacrificeOffer> {
    let Ok(before) = parse_fen(before_fen) else {
        return Vec::new();
    };
    if before.legal_moves().len() < 2 {
        return Vec::new();
    }
    let Ok(candidate) = uci.parse::<UciMove>() else {
        return Vec::new();
    };
    let Ok(moved) = candidate.to_move(&before) else {
        return Vec::new();
    };
    let Ok(after) = before.clone().play(moved) else {
        return Vec::new();
    };
    if after.is_game_over() || after.halfmoves() >= 100 {
        return Vec::new();
    }
    let prior = before.swap_turn().ok();
    let gained = material_gained(moved);
    let moved_to = moved.castling_side().map_or(moved.to(), |castle| {
        shakmaty::Square::from_coords(castle.king_to_file(), moved.to().rank())
    });
    let mut offers = Vec::new();
    for capture in after.capture_moves() {
        if capture.capture().map_or(0, piece_value) < 3 {
            continue;
        }
        let uci = capture.to_uci(CastlingMode::Standard);
        if capture.to() != moved_to
            && let Some(prior) = prior.as_ref()
            && let Ok(prior_capture) = uci.to_move(prior)
            && let Some(prior_gain) = exchange_gain(prior, prior_capture, &mut 256, 0)
            && prior_gain >= 2
        {
            continue;
        }
        let Some(exchange) = exchange_gain(&after, capture, &mut 256, 0) else {
            continue;
        };
        let investment = exchange - gained;
        if investment >= 2 {
            offers.push(SacrificeOffer {
                capture: uci.to_string(),
                square: capture.to().to_string(),
                investment,
            });
        }
    }
    offers.sort_by_key(|offer| std::cmp::Reverse(offer.investment));
    offers
}

pub fn verify_sacrifice(
    fen: &str,
    offers: &[SacrificeOffer],
    after: &EngineResult,
    mut analyze: impl FnMut(&str, SearchOptions<'_>) -> Result<EngineResult, EngineError>,
    cancel: Option<&AtomicBool>,
) -> Result<Option<SacrificeEvidence>, EngineError> {
    let board = parse_fen(fen).map_err(|error| EngineError::InvalidPosition(error.to_string()))?;
    let side = -white_sign(board.turn());
    if after.depth < 14 || after.score * side < -50 {
        return Ok(None);
    }
    for offer in offers.iter().take(3) {
        check_cancelled(cancel)?;
        let evidence = |outcome, score| SacrificeEvidence {
            capture: offer.capture.clone(),
            square: offer.square.clone(),
            investment: offer.investment,
            outcome,
            score,
        };
        let Ok(capture) = offer.capture.parse::<UciMove>().and_then(|uci| {
            uci.to_move(&board)
                .map_err(|_| shakmaty::uci::ParseUciMoveError)
        }) else {
            continue;
        };
        let Ok(accepted) = board.clone().play(capture) else {
            continue;
        };
        if accepted.is_checkmate() {
            continue;
        }
        if accepted.is_stalemate() {
            return Ok(Some(evidence(SacrificeOutcome::Stalemate, 0)));
        }
        if accepted.is_insufficient_material() {
            return Ok(Some(evidence(SacrificeOutcome::Draw, 0)));
        }
        let options = SearchOptions {
            depth: 14,
            multi_pv: 1,
            moves: std::slice::from_ref(&offer.capture),
            cancel,
        };
        let proof = analyze(fen, options)?;
        if proof.depth >= 14
            && proof.pv.first() == Some(&offer.capture)
            && proof.score * side >= -50
            && valid_line(board.clone(), &proof.pv)
        {
            return Ok(Some(evidence(SacrificeOutcome::Compensation, proof.score)));
        }
    }
    Ok(None)
}

fn valid_line(mut board: Chess, moves: &[String]) -> bool {
    for uci in moves.iter().take(8) {
        let Ok(uci) = uci.parse::<UciMove>() else {
            return false;
        };
        let Ok(played) = uci.to_move(&board) else {
            return false;
        };
        board.play_unchecked(played);
    }
    true
}
