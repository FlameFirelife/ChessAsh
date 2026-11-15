use chessash_review_core::{
    EngineResult, Game, Label, MoveReview, ReviewFacts, SacrificeOutcome, TrainingEvidence,
    TrainingPolicyFact, classify, default_training_decisions, parse_fen, parse_pgn,
};
use chessash_review_engine::{
    AlternativeKind, AnalyzeOptions, CoachingLanguage, CoachingOptions, CoachingPack, Foxash,
    InsightKind, SearchOptions, UciEngine, analyze_game, parse_info, review_coaching,
    sacrifice_offers, verify_sacrifice,
};
use shakmaty::{Color, Position};
use std::{path::PathBuf, sync::atomic::AtomicBool};

const ROOK_STALEMATE: &str = include_str!("../../../../tests/fixtures/rook-stalemate.pgn");

#[test]
fn uci_scores_are_white_relative_and_skip_bounds() {
    assert_eq!(
        parse_info("info depth 14 multipv 2 score cp 204 pv d7d5", Color::Black)
            .unwrap()
            .score,
        -204
    );
    let mate = parse_info("info depth 11 score mate -2 pv e4e5", Color::Black).unwrap();
    assert_eq!((mate.score, mate.mate), (29_800, Some(2)));
    assert!(parse_info("info depth 12 score cp 23 lowerbound pv e4e5", Color::White).is_none());
}

#[test]
fn fish_rook_fixture_keeps_the_stalemate_mechanism() {
    let game = parse_pgn(ROOK_STALEMATE, "PGN").unwrap();
    let mut stalemates = 0;
    for index in (0..game.moves.len()).step_by(2) {
        let offers = sacrifice_offers(&game.positions[index], &game.uci_moves[index]);
        let fen = &game.positions[index + 1];
        let after = EngineResult {
            fen: fen.clone(),
            depth: 14,
            score: 0,
            mate: None,
            best: String::new(),
            pv: Vec::new(),
            lines: Vec::new(),
        };
        let evidence = verify_sacrifice(
            fen,
            &offers,
            &after,
            |_, options| {
                Ok(EngineResult {
                    score: -1_000,
                    pv: options.moves.to_vec(),
                    ..after.clone()
                })
            },
            None,
        )
        .unwrap();
        if let Some(evidence) = evidence {
            assert_eq!(evidence.outcome, SacrificeOutcome::Stalemate);
            assert!(evidence.investment >= 2);
            stalemates += 1;
        }
    }
    assert!(
        stalemates >= 40,
        "Only {stalemates} stalemate offers recognized"
    );
}

#[test]
fn exchange_and_already_hanging_piece_are_not_sacrifices() {
    let exchange = parse_pgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 *", "PGN").unwrap();
    assert!(sacrifice_offers(&exchange.positions[6], "b5c6").is_empty());
    assert!(sacrifice_offers("r7/7k/8/8/8/8/8/R6K w - - 0 1", "h1h2").is_empty());
}

#[test]
fn coaching_explains_why_the_center_pawn_push_matters_in_the_players_perspective() {
    let (mut game, mut result) = coaching_fixture(
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
        "d7d5",
        "d7d5",
        &[],
    );
    game.positions
        .insert(0, chessash_review_core::INITIAL_FEN.to_owned());
    result.ply = 2;
    result.color = chessash_review_core::Color::Black;
    result.label = Label::Best;
    result.loss = 0;
    let options = CoachingOptions {
        player_color: Some(chessash_review_core::Color::White),
        ..CoachingOptions::default()
    };
    let english = review_coaching(&game, &result, options);
    assert_eq!(
        english.text,
        "Your opponent challenges your pawn on e4 by putting a pawn on d5."
    );
    assert!(english.best.is_empty());
    assert_eq!(english.targets, ["e4"]);
    let italian = review_coaching(
        &game,
        &result,
        CoachingOptions {
            language: CoachingLanguage::Italian,
            ..options
        },
    );
    assert_eq!(
        italian.text,
        "Il tuo avversario contesta il centro da d5, attaccando il tuo pedone in e4."
    );
}

