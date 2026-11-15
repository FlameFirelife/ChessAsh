use chessash_review_core::*;

fn reviewed_game() -> Game {
    let mut game = parse_pgn(
        "[White \"FlameDev\"]\n[Black \"Opponent\"]\n1. f3 e5 2. g4 Qh4# 0-1",
        "PGN",
    )
    .unwrap();
    game.review = Some(Review {
        version: 2,
        engine: "fixture".into(),
        depth: 14,
        completed: true,
        created_at: None,
        results: vec![MoveReview {
            ply: 3,
            r#move: "g2g4".into(),
            san: Some("g4".into()),
            color: Color::White,
            before: 0,
            after: -29900,
            loss: 29900,
            label: Label::Blunder,
            best: "b1c3".into(),
            pv: vec![],
            depth: 14,
            explanation: String::new(),
            hints: vec![],
            key: true,
            facts: None,
            mate: Some(-1),
            consequence_of: None,
            reply_pv: Some(vec!["d8h4".into()]),
            sacrifice_evidence: None,
        }],
    });
    game
}

#[test]
fn training_eligibility_and_progress_match_legacy() {
    let game = reviewed_game();
    assert_eq!(
        accuracy(&game.review.as_ref().unwrap().results, Some(Color::White)),
        1
    );
    let cards = training_cards(&[game.clone(), game.clone()], "FlameDev");
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].pattern, TrainingFocus::Reply);
    assert!(training_cards(&[game], "lichess:guest").is_empty());

    let first = record_training(None, true, 100, None);
    let history = [(cards[0].id.clone(), first)].into();
    assert!(training_queue(&cards, &history, first.due - 1, None).is_empty());
    assert_eq!(training_queue(&cards, &history, first.due, None), cards);
    let second = record_training(Some(&first), true, first.due, None);
    assert_eq!(second.due - second.last, 3 * 86_400_000);
    assert_eq!(
        training_storage_key("  lichess:FlameDev "),
        "chessash:training:v1:lichess%3Aflamedev"
    );
    assert_eq!(
        parse_training_history(&serde_json::to_string(&history).unwrap()),
        history
    );
}

#[test]
fn training_forks_and_back_rank_mates_are_legal() {
    let evidence = |fen, played, best, reply| training_evidence(fen, played, best, reply).unwrap();
    assert!(evidence("4k3/7q/8/3N4/8/8/8/K7 w - - 0 1", "d5b4", "d5f6", None).fork);
    assert!(!evidence("4qr1k/7q/8/3N4/8/8/8/5K2 w - - 0 1", "f1g1", "d5f6", None).fork);
    assert!(
        evidence(
            "k6r/8/8/8/7B/8/P7/K7 w - - 0 1",
            "a2a3",
            "h4g3",
            Some("h8h4")
        )
        .undefended
    );
    assert!(
        !evidence(
            "k6r/8/8/8/7B/5N2/P7/K7 w - - 0 1",
            "a2a3",
            "h4g3",
            Some("h8h4")
        )
        .undefended
    );
    assert!(evidence("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1", "e1e2", "e1e8", None).backrank);
    assert!(!evidence("6k1/8/8/8/8/8/8/4R1K1 w - - 0 1", "e1e2", "e1e8", None).backrank);
}

#[test]
fn resume_replays_only_legal_stored_moves_and_preserves_assistance() {
    let cards = training_cards(&[reviewed_game()], "FlameDev");
    let card = &cards[0];
    let legacy = serde_json::json!({
        "version": 1, "id": "session-1", "index": 0, "state": "missed", "attempt": "g2g4",
        "cards": [{ "id": card.id, "pattern": "reply" }], "replyIndex": 0,
        "reply": ["d8h4", "e1e3"], "outcomes": { card.id.clone(): { "attempts": 2, "assisted": true, "solved": false, "due": 300 } }
    });
    let resumed = restore_training(&legacy.to_string(), &cards, "en").unwrap();
    assert_eq!(resumed.reply.len(), 1);
    assert_eq!(resumed.reply_index, Some(0));
    assert!(
        resumed.reply[0]
            .text
            .contains("Your opponent can move the queen from d8 to h4")
    );
    assert!(resumed.reply[0].text.contains("checkmate"));
    assert!(resumed.outcomes[&card.id].assisted);
    let serialized = serialize_training(&resumed).unwrap();
    assert_eq!(
        restore_training(&serialized, &cards, "en"),
        Some(resumed.clone())
    );
    let summary = summarize_training(&cards, &resumed.outcomes, &TrainingHistory::new());
    assert_eq!(summary.assisted, 1);
    assert_eq!(summary.retry, cards);
}
