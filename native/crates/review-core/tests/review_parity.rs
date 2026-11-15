use chessash_review_core::*;
use shakmaty::{Position, Square};

#[test]
fn stalemate_fixture_replays_with_the_same_game_id() {
    let source = include_str!("../../../../tests/fixtures/rook-stalemate.pgn");
    let game = parse_pgn(source, "PGN").unwrap();
    assert_eq!(game.id, "game-864a47a063ccb88a");
    assert_eq!(game.moves.len(), 97);
    assert_eq!(game.moves[0], "Rxd7+");
    assert_eq!(game.moves[96], "Rg4+");
    assert_eq!(
        game.positions[97],
        "8/8/1b3n2/2p2p2/2q1p1Rk/K7/8/1r1b4 b - - 68 189"
    );
}

#[test]
fn special_moves_and_legacy_unicode_ids_match() {
    let castle = parse_pgn(
        "[White \"Mañana ♞\"]\n[Black \"Éloïse\"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 *",
        "PGN",
    )
    .unwrap();
    assert_eq!(castle.id, "game-abdd24b4a7fb791a");
    assert_eq!(opening_name(&castle.moves), "Italian Game");
    assert_eq!(castle.uci_moves[6], "e1g1");
    assert!(play_uci(&castle.positions[6], "e1h1").is_none());
    assert_eq!(
        castle.positions[7],
        "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4"
    );
    let en_passant = parse_pgn("1. e4 a6 2. e5 d5 3. exd6 *", "PGN").unwrap();
    let board = parse_fen(&en_passant.positions[5]).unwrap();
    assert!(board.board().piece_at(Square::D5).is_none());
    assert_eq!(
        board.board().piece_at(Square::D6),
        Some(shakmaty::Color::White.pawn())
    );
    let underpromotion =
        parse_pgn("[FEN \"7k/1P6/8/8/8/8/8/K7 w - - 0 1\"]\n1. b8=N *", "PGN").unwrap();
    assert_eq!(underpromotion.uci_moves[0], "b7b8n");
}

#[test]
fn rewrites_notes_and_retains_mainline_comments_on_export() {
    let mut game = parse_pgn(
        "[FEN \"7k/1P6/8/8/8/8/8/K7 w - - 0 1\"]\n{Start} 1. b8=N (1. b8=Q+) *",
        "PGN",
    )
    .unwrap();
    game.notes = Some([(1, "An underpromotion.".into())].into());
    let exported = export_pgn(&game, QualityNames::default());
    let replay = parse_pgn(&exported, "PGN").unwrap();
    assert_eq!(replay.comments.get(&0).map(String::as_str), Some("Start"));
    assert_eq!(
        replay.comments.get(&1).map(String::as_str),
        Some("An underpromotion.")
    );
    assert_eq!(game.positions, replay.positions);
}

#[test]
fn validates_mainline_and_pgn_collections() {
    for pgn in [
        "",
        "1. e4 e5 2. Qa8",
        "1. e4 nonsense",
        "1. e4 (d4",
        "[Variant \"Chess960\"]\n1. e4 *",
    ] {
        assert!(parse_pgn(pgn, "PGN").is_err(), "{pgn}");
    }
    let games = parse_pgn_collection(
        "\u{feff}[Event \"A\"]\n1.e4 e5 *\n\n[Event \"B\"]\n1. d4 d5 *",
        "PGN",
    )
    .unwrap();
    assert_eq!(games.len(), 2);
    assert_eq!(
        lichess_game_id("https://lichess.org/game/AbCd1234wxyz/black#23"),
        Some("AbCd1234")
    );
    assert_eq!(
        parse_pgn("[Site \"https://lichess.org/AbCd1234\"]\n1. d4 d5 *", "PGN")
            .unwrap()
            .id,
        "lichess:AbCd1234"
    );
}

#[test]
fn v15_game_json_hydrates_without_replacing_existing_data() {
    let original = parse_pgn("1. e4 {Nice} e5 *", "PGN").unwrap();
    let mut old_json = serde_json::to_value(&original).unwrap();
    old_json.as_object_mut().unwrap().remove("uciMoves");
    old_json.as_object_mut().unwrap().remove("comments");
    old_json["lastPly"] = 2.into();
    old_json["notes"] = serde_json::json!({ "0": "private note" });
    let mut migrated: Game = serde_json::from_value(old_json).unwrap();
    migrated.hydrate().unwrap();
    assert_eq!(migrated.uci_moves, ["e2e4", "e7e5"]);
    assert_eq!(migrated.comments[&1], "Nice");
    assert_eq!(migrated.last_ply, Some(2));
    assert_eq!(migrated.notes.unwrap()[&0], "private note");
}

#[test]
fn checks_policy_thresholds_and_forced_move() {
    let mut facts = ReviewFacts::default();
    for (loss, label) in [
        (0, Label::Excellent),
        (44, Label::Good),
        (45, Label::Inaccuracy),
        (100, Label::Mistake),
        (250, Label::Blunder),
    ] {
        facts.loss = loss;
        assert_eq!(classify(&facts), label);
    }
    facts.loss = 0;
    facts.sacrifice = true;
    assert_eq!(classify(&facts), Label::Excellent);
    facts.verified = true;
    assert_eq!(classify(&facts), Label::Sacrifice);
    let forced = parse_pgn(
        "[FEN \"8/8/8/8/8/5k1q/8/7K w - - 0 1\"]\n1. Kg1 Qg2# 0-1",
        "PGN",
    )
    .unwrap();
    let before = EngineResult {
        score: -1000,
        depth: 14,
        ..Default::default()
    };
    let after = EngineResult {
        score: -29900,
        depth: 14,
        ..Default::default()
    };
    let forced_facts = facts_for_move(&forced, 1, &before, &after, false);
    assert_eq!(forced_facts.loss, 0);
    assert_eq!(classify(&forced_facts), Label::Best);
}