#[test]
fn king_move_explains_the_promotion_plan_in_the_checked_line() {
    let (game, mut result) = coaching_fixture(
        "6r1/7p/4p2P/3kPp2/2p5/8/4K3/8 b - - 0 39",
        "d5d4",
        "g8d8",
        &[
            "e2d2", "c4c3", "d2e2", "g8c8", "e2f2", "c3c2", "f2f3", "c2c1q",
        ],
    );
    result.label = Label::Excellent;
    result.before = -1200;
    result.after = -1100;
    result.loss = 100;
    let coach = review_coaching(
        &game,
        &result,
        CoachingOptions {
            player_color: Some(chessash_review_core::Color::Black),
            ..CoachingOptions::default()
        },
    );
    assert!(coach.text.contains("Your king on d4 covers c3"));
    assert!(coach.text.contains("the pawn promotes on c1"));
    assert!(coach.targets.contains(&"c3".to_owned()));
}

#[test]
fn coaching_explains_the_defender_and_the_safer_alternative() {
    let (game, result) = coaching_fixture(
        "r7/7k/8/8/8/2B5/8/R6K w - - 0 1",
        "c3d2",
        "c3b2",
        &["h7g7", "h1h2", "a8a1"],
    );
    let options = CoachingOptions {
        player_color: Some(chessash_review_core::Color::White),
        ..CoachingOptions::default()
    };
    let coach = review_coaching(&game, &result, options);
    assert!(
        coach
            .text
            .contains("Your rook on a1 loses its only defender.")
    );
    let insight = coach.insight.unwrap();
    assert_eq!(insight.kind, InsightKind::AbandonedDefender);
    assert_eq!(insight.ply, 3);
    assert_eq!(
        coach.alternative_help.unwrap().kind,
        AlternativeKind::PreservesDefense
    );
    assert!(coach.best.contains("bishop c3 → b2."));
    assert!(
        coach
            .detail
            .contains("Rxa1 takes the piece left behind on a1")
    );
    assert!(!coach.detail.contains("Kg7 Kh2"));
    assert!(coach.detail.contains("keeps your rook on a1 defended"));
    assert_eq!(
        coach.hint.as_deref(),
        Some("What was your bishop on c3 defending?")
    );
    assert!(!coach.best.contains("Kg7"));
    let italian = review_coaching(
        &game,
        &result,
        CoachingOptions {
            language: CoachingLanguage::Italian,
            ..options
        },
    );
    assert!(italian.best.contains("alfiere c3 → b2."));
    assert!(
        italian
            .detail
            .contains("Rxa1 prende il pezzo rimasto senza difesa in a1")
    );
}

#[test]
fn an_unexplained_evaluation_drop_does_not_invent_a_tactic() {
    let (game, mut result) =
        coaching_fixture(chessash_review_core::INITIAL_FEN, "b1a3", "e2e4", &["e7e5"]);
    result.before = 30;
    result.after = -55;
    result.loss = 85;
    let coach = review_coaching(&game, &result, CoachingOptions::default());
    assert!(coach.text.contains("knight on a3 now covers c4"));
    assert!(!coach.detail.contains("Na3 e5"));
}

#[test]
fn saved_prose_is_replaced_in_live_coaching_and_pgn_annotations() {
    let stale = "Compare the replies to find why the engine preferred a stronger move.";
    let (mut game, mut result) = coaching_fixture(
        "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2",
        "e2e3",
        "c2c4",
        &[],
    );
    result.label = Label::Good;
    result.loss = 16;
    result.explanation = stale.to_owned();
    game.review = Some(chessash_review_core::Review {
        version: 1,
        engine: "test".into(),
        depth: result.depth,
        results: vec![result.clone()],
        completed: true,
        created_at: None,
    });
    let options = CoachingOptions {
        player_color: Some(result.color),
        ..CoachingOptions::default()
    };
    let pgn = chessash_review_core::export_pgn_with_review_text(&game, Default::default(), |row| {
        review_coaching(&game, row, options).annotation()
    });
    assert!(!pgn.contains(stale));
    assert!(pgn.contains("You reinforce your pawn on d4"));
    result.r#move = "e2e8".into();
    assert!(
        review_coaching(&game, &result, options)
            .annotation()
            .is_empty()
    );
}

