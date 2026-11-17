use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use chessash_review_core::{
    Game, INITIAL_FEN, PgnError, QualityNames, export_pgn, legal_uci, parse_pgn,
};
use shakmaty::{Chess, EnPassantMode, KnownOutcome, Outcome, Position, fen::Fen, san::SanPlus};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(0);

pub(crate) struct LiveGame {
    game: Game,
    position: Chess,
    repetitions: HashMap<Chess, u8>,
    outcome: Outcome,
}

impl LiveGame {
    pub(crate) fn new(white: &str, black: &str) -> Self {
        let now = chrono::Utc::now();
        let process = std::process::id();
        let sequence = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
        let position = Chess::default();
        Self {
            game: Game {
                id: format!("live-{}-{process}-{sequence}", now.timestamp_millis()),
                headers: [
                    ("Event", "ChessAsh live game".into()),
                    ("Site", "ChessAsh".into()),
                    (
                        "Date",
                        now.with_timezone(&chrono::Local)
                            .format("%Y.%m.%d")
                            .to_string(),
                    ),
                    ("Round", "?".into()),
                    ("White", player_name(white)),
                    ("Black", player_name(black)),
                    ("Result", "*".into()),
                    ("UTCDate", now.format("%Y.%m.%d").to_string()),
                    ("UTCTime", now.format("%H:%M:%S").to_string()),
                ]
                .map(|(tag, value)| (tag.to_owned(), value))
                .into(),
                positions: vec![INITIAL_FEN.into()],
                source: "PGN".into(),
                ..Game::default()
            },
            repetitions: HashMap::from([(position.clone(), 1)]),
            position,
            outcome: Outcome::Unknown,
        }
    }

    pub(crate) fn game(&self) -> &Game {
        &self.game
    }

    pub(crate) fn position(&self) -> &Chess {
        &self.position
    }

    pub(crate) fn outcome(&self) -> Outcome {
        self.outcome
    }

    pub(crate) fn play(&mut self, uci: &str) -> bool {
        if self.outcome.is_known() {
            return false;
        }
        let Some(played) = legal_uci(&self.position, uci) else {
            return false;
        };

        let san = SanPlus::from_move_and_play_unchecked(&mut self.position, played);
        self.game.moves.push(san.to_string());
        self.game.uci_moves.push(uci.into());
        self.game
            .positions
            .push(Fen::from_position(&self.position, EnPassantMode::Legal).to_string());

        let seen = self.repetitions.entry(self.position.clone()).or_default();
        *seen += 1;
        self.outcome = self.position.outcome();
        if self.outcome.is_unknown() && (*seen >= 5 || self.position.halfmoves() >= 150) {
            self.outcome = Outcome::Known(KnownOutcome::Draw);
        }
        self.game
            .headers
            .insert("Result".into(), self.outcome.to_string());
        true
    }

    pub(crate) fn library_game(&self) -> Result<Game, PgnError> {
        let pgn = export_pgn(&self.game, QualityNames::ChessAsh);
        let mut game = parse_pgn(&pgn, &self.game.source)?;
        game.id.clone_from(&self.game.id);
        Ok(game)
    }
}

fn player_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    let name = name.trim();
    if name.is_empty() {
        "?".into()
    } else {
        name.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfinished_live_game_saves_as_a_reimportable_pgn() {
        let mut live = LiveGame::new("  Ana \"Ace\"\nSilva  ", "Béa \\ Bell");
        assert!(matches!(live.library_game(), Err(PgnError::NoMoves)));
        assert!(!live.play("e7e5"));
        assert!(live.play("e2e4"));
        assert_eq!(live.game().positions.len(), 2);
        let first = live.library_game().unwrap();
        assert_eq!(first.headers["White"], "Ana \"Ace\" Silva");
        assert_eq!(first.headers["Black"], "Béa \\ Bell");
        assert_eq!(first.headers["Result"], "*");
        assert!(live.play("e7e5"));
        let updated = live.library_game().unwrap();
        assert_eq!(updated.id, first.id);
        assert_eq!(updated.source, "PGN");
        let imported = parse_pgn(&updated.pgn, "PGN").unwrap();
        assert_eq!(imported.uci_moves, ["e2e4", "e7e5"]);
        assert_eq!(imported.positions, live.game().positions);
        assert_eq!(imported.headers, updated.headers);
    }

    #[cfg(windows)]
    #[test]
    fn saving_again_updates_one_entry_in_the_pgn_collection() {
        use chessash_persistence::Store;

        let profile = tempfile::tempdir().unwrap();
        let path = profile.path().join("data.sqlite3");
        let mut store = Store::open(&path).unwrap();
        let mut live = LiveGame::new("Ada", "Max");
        assert!(live.play("e2e4"));
        store.save_game(&live.library_game().unwrap()).unwrap();
        assert!(live.play("c7c5"));
        store.save_game(&live.library_game().unwrap()).unwrap();
        drop(store);

        let games = Store::open(path).unwrap().games().unwrap();
        let groups = crate::accounts::groups(&games, None);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].key, "files:pgn-files");
        assert_eq!(groups[0].games.len(), 1);
        let saved = groups[0].games[0];
        assert_eq!(saved.headers["White"], "Ada");
        assert_eq!(saved.headers["Black"], "Max");
        assert_eq!(parse_pgn(&saved.pgn, "PGN").unwrap().moves, ["e4", "c5"]);
    }

    #[test]
    fn checkmate_sets_the_result_and_closes_play() {
        let mut live = LiveGame::new("White", "Black");
        for uci in ["f2f3", "e7e5", "g2g4", "d8h4"] {
            assert!(live.play(uci));
        }
        assert!(live.position().is_checkmate());
        assert_eq!(live.outcome().to_string(), "0-1");
        assert!(!live.play("a2a3"));
        let game = live.library_game().unwrap();
        assert_eq!(game.headers["Result"], "0-1");
        assert!(game.pgn.ends_with("2. g4 Qh4# 0-1"));
    }

    #[test]
    fn repetition_ends_play_on_the_fifth_occurrence() {
        let mut live = LiveGame::new("White", "Black");
        for cycle in 0..4 {
            assert!(live.outcome().is_unknown(), "cycle {cycle}");
            for uci in ["g1f3", "g8f6", "f3g1", "f6g8"] {
                assert!(live.play(uci));
            }
        }
        assert_eq!(live.outcome(), Outcome::Known(KnownOutcome::Draw));
        assert!(!live.play("e2e4"));
        assert_eq!(live.library_game().unwrap().headers["Result"], "1/2-1/2");
    }

    #[test]
    fn seventy_five_move_draw_requires_the_full_count() {
        for (halfmoves, result) in [
            (99, Outcome::Unknown),
            (149, Outcome::Known(KnownOutcome::Draw)),
        ] {
            let mut live = LiveGame::new("White", "Black");
            live.position = chessash_review_core::parse_fen(&format!(
                "7k/8/8/8/8/8/R7/K7 w - - {halfmoves} 75"
            ))
            .unwrap();
            assert!(live.play("a2a3"));
            assert_eq!(live.outcome(), result);
        }
    }
}
