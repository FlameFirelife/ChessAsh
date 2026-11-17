mod coaching;
mod foxash;
mod insight;
mod sacrifice;
mod uci;

pub use foxash::{CoachingPack, Foxash, FoxashError, PolicyDecision};
pub use insight::{AlternativeHelp, AlternativeKind, InsightKind, InsightTarget, MoveInsight};
pub use sacrifice::{SacrificeOffer, sacrifice_offers, verify_sacrifice};
pub use uci::{ENGINE_VERSION, EngineError, SearchOptions, UciEngine, parse_info};

use chessash_review_core::{
    Color, Game, MoveReview, POLICY_VERSION, Review, facts_for_move, parse_fen,
};
use shakmaty::Position;
use std::{
    sync::atomic::AtomicBool,
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

#[derive(Clone)]
pub struct AnalyzeOptions<'a> {
    pub depth: usize,
    pub fresh: bool,
    pub cancel: Option<&'a AtomicBool>,
    pub existing: Option<&'a Review>,
    pub pack: CoachingPack,
}

impl Default for AnalyzeOptions<'_> {
    fn default() -> Self {
        Self {
            depth: 12,
            fresh: false,
            cancel: None,
            existing: None,
            pack: CoachingPack::default(),
        }
    }
}

#[derive(Debug, Error)]
pub enum ReviewError {
    #[error(transparent)]
    Engine(#[from] EngineError),
    #[error(transparent)]
    Policy(#[from] FoxashError),
    #[error("Imported game positions do not match its moves.")]
    InvalidGame,
}

pub fn analyze_game(
    engine: &mut UciEngine,
    policy: &Foxash,
    game: &Game,
    options: AnalyzeOptions<'_>,
    on_result: impl FnMut(&MoveReview),
) -> Result<Review, ReviewError> {
    analyze(engine, policy, game, options, false, on_result)
}

pub fn analyze_live_game(
    engine: &mut UciEngine,
    policy: &Foxash,
    game: &Game,
    options: AnalyzeOptions<'_>,
    on_result: impl FnMut(&MoveReview),
) -> Result<Review, ReviewError> {
    analyze(engine, policy, game, options, true, on_result)
}

fn analyze(
    engine: &mut UciEngine,
    policy: &Foxash,
    game: &Game,
    options: AnalyzeOptions<'_>,
    live: bool,
    mut on_result: impl FnMut(&MoveReview),
) -> Result<Review, ReviewError> {
    if game.positions.len() != game.moves.len() + 1 || game.uci_moves.len() != game.moves.len() {
        return Err(ReviewError::InvalidGame);
    }
    let depth = options.depth.clamp(4, 22);
    if options.fresh {
        engine.reset();
    }
    let existing = if live {
        options.existing
    } else {
        options.existing.or(game.review.as_ref())
    };
    let mut resumable = (!options.fresh)
        .then_some(existing)
        .flatten()
        .filter(|review| {
            review.version == POLICY_VERSION
                && review.depth == depth
                && review.engine == ENGINE_VERSION
        })
        .map_or_else(Vec::new, |review| review.results.clone());
    resumable.sort_by_key(|result| result.ply);
    resumable.truncate(
        resumable
            .iter()
            .take(game.moves.len())
            .enumerate()
            .take_while(|(index, result)| {
                result.ply == index + 1 && (!live || result.r#move == game.uci_moves[*index])
            })
            .count(),
    );
    let mut review = Review {
        version: POLICY_VERSION,
        engine: ENGINE_VERSION.to_owned(),
        depth,
        results: Vec::with_capacity(game.moves.len()),
        completed: false,
        created_at: Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        ),
    };

    let operation = (|| -> Result<(), ReviewError> {
        for mut result in resumable {
            if live {
                review.results.push(result);
                continue;
            }
            uci::check_cancelled(options.cancel)?;
            if let Some(facts) = result.facts.as_ref() {
                let decisions =
                    policy.classify(std::slice::from_ref(facts), &options.pack, options.cancel)?;
                let decision = decisions.into_iter().next().ok_or(FoxashError::Invalid)?;
                result.label = decision.label;
                result.key = decision.key;
                result.consequence_of = None;
                explain(game, &mut result, &review.results, decision.hint);
            }
            review.results.push(result);
            on_result(review.results.last().expect("resumed review row"));
        }
        let start = review.results.len();
        if start == game.moves.len() {
            return Ok(());
        }
        let mut search = SearchOptions {
            depth: depth.max(review.results.last().map_or(depth, |last| last.depth)),
            cancel: options.cancel,
            ..SearchOptions::default()
        };
        let mut before = engine.analyze(&game.positions[start], search)?;
        for index in start..game.moves.len() {
            uci::check_cancelled(options.cancel)?;
            let before_fen = &game.positions[index];
            let after_fen = &game.positions[index + 1];
            let mut after = engine.analyze(after_fen, search)?;
            let ply = index + 1;
            let uci = &game.uci_moves[index];
            let side = parse_fen(before_fen)
                .map_err(|_| ReviewError::InvalidGame)?
                .turn();
            let raw_loss = (before.score - after.score) * uci::white_sign(side);
            let offers = sacrifice_offers(before_fen, uci);
            if search.depth < 14
                && (raw_loss >= 100
                    || before.mate.is_some() != after.mate.is_some()
                    || !offers.is_empty())
            {
                search.depth = 14;
                before = engine.analyze(before_fen, search)?;
                after = engine.analyze(after_fen, search)?;
            }
            let mut facts = facts_for_move(game, ply, &before, &after, false);
            let sacrifice_evidence = if facts.loss <= 15 && !offers.is_empty() {
                verify_sacrifice(
                    after_fen,
                    &offers,
                    &after,
                    |fen, search| engine.analyze(fen, search),
                    options.cancel,
                )?
            } else {
                None
            };
            facts.sacrifice = sacrifice_evidence.is_some();
            let decisions =
                policy.classify(std::slice::from_ref(&facts), &options.pack, options.cancel)?;
            let decision = decisions.into_iter().next().ok_or(FoxashError::Invalid)?;
            let mut result = MoveReview {
                ply,
                r#move: uci.to_owned(),
                san: Some(game.moves[index].clone()),
                color: if side == shakmaty::Color::White {
                    Color::White
                } else {
                    Color::Black
                },
                before: before.score,
                after: after.score,
                loss: facts.loss,
                label: decision.label,
                best: before.best.clone(),
                pv: before.pv.clone(),
                depth: before.depth.min(after.depth),
                explanation: String::new(),
                hints: Vec::new(),
                key: decision.key,
                facts: Some(facts),
                mate: after.mate,
                consequence_of: None,
                reply_pv: Some(after.pv.clone()),
                sacrifice_evidence,
            };
            explain(game, &mut result, &review.results, decision.hint);
            review.results.push(result);
            on_result(review.results.last().expect("new review row"));
            before = after;
        }
        Ok(())
    })();

    match operation {
        Ok(())
        | Err(ReviewError::Engine(EngineError::Cancelled))
        | Err(ReviewError::Policy(FoxashError::Cancelled)) => {
            review.completed = review.results.len() == game.moves.len();
            Ok(review)
        }
        Err(error) => Err(error),
    }
}

fn explain(game: &Game, result: &mut MoveReview, prior: &[MoveReview], policy_hint: String) {
    let before_fen = &game.positions[result.ply - 1];
    let forced = parse_fen(before_fen).is_ok_and(|board| board.legal_moves().len() == 1);
    if forced {
        let side = if result.color == Color::White { 1 } else { -1 };
        let cause = prior.iter().rev().find(|item| {
            item.color == result.color
                && item.key
                && item.before * side > -29_000
                && item.after * side <= -29_000
        });
        if let Some(cause) = cause
            && prior
                .iter()
                .filter(|item| item.ply >= cause.ply)
                .all(|item| item.after * side <= -29_000)
        {
            result.key = false;
            result.consequence_of = Some(cause.ply);
        }
    }
    let coaching = review_coaching(game, result, CoachingOptions::default());
    result.explanation = coaching.annotation();
    result.hints = vec![coaching.hint.unwrap_or(policy_hint)];
}

pub use coaching::{Coaching, CoachingLanguage, CoachingOptions, review_coaching};