#[test]
fn a_forced_reply_points_to_the_earlier_move_that_allowed_the_mate() {
    let game = parse_pgn(
        "[SetUp \"1\"]\n[FEN \"r7/8/8/8/8/5k2/7K/8 w - - 0 48\"]\n\n48. Kh1 Ra1+ 49. Kh2 *",
        "PGN",
    )
    .unwrap();
    let (_, mut row) = coaching_fixture(&game.positions[2], "h1h2", "h1h2", &[]);
    row.ply = 3;
    row.consequence_of = Some(1);
    let coach = review_coaching(&game, &row, CoachingOptions::default());
    assert!(coach.text.contains("only legal move"));
    assert!(coach.text.contains("forced mate started with 48. Kh1"));
    assert!(coach.detail.is_empty());
}

#[test]
fn coach_explains_the_opening_and_queen_trade_from_the_android_review() {
    let game = parse_pgn(
        "1. d4 d5 2. e3 Nc6 3. Bb5 Bd7 4. Qh5 Nf6 5. Qe5 Nxe5 *",
        "PGN",
    )
    .unwrap();
    let options = CoachingOptions {
        player_color: Some(chessash_review_core::Color::White),
        ..CoachingOptions::default()
    };
    let coach_at = |ply: usize, best, label, loss, replies: &[&str]| {
        let (_, mut row) = coaching_fixture(
            &game.positions[ply - 1],
            &game.uci_moves[ply - 1],
            best,
            replies,
        );
        row.ply = ply;
        row.label = label;
        row.loss = loss;
        review_coaching(&game, &row, options)
    };
    let book = coach_at(2, "g8f6", Label::Book, 12, &[]);
    assert!(
        book.text
            .contains("stopping your pawn on d4 from advancing")
    );
    assert!(book.best.contains("Clears g8 for castling"));

    let solid = coach_at(3, "c2c4", Label::Good, 24, &[]);
    assert!(solid.text.contains("You reinforce your pawn on d4"));
    assert!(solid.text.contains("open a diagonal for your bishop on f1"));
    assert!(solid.best.contains("Challenges your opponent’s pawn on d5"));
    assert!(solid.detail.contains("leave its central square on d5"));

    let unpin = coach_at(6, "c8d7", Label::Best, 0, &[]);
    assert!(unpin.text.contains("bishop on d7 breaks the pin"));
    assert!(unpin.text.contains("defends the knight on c6"));
    assert!(
        unpin
            .detail
            .contains("leaving c6 would expose the king on e8 to the attack from b5")
    );

    let inaccurate = coach_at(7, "g1f3", Label::Inaccuracy, 62, &["g8f6"]);
    assert!(
        inaccurate
            .text
            .contains("Your opponent can develop the knight to f6")
    );
    assert!(inaccurate.text.contains("attack your queen on h5"));
    assert_eq!(inaccurate.threat.as_deref(), Some("g8f6"));
    assert!(inaccurate.best.contains("Clears g1 for castling"));

    let capture = coach_at(10, "c6e5", Label::Great, 0, &["d4e5"]);
    assert!(
        capture
            .text
            .contains("Your opponent takes your queen on e5 with the knight from c6")
    );
    assert!(capture.text.contains("trades the queen for the knight"));
    assert!(capture.best.is_empty());
}

#[test]
fn full_explanation_connects_the_pawn_capture_to_the_threat_against_the_rook() {
    let (game, mut result) = coaching_fixture(
        "2kr3r/pp3ppp/4p3/2p1P3/2b1n3/4P3/PP3PPP/1RK3N1 w - - 0 21",
        "g1h3",
        "b2b3",
        &[
            "c4a2", "f2f3", "e4d2", "h3g5", "d2b3", "c1c2", "d8d2", "c2c3", "a2b1", "c3b3",
        ],
    );
    result.pv = vec!["b2b3".into(), "c4b5".into(), "g1h3".into()];
    let options = CoachingOptions {
        player_color: Some(result.color),
        ..CoachingOptions::default()
    };
    let coach = review_coaching(&game, &result, options);
    assert!(coach.text.contains("take your pawn on a2"));
    assert!(coach.text.contains("attacking your rook on b1"));
    assert!(coach.best.contains("Blocks the bishop’s route to a2."));
    assert!(
        coach
            .detail
            .contains("goes on to take your rook on b1 from a2")
    );
    assert!(coach.detail.contains("cuts off the bishop on c4 from a2"));
    assert_eq!(coach.detail.lines().count(), 2);
    assert!(!coach.detail.contains("Best-move line"));
    assert!(!coach.detail.contains("Nd2 Ng5"));
}

