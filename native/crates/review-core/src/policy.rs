use shakmaty::Position;

use crate::{Color, EngineResult, Game, INITIAL_FEN, Label, MoveReview, ReviewFacts, parse_fen};

pub const POLICY_VERSION: u32 = 2;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum QualityNames {
    #[default]
    ChessAsh,
    ChessCom,
}

impl Label {
    pub fn name(self, names: QualityNames) -> &'static str {
        match (self, names) {
            (Self::Book, QualityNames::ChessAsh) => "Opening",
            (Self::Great, QualityNames::ChessAsh) => "Critical find",
            (Self::Miss, QualityNames::ChessAsh) => "Missed chance",
            (Self::Sacrifice, QualityNames::ChessAsh) => "Sound sacrifice",
            (Self::Book, QualityNames::ChessCom) => "Book",
            (Self::Great, QualityNames::ChessCom) => "Great",
            (Self::Miss, QualityNames::ChessCom) => "Miss",
            (Self::Sacrifice, QualityNames::ChessCom) => "Brilliant",
            (Self::Best, _) => "Best",
            (Self::Excellent, _) => "Excellent",
            (Self::Good, _) => "Good",
            (Self::Inaccuracy, _) => "Inaccuracy",
            (Self::Mistake, _) => "Mistake",
            (Self::Blunder, _) => "Blunder",
        }
    }

    pub fn is_key(self) -> bool {
        matches!(
            self,
            Self::Sacrifice
                | Self::Great
                | Self::Inaccuracy
                | Self::Mistake
                | Self::Blunder
                | Self::Miss
        )
    }
}

pub fn classify(facts: &ReviewFacts) -> Label {
    if facts.book {
        Label::Book
    } else if facts.verified && facts.sacrifice && facts.loss <= 15 {
        Label::Sacrifice
    } else if facts.verified && facts.critical && facts.played_best && facts.loss <= 15 {
        Label::Great
    } else if facts.loss >= 250 {
        Label::Blunder
    } else if facts.missed_chance && facts.loss >= 100 {
        Label::Miss
    } else if facts.loss >= 100 {
        Label::Mistake
    } else if facts.loss >= 45 {
        Label::Inaccuracy
    } else if facts.played_best {
        Label::Best
    } else if facts.loss <= 15 {
        Label::Excellent
    } else {
        Label::Good
    }
}

pub fn accuracy(results: &[MoveReview], color: Option<Color>) -> u32 {
    let mut total = 0.0;
    let mut count = 0;
    for result in results
        .iter()
        .filter(|result| color.is_none_or(|side| result.color == side))
    {
        total += 100.0 * (-f64::from(result.loss.clamp(0, 1500)) / 300.0).exp();
        count += 1;
    }
    if count == 0 {
        0
    } else {
        (total / f64::from(count)).round() as u32
    }
}

pub fn win_chance(cp: i32) -> f64 {
    100.0 / (1.0 + (-f64::from(cp.clamp(-2000, 2000)) / 350.0).exp())
}

pub fn facts_for_move(
    game: &Game,
    ply: usize,
    before: &EngineResult,
    after: &EngineResult,
    sacrifice: bool,
) -> ReviewFacts {
    let Some(index) = ply.checked_sub(1) else {
        return ReviewFacts::default();
    };
    let Some(board) = game
        .positions
        .get(index)
        .and_then(|fen| parse_fen(fen).ok())
    else {
        return ReviewFacts::default();
    };
    let side = Color::from(board.turn()).sign();
    let played_best =
        board.legal_moves().len() == 1 || game.uci_moves.get(index) == Some(&before.best);
    let mate_preserved = before.mate.is_some()
        && after.mate.is_some()
        && before.score.signum() == after.score.signum();
    let loss = if played_best || mate_preserved {
        0
    } else {
        ((before.score - after.score) * side).max(0)
    };
    let second = before
        .lines
        .iter()
        .find(|line| line.rank == 2 && line.depth >= before.depth.min(14));
    ReviewFacts {
        loss,
        played_best,
        book: game.positions.first().is_some_and(|fen| fen == INITIAL_FEN)
            && is_book_move(&game.moves, ply),
        missed_chance: before.score * side >= 150 && after.score * side < 75,
        critical: second.is_some_and(|second| (before.score - second.score) * side >= 150)
            && (-100..=1000).contains(&(before.score * side)),
        sacrifice,
        verified: before.depth.min(after.depth) >= 14,
    }
}

const OPENINGS: &[(&str, &str)] = &[
    ("e4", "King’s Pawn"),
    ("d4", "Queen’s Pawn"),
    ("c4", "English Opening"),
    ("Nf3", "Réti Opening"),
    ("e4 e5", "Open Game"),
    ("e4 c5", "Sicilian Defence"),
    ("e4 e6", "French Defence"),
    ("e4 c6", "Caro–Kann Defence"),
    ("e4 d5", "Scandinavian Defence"),
    ("e4 d6", "Pirc setup"),
    ("e4 Nf6", "Alekhine Defence"),
    ("d4 d5", "Closed Game"),
    ("d4 Nf6", "Indian Game"),
    ("d4 f5", "Dutch Defence"),
    ("e4 e5 Nf3 Nc6 Bc4", "Italian Game"),
    ("e4 e5 Nf3 Nc6 Bb5", "Ruy López"),
    ("e4 e5 Nf3 Nc6 d4", "Scotch Game"),
    ("e4 e5 Nf3 Nf6", "Petrov Defence"),
    ("e4 e5 Nc3", "Vienna Game"),
    ("e4 e5 f4", "King’s Gambit"),
    ("d4 d5 c4", "Queen’s Gambit"),
    ("d4 d5 c4 e6", "Queen’s Gambit Declined"),
    ("d4 d5 c4 dxc4", "Queen’s Gambit Accepted"),
    ("d4 d5 c4 c6", "Slav Defence"),
    ("d4 Nf6 c4 g6", "King’s Indian setup"),
    ("d4 Nf6 c4 e6 Nc3 Bb4", "Nimzo-Indian Defence"),
    ("d4 d5 Bf4", "London System"),
    ("d4 Nf6 Bf4", "London System"),
    ("e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "Sicilian Najdorf"),
    ("e4 e6 d4 d5", "French Defence"),
    ("e4 c6 d4 d5", "Caro–Kann Defence"),
];

pub fn opening_name(moves: &[String]) -> &'static str {
    let mut name = "Unclassified opening";
    let mut length = 0;
    for (sequence, opening) in OPENINGS {
        let prefix = sequence.split(' ').collect::<Vec<_>>();
        if prefix.len() > length
            && moves
                .get(..prefix.len())
                .is_some_and(|moves| moves.iter().map(String::as_str).eq(prefix.iter().copied()))
        {
            name = opening;
            length = prefix.len();
        }
    }
    name
}

pub fn is_book_move(moves: &[String], ply: usize) -> bool {
    if ply == 0 || ply > moves.len() {
        return false;
    }
    OPENINGS.iter().any(|(sequence, _)| {
        sequence
            .split(' ')
            .take(ply)
            .eq(moves[..ply].iter().map(String::as_str))
    })
}