#[test]
fn alternatives_depend_on_the_actual_reply_and_legal_position() {
    let examples: &[(&str, &str, &str, &[&str], AlternativeKind)] = &[
        (
            "r7/7k/8/8/8/2B5/8/R6K w - - 0 1",
            "c3d2",
            "a1a8",
            &["a8a1"],
            AlternativeKind::RemovesAttacker,
        ),
        (
            "r7/7k/8/8/8/2B5/8/R6K w - - 0 1",
            "c3d2",
            "a1b1",
            &["a8a1"],
            AlternativeKind::EscapesCapture,
        ),
        (
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
            "f7f6",
            "e7e5",
            &["d1h5"],
            AlternativeKind::KeepsLineClosed,
        ),
        (
            "7k/8/8/8/1n6/8/7P/R3K3 w - - 0 1",
            "h2h3",
            "e1d1",
            &["b4c2", "e1d2", "c2a1"],
            AlternativeKind::AvoidsFork,
        ),
        (
            "2b4k/8/8/8/8/5N2/P3K3/8 w - - 0 1",
            "a2a3",
            "e2f2",
            &["c8g4"],
            AlternativeKind::AvoidsPin,
        ),
        (
            "k5r1/8/8/8/8/8/4B3/6K1 w - - 0 1",
            "g1h1",
            "e2g4",
            &[],
            AlternativeKind::AnswersCheck,
        ),
        (
            "7k/8/8/3pP3/8/8/8/K7 w - d6 0 1",
            "a1b1",
            "e5d6",
            &[],
            AlternativeKind::UnrecapturedCapture,
        ),
        (
            "8/k1P5/2K5/8/8/8/8/8 w - - 0 1",
            "c6d6",
            "c7c8n",
            &[],
            AlternativeKind::GivesCheck,
        ),
        (
            "k7/8/1QK5/8/8/8/8/8 w - - 0 1",
            "b6b5",
            "b6c7",
            &[],
            AlternativeKind::Stalemate,
        ),
    ];
    for (fen, played, best, replies, expected) in examples {
        let (game, result) = coaching_fixture(fen, played, best, replies);
        let coach = review_coaching(&game, &result, CoachingOptions::default());
        assert_eq!(
            coach
                .alternative_help
                .unwrap_or_else(|| panic!("{fen}: {coach:?}"))
                .kind,
            *expected
        );
    }
}

fn coaching_fixture(fen: &str, uci: &str, best: &str, replies: &[&str]) -> (Game, MoveReview) {
    let board = parse_fen(fen).unwrap();
    let played = chessash_review_core::legal_uci(&board, uci).unwrap();
    let san = shakmaty::san::SanPlus::from_move(board.clone(), played);
    let game = parse_pgn(&format!("[SetUp \"1\"]\n[FEN \"{fen}\"]\n\n{san} *"), "PGN").unwrap();
    let result = MoveReview {
        ply: 1,
        r#move: uci.to_owned(),
        san: Some(san.to_string()),
        color: board.turn().into(),
        before: 250,
        after: 0,
        loss: 250,
        label: Label::Blunder,
        best: best.to_owned(),
        pv: vec![best.to_owned()],
        depth: 14,
        explanation: String::new(),
        hints: Vec::new(),
        key: true,
        facts: None,
        mate: None,
        consequence_of: None,
        reply_pv: Some(replies.iter().map(|uci| (*uci).to_owned()).collect()),
        sacrifice_evidence: None,
    };
    (game, result)
}

#[test]
#[ignore = "requires provisioned native Stockfish and Foxash"]
fn stockfish_and_foxash_complete_fresh_and_cancelled_reviews() {
    let native = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let engines = native.join("engines/windows");
    let scratch = tempfile::tempdir().unwrap();
    let mut engine = UciEngine::new(engines.join("stockfish.exe"));
    let foxash = Foxash::new(engines.join("foxash.exe"), scratch.path());
    let game = parse_pgn("1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0", "PGN").unwrap();

    let options = AnalyzeOptions {
        depth: 4,
        fresh: true,
        ..AnalyzeOptions::default()
    };
    let mut plies = Vec::new();
    let review = analyze_game(&mut engine, &foxash, &game, options.clone(), |result| {
        plies.push(result.ply)
    })
    .unwrap();
    assert!(review.completed);
    assert_eq!(plies, (1..=7).collect::<Vec<_>>());
    assert_eq!(
        (review.results[6].after, review.results[6].mate),
        (30_000, Some(0))
    );
    assert!(
        review
            .results
            .iter()
            .all(|result| result.label == classify(result.facts.as_ref().unwrap()))
    );
    let flag = AtomicBool::new(true);
    let cancelled = AnalyzeOptions {
        cancel: Some(&flag),
        existing: Some(&review),
        ..options.clone()
    };
    let cancelled = analyze_game(&mut engine, &foxash, &game, cancelled, |_| {
        panic!("Unexpected progress")
    })
    .unwrap();
    assert!(!cancelled.completed);
    assert!(cancelled.results.is_empty());

    let constrained = engine
        .analyze(
            &game.positions[0],
            SearchOptions {
                depth: 6,
                multi_pv: 1,
                moves: &["a2a3".to_owned()],
                cancel: None,
            },
        )
        .unwrap();
    assert_eq!(constrained.best, "a2a3");
    let facts = ReviewFacts {
        loss: 85,
        played_best: false,
        book: false,
        missed_chance: false,
        critical: false,
        sacrifice: false,
        verified: true,
    };
    let pack = CoachingPack {
        mistake: 80.5,
        ..CoachingPack::default()
    };
    let result = foxash.classify(&[facts], &pack, None).unwrap();
    assert_eq!(result[0].label, Label::Mistake);
    let training = [
        TrainingPolicyFact {
            loss: 320,
            attempts: 2,
            solved: 1,
            streak: 1,
            passed: true,
            evidence: TrainingEvidence {
                fork: true,
                ..TrainingEvidence::default()
            },
        },
        TrainingPolicyFact {
            loss: 800,
            evidence: TrainingEvidence {
                backrank: true,
                ..TrainingEvidence::default()
            },
            ..TrainingPolicyFact::default()
        },
    ];
    assert_eq!(
        foxash.training_decisions(&training).unwrap(),
        default_training_decisions(&training)
    );
    assert_eq!(std::fs::read_dir(scratch.path()).unwrap().count(), 0);
}

#[test]
#[ignore = "requires provisioned native Stockfish and Foxash"]
fn native_review_recognizes_fish_rook_sacrifices() {
    let native = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let engines = native.join("engines/windows");
    let scratch = tempfile::tempdir().unwrap();
    let mut engine = UciEngine::new(engines.join("stockfish.exe"));
    let foxash = Foxash::new(engines.join("foxash.exe"), scratch.path());
    let game = parse_pgn(ROOK_STALEMATE, "PGN").unwrap();
    let review = analyze_game(
        &mut engine,
        &foxash,
        &game,
        AnalyzeOptions {
            fresh: true,
            ..AnalyzeOptions::default()
        },
        |_| {},
    )
    .unwrap();
    assert!(review.completed);
    assert_eq!(review.depth, AnalyzeOptions::default().depth);
    let stalemates: Vec<_> = review
        .results
        .iter()
        .filter(|result| {
            result.label == Label::Sacrifice
                && result
                    .sacrifice_evidence
                    .as_ref()
                    .is_some_and(|evidence| evidence.outcome == SacrificeOutcome::Stalemate)
        })
        .map(|result| result.ply)
        .collect();
    assert!(
        stalemates.len() >= 40,
        "Only {} sacrifices reviewed as stalemate offers",
        stalemates.len()
    );
    println!(
        "{} stalemate sacrifices at plies {stalemates:?}",
        stalemates.len()
    );
}
