use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TryRecvError},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use chessash_persistence::Store;
use chessash_review_core::{
    Color, Game, PracticeEvent, PracticeState, ResumedTraining, SessionOutcome, TRAINING_FOCUSES,
    TrainingCard, TrainingDecision, TrainingFocus, TrainingHistory, TrainingPolicyFact,
    TrainingReply, acceptable_training_move, merge_practice_events, mixed_training_session,
    parse_fen, parse_practice_events, parse_training_history, play_uci, practice_trends,
    record_training, restore_training, serialize_training, summarize_training, training_cards,
    training_fact, training_queue, training_reply_line, training_storage_key,
};
use chessash_review_engine::{
    CoachingLanguage, CoachingOptions, Foxash, SearchOptions, UciEngine, review_coaching,
};
use eframe::egui::{self, Color32, RichText, Vec2};
use shakmaty::Position;

use crate::{
    appearance,
    audio::MoveSound,
    board::{self, Board, BoardView, Transition},
    platform::{self, Platform},
};

pub enum TrainingAction {
    OpenLibrary,
    OpenSource { game_id: String, ply: usize },
}

enum Event {
    Queue(Result<Vec<TrainingDecision>, String>),
    Attempt(Result<(bool, bool, u64, Vec<TrainingReply>), String>),
}

#[derive(Default)]
pub struct Training {
    key: String,
    revision: Vec<(
        String,
        Option<u64>,
        usize,
        Option<chessash_review_core::Perspective>,
    )>,
    cards: Vec<TrainingCard>,
    priorities: BTreeMap<String, f64>,
    history: TrainingHistory,
    events: Vec<PracticeEvent>,
    data: ResumedTraining,
    selected: Option<usize>,
    promotion: Option<(String, String)>,
    motion: Option<Instant>,
    pending: Option<Receiver<Event>>,
    cancel: Option<Arc<AtomicBool>>,
    error: String,
    ready: bool,
    dirty: bool,
}

impl Training {
    #[cfg(all(windows, feature = "visual-qa"))]
    pub fn waiting_for_preview(&self) -> bool {
        self.key.is_empty() || self.pending.is_some()
    }

    pub fn show(
        &mut self,
        ui: &mut egui::Ui,
        board: &Board,
        games: &[Game],
        mut store: Option<&mut Store>,
        platform: &Platform,
        italian: bool,
        sound: &mut MoveSound,
        sound_enabled: bool,
        reduced_motion: bool,
    ) -> Option<TrainingAction> {
        let language = if italian { "it" } else { "en" };
        let account = setting(store.as_deref(), "chessash:main-username").unwrap_or_default();
        let key = training_storage_key(&account);
        let revision = games
            .iter()
            .filter_map(|game| {
                let review = game.review.as_ref().filter(|review| review.completed)?;
                Some((
                    game.id.clone(),
                    review.created_at,
                    review.results.len(),
                    game.review_as,
                ))
            })
            .collect::<Vec<_>>();
        if self.key != key {
            self.abort();
            self.key = key;
            self.history = setting(store.as_deref(), &self.key)
                .map(|raw| parse_training_history(&raw))
                .unwrap_or_default();
            self.events = setting(store.as_deref(), &format!("{}:events", self.key))
                .map(|raw| parse_practice_events(&raw))
                .unwrap_or_default();
            self.cards = training_cards(games, &account);
            self.data = setting(store.as_deref(), &format!("{}:session", self.key))
                .and_then(|raw| restore_training(&raw, &self.cards, language))
                .unwrap_or_default();
            self.revision = revision;
            self.selected = None;
            self.promotion = None;
            self.error.clear();
            self.dirty = false;
            self.prepare_queue(ui.ctx(), platform);
        } else if self.revision != revision && self.pending.is_none() {
            self.revision = revision;
            self.cards = training_cards(games, &account);
            self.prepare_queue(ui.ctx(), platform);
        }
        let previous_motion = self.motion;
        self.poll();

        let action = if self.data.session.is_empty() {
            self.overview(ui, board, platform, italian)
        } else {
            ui.horizontal(|ui| {
                ui.heading(tr(italian, "Training", "Allenamento"));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui
                        .button(tr(italian, "Back to training", "Torna all’allenamento"))
                        .clicked()
                    {
                        self.begin(Vec::new());
                        self.prepare_queue(ui.ctx(), platform);
                    }
                });
            });
            ui.add_space(8.0);
            if self.data.session.is_empty() {
                self.overview(ui, board, platform, italian)
            } else if let Some(card) = self.data.session.get(self.data.index).cloned() {
                let game = games.iter().find(|game| game.id == card.game_id);
                if ui.available_width() >= 710.0 {
                    ui.spacing_mut().item_spacing.x = 16.0;
                    ui.columns(2, |columns| {
                        panel(&mut columns[0], |ui| {
                            self.practice_board(
                                ui,
                                board,
                                platform,
                                &card,
                                italian,
                                reduced_motion,
                            );
                        });
                        panel(&mut columns[1], |ui| {
                            self.exercise_heading(ui, &card, italian);
                            self.exercise(ui, platform, &card, game, italian)
                        })
                    })
                } else {
                    panel(ui, |ui| {
                        self.exercise_heading(ui, &card, italian);
                        ui.add_space(10.0);
                        self.practice_board(ui, board, platform, &card, italian, reduced_motion);
                        ui.add_space(10.0);
                        self.exercise(ui, platform, &card, game, italian)
                    })
                }
            } else {
                self.recap(ui, italian);
                None
            }
        };
        if !self.error.is_empty() {
            ui.colored_label(Color32::LIGHT_RED, &self.error);
        }
        if sound_enabled && self.motion.is_some() && self.motion != previous_motion {
            sound.play(platform);
        }

        if self.dirty {
            match self.flush(store.as_deref_mut()) {
                Ok(()) => self.dirty = false,
                Err(error) => self.error = error,
            }
        }
        action
    }

    fn practice_board(
        &mut self,
        ui: &mut egui::Ui,
        board: &Board,
        platform: &Platform,
        card: &TrainingCard,
        italian: bool,
        reduced_motion: bool,
    ) {
        let viewport = ui.ctx().content_rect();
        let reserved = if viewport.width() < 710.0 {
            448.0
        } else {
            210.0
        };
        let size = (viewport.height() - reserved)
            .clamp(220.0, 475.0)
            .min(ui.available_width());
        let parsed = parse_fen(&self.data.fen).ok();
        let transition = self
            .motion
            .filter(|_| !reduced_motion)
            .map(|started| started.elapsed().as_secs_f32() / 0.16)
            .filter(|&progress| progress < 1.0)
            .map(|progress| Transition {
                uci: &self.data.r#move,
                progress,
                reverse: false,
                fast: false,
            });
        let click = ui
            .vertical_centered(|ui| {
                board.show(
                    ui,
                    BoardView {
                        fen: &self.data.fen,
                        size,
                        flipped: card.result.color == Color::Black,
                        last: &self.data.r#move,
                        best: if self.data.state == PracticeState::Revealed {
                            &card.result.best
                        } else {
                            ""
                        },
                        selected: self.selected,
                        quality: (self.data.state == PracticeState::Correct)
                            .then_some(("✓", Color32::from_rgb(74, 136, 84))),
                        transition,
                        check: parsed.as_ref().is_some_and(Position::is_check),
                        mate: parsed.as_ref().is_some_and(Position::is_checkmate),
                    },
                )
            })
            .inner;
        let moved = click.and_then(|square| self.choose_square(card, square));
        let promotion = self.promotion.clone().and_then(|(from, to)| {
            let mut move_to_play = None;
            egui::Window::new(tr(italian, "Promote pawn", "Promuovi il pedone"))
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ui.ctx(), |ui| {
                    ui.horizontal_wrapped(|ui| {
                        for (suffix, en, it) in [
                            ("q", "Queen", "Donna"),
                            ("r", "Rook", "Torre"),
                            ("b", "Bishop", "Alfiere"),
                            ("n", "Knight", "Cavallo"),
                        ] {
                            if ui.button(tr(italian, en, it)).clicked() {
                                move_to_play = Some(format!("{from}{to}{suffix}"));
                                self.promotion = None;
                            }
                        }
                        if ui.button(tr(italian, "Cancel", "Annulla")).clicked() {
                            self.promotion = None;
                        }
                    });
                });
            move_to_play
        });
        if let Some(uci) = moved.or(promotion) {
            self.attempt(
                ui.ctx(),
                platform,
                card,
                uci,
                if italian { "it" } else { "en" },
            );
        }
    }

    fn abort(&mut self) {
        if let Some(cancel) = self.cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.pending = None;
    }

    fn prepare_queue(&mut self, ctx: &egui::Context, platform: &Platform) {
        self.abort();
        self.ready = self.cards.is_empty();
        if self.ready {
            self.priorities.clear();
            return;
        }
        let facts = self
            .cards
            .iter()
            .map(|card| training_fact(card, self.history.get(&card.id), false))
            .collect::<Vec<_>>();
        let policy = training_policy(platform);
        let ctx = ctx.clone();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = send.send(Event::Queue(policy(&facts)));
            ctx.request_repaint();
        });
        self.pending = Some(receive);
    }

    fn poll(&mut self) {
        let Some(receiver) = &self.pending else {
            return;
        };
        match receiver.try_recv() {
            Ok(Event::Queue(result)) => {
                self.pending = None;
                match result {
                    Ok(rows) if rows.len() == self.cards.len() => {
                        self.priorities.clear();
                        for (card, decision) in self.cards.iter_mut().zip(rows) {
                            card.pattern = decision.focus;
                            self.priorities.insert(card.id.clone(), decision.priority);
                        }
                        self.ready = true;
                    }
                    Ok(_) => self.error = "Training policy returned an incomplete queue.".into(),
                    Err(error) => self.error = error,
                }
            }
            Ok(Event::Attempt(result)) => {
                self.pending = None;
                self.cancel = None;
                match result {
                    Ok((solved, reveal, interval, reply)) => {
                        self.remember(solved, reveal, interval, reply)
                    }
                    Err(error) => {
                        self.error = error;
                        self.data.state = PracticeState::Error;
                    }
                }
            }
            Err(TryRecvError::Disconnected) => {
                self.pending = None;
                self.cancel = None;
                self.error = "Training ended before producing a result.".into();
                if self.data.state == PracticeState::Checking {
                    self.data.state = PracticeState::Error;
                }
            }
            Err(TryRecvError::Empty) => {}
        }
    }

    fn choose_square(&mut self, card: &TrainingCard, square: usize) -> Option<String> {
        if self.data.state != PracticeState::Ready || self.promotion.is_some() {
            return None;
        }
        let own = |square: usize| {
            board::placement(&card.fen)[square]
                .is_some_and(|piece| piece.is_uppercase() == (card.result.color == Color::White))
        };
        let previous = self.selected.take();
        if own(square) {
            self.selected = (previous != Some(square)).then_some(square);
            return None;
        }
        let from = square_name(previous?);
        let to = square_name(square);
        let uci = format!("{from}{to}");
        if play_uci(&card.fen, &uci).is_some() {
            return Some(uci);
        }
        if play_uci(&card.fen, &format!("{uci}q")).is_some() {
            self.promotion = Some((from, to));
        }
        None
    }

    fn attempt(
        &mut self,
        ctx: &egui::Context,
        platform: &Platform,
        card: &TrainingCard,
        uci: String,
        language: &str,
    ) {
        let Some(play) = play_uci(&card.fen, &uci) else {
            return;
        };
        self.abort();
        self.error.clear();
        self.data.state = PracticeState::Checking;
        self.data.fen = play.fen.clone();
        self.data.r#move.clone_from(&uci);
        self.data.attempt.clone_from(&uci);
        self.data.reply.clear();
        self.data.reply_index = None;
        self.motion = Some(Instant::now());
        let card = card.clone();
        let assisted = self
            .data
            .outcomes
            .get(&card.id)
            .is_some_and(|outcome| outcome.assisted);
        let previous = self.history.get(&card.id).copied();
        let ctx = ctx.clone();
        let policy = training_policy(platform);
        let engine = platform::executable(&platform.engines, "stockfish");
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = Some(Arc::clone(&cancel));
        let language = language.to_owned();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let result = (|| {
                let mut solved = uci == card.result.best;
                let mut reply = Vec::new();
                if !solved {
                    let mut engine = UciEngine::new(engine);
                    let opts = SearchOptions {
                        depth: 12,
                        multi_pv: 1,
                        cancel: Some(&cancel),
                        ..Default::default()
                    };
                    let before = engine
                        .analyze(&card.fen, opts)
                        .map_err(|error| error.to_string())?;
                    let after = engine
                        .analyze(&play.fen, opts)
                        .map_err(|error| error.to_string())?;
                    solved = acceptable_training_move(&before, &after, card.result.color);
                    if !solved {
                        reply =
                            training_reply_line(&play.fen, &after.pv, &language, card.result.color);
                    }
                }
                let decisions =
                    policy(&[training_fact(&card, previous.as_ref(), solved && !assisted)])?;
                let interval = decisions
                    .first()
                    .ok_or("Training policy returned no decision.")?
                    .interval_seconds;
                Ok((solved, false, interval, reply))
            })();
            if !cancel.load(Ordering::Relaxed) {
                let _ = send.send(Event::Attempt(result));
                ctx.request_repaint();
            }
        });
        self.pending = Some(receive);
    }

    fn reveal(&mut self, ctx: &egui::Context, platform: &Platform, card: &TrainingCard) {
        self.abort();
        self.error.clear();
        if self.data.state == PracticeState::Missed
            && let Some(outcome) = self.data.outcomes.get_mut(&card.id)
        {
            outcome.assisted = true;
            self.show_solution(card);
            return;
        }
        let fact = training_fact(card, self.history.get(&card.id), false);
        let policy = training_policy(platform);
        self.data.state = PracticeState::Checking;
        let ctx = ctx.clone();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let result = policy(&[fact]).and_then(|rows| {
                rows.first()
                    .map(|decision| (false, true, decision.interval_seconds, Vec::new()))
                    .ok_or_else(|| "Training policy returned no decision.".into())
            });
            let _ = send.send(Event::Attempt(result));
            ctx.request_repaint();
        });
        self.pending = Some(receive);
    }

    fn remember(&mut self, solved: bool, reveal: bool, interval: u64, reply: Vec<TrainingReply>) {
        let Some(card) = self.data.session.get(self.data.index).cloned() else {
            return;
        };
        let previous = self.data.outcomes.get(&card.id);
        let assisted = reveal || previous.is_some_and(|outcome| outcome.assisted);
        let attempts = previous.map_or(1, |outcome| outcome.attempts + 1);
        let record = record_training(
            self.history.get(&card.id),
            solved && !assisted,
            now(),
            Some(interval),
        );
        self.history.insert(card.id.clone(), record);
        self.data.outcomes.insert(
            card.id.clone(),
            SessionOutcome {
                attempts,
                solved,
                assisted,
                due: record.due,
            },
        );
        self.dirty = true;
        if reveal {
            self.show_solution(&card);
        } else {
            self.data.state = if solved {
                PracticeState::Correct
            } else {
                PracticeState::Missed
            };
            self.data.reply = reply;
        }
    }

    fn show_solution(&mut self, card: &TrainingCard) {
        if let Some(solution) = play_uci(&card.fen, &card.result.best) {
            self.data.fen = solution.fen;
            self.data.r#move.clone_from(&card.result.best);
            self.data.state = PracticeState::Revealed;
            self.data.reply.clear();
            self.data.reply_index = None;
            self.motion = Some(Instant::now());
        } else {
            self.data.state = PracticeState::Error;
        }
        self.dirty = true;
    }

    fn begin(&mut self, cards: Vec<TrainingCard>) {
        self.abort();
        self.error.clear();
        self.selected = None;
        self.promotion = None;
        self.motion = None;
        self.data = ResumedTraining {
            fen: cards
                .first()
                .map(|card| card.fen.clone())
                .unwrap_or_default(),
            id: format!("training-{}", now()),
            session: cards,
            ..Default::default()
        };
        self.dirty = true;
    }

    fn reset_board(&mut self) {
        self.abort();
        self.selected = None;
        self.promotion = None;
        self.motion = None;
        self.error.clear();
        self.data.state = PracticeState::Ready;
        self.data.fen = self
            .data
            .session
            .get(self.data.index)
            .map(|card| card.fen.clone())
            .unwrap_or_default();
        self.data.r#move.clear();
        self.data.attempt.clear();
        self.data.reply.clear();
        self.data.reply_index = None;
        self.dirty = true;
    }

    fn advance(&mut self) {
        self.data.index += 1;
        self.reset_board();
        if self.data.index == self.data.session.len() {
            self.events = merge_practice_events(
                &self.events,
                &self.data.id,
                &self.data.session,
                &self.data.outcomes,
                now(),
            );
        }
    }

    fn flush(&self, store: Option<&mut Store>) -> Result<(), String> {
        let Some(store) = store else {
            return Err("Training progress could not be saved.".into());
        };
        let history = serde_json::to_string(&self.history).map_err(|error| error.to_string())?;
        let events = serde_json::to_string(&self.events).map_err(|error| error.to_string())?;
        let session = serialize_training(&self.data);
        store
            .set_local_settings(&[
                (&self.key, Some(&history)),
                (&format!("{}:events", self.key), Some(&events)),
                (&format!("{}:session", self.key), session.as_deref()),
            ])
            .map_err(|error| error.to_string())
    }

    fn overview(
        &mut self,
        ui: &mut egui::Ui,
        board: &Board,
        platform: &Platform,
        italian: bool,
    ) -> Option<TrainingAction> {
        let due = if self.ready {
            training_queue(&self.cards, &self.history, now(), Some(&self.priorities))
        } else {
            Vec::new()
        };
        let mut action = None;
        let wide = ui.available_width() >= 710.0;
        ui.spacing_mut().item_spacing.x = 14.0;
        if wide {
            ui.columns(2, |columns| {
                action = self.session_panel(&mut columns[0], board, platform, &due, italian);
                self.progress_panel(&mut columns[1], italian);
            });
        } else {
            action = self.session_panel(ui, board, platform, &due, italian);
        }
        if self.ready && !self.cards.is_empty() {
            ui.add_space(18.0);
            ui.heading(tr(italian, "Practice by pattern", "Allenati per schema"));
            ui.add_space(5.0);
            let patterns = TRAINING_FOCUSES
                .into_iter()
                .filter(|pattern| self.cards.iter().any(|card| card.pattern == *pattern))
                .collect::<Vec<_>>();
            let columns = if wide {
                3
            } else if ui.available_width() >= 340.0 {
                2
            } else {
                1
            };
            for row in patterns.chunks(columns) {
                ui.columns(columns, |cells| {
                    for (ui, &pattern) in cells.iter_mut().zip(row) {
                        let available = due.iter().filter(|card| card.pattern == pattern).count();
                        panel(ui, |ui| {
                            ui.set_min_height(100.0);
                            ui.strong(focus_name(pattern, italian));
                            if available > 0 {
                                let ready = if italian {
                                    format!("Pronte: {available}")
                                } else {
                                    format!("{available} ready")
                                };
                                ui.small(ready);
                            } else {
                                ui.small(tr(italian, "Due later", "Da ripassare più avanti"));
                            }
                            ui.add_space(7.0);
                            if ui
                                .add_enabled(
                                    available > 0,
                                    egui::Button::new(tr(italian, "Practice", "Allenati")),
                                )
                                .clicked()
                            {
                                let cards = due
                                    .iter()
                                    .filter(|card| card.pattern == pattern)
                                    .take(5)
                                    .cloned()
                                    .collect();
                                self.begin(cards);
                            }
                        });
                    }
                });
                ui.add_space(9.0);
            }
        }
        if !wide {
            ui.add_space(12.0);
            self.progress_panel(ui, italian);
        }
        action
    }

    fn session_panel(
        &mut self,
        ui: &mut egui::Ui,
        board: &Board,
        platform: &Platform,
        due: &[TrainingCard],
        italian: bool,
    ) -> Option<TrainingAction> {
        let border = if ui.visuals().dark_mode {
            Color32::from_rgb(100, 125, 77)
        } else {
            Color32::from_rgb(148, 173, 123)
        };
        appearance::panel(ui).inner_margin(16).stroke(egui::Stroke::new(1.0_f32, border)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            let preview = due.first().filter(|_| ui.available_width() >= 300.0);
            let width = ui.available_width();
            ui.horizontal_top(|ui| {
                let art_size = if preview.is_some() { 108.0 } else { 0.0 };
                let text_width = width - art_size - if preview.is_some() { ui.spacing().item_spacing.x } else { 0.0 };
                let action = ui.allocate_ui_with_layout(
                    Vec2::new(text_width, 94.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(text_width);
                        ui.label(RichText::new(tr(italian, "Train from your games", "Allenati dalle tue partite")).size(26.0).strong());
                        ui.add_space(3.0);
                        if !self.ready {
                            if self.pending.is_some() {
                                ui.horizontal_wrapped(|ui| {
                                    ui.spinner();
                                    ui.label(tr(italian, "Finding practice positions…", "Ricerca delle posizioni…"));
                                });
                            } else if ui.button(tr(italian, "Try again", "Riprova")).clicked() {
                                self.error.clear();
                                self.prepare_queue(ui.ctx(), platform);
                            }
                        } else if self.cards.is_empty() {
                            ui.label(tr(
                                italian,
                                "Review a game and choose your side under “Review as” to get practice positions.",
                                "Revisiona una partita e scegli il tuo colore in «Rivedi come» per ottenere esercizi.",
                            ));
                            ui.add_space(6.0);
                            if ui.add(appearance::primary(tr(italian, "Open library", "Apri archivio"))).clicked() {
                                return Some(TrainingAction::OpenLibrary);
                            }
                        } else if due.is_empty() {
                            ui.label(tr(italian, "You’re caught up. Positions return when they’re due for another try.", "Hai completato il ripasso. Le posizioni torneranno quando sarà il momento di riprovarle."));
                        } else {
                            let count = due.len().min(5);
                            let summary = match (italian, count) {
                                (true, 1) => "1 posizione nella prossima sessione".to_owned(),
                                (true, _) => format!("{count} posizioni nella prossima sessione"),
                                (false, 1) => "1 position in your next session".to_owned(),
                                (false, _) => format!("{count} positions in your next session"),
                            };
                            ui.label(summary);
                            ui.add_space(5.0);
                            if ui.add(appearance::primary(tr(italian, "Start session", "Inizia sessione"))).clicked() {
                                self.begin(mixed_training_session(due, 5));
                            }
                        }
                        None
                    },
                ).inner;
                if let Some(card) = preview {
                    board.show(ui, BoardView {
                        fen: &card.fen,
                        size: art_size,
                        flipped: card.result.color == Color::Black,
                        last: "",
                        best: "",
                        selected: None,
                        quality: None,
                        transition: None,
                        check: false,
                        mate: false,
                    });
                }
                action
            }).inner
        }).inner
    }

    fn progress_panel(&self, ui: &mut egui::Ui, italian: bool) {
        panel(ui, |ui| {
            ui.heading(tr(italian, "Progress over time", "Progressi nel tempo"));
            ui.add_space(4.0);
            let trends = practice_trends(&self.events);
            if trends.is_empty() {
                ui.label(tr(
                    italian,
                    "Complete a session to track how often you solve a position on the first try.",
                    "Completa una sessione per vedere quante posizioni risolvi al primo tentativo.",
                ));
            } else {
                ui.small(tr(
                    italian,
                    "Solved on the first try",
                    "Risolte al primo tentativo",
                ));
            }
            for trend in trends {
                ui.horizontal_wrapped(|ui| {
                    ui.strong(focus_name(trend.pattern, italian));
                    ui.small(format!("{}/{}", trend.recent, trend.recent_total));
                    if let Some(delta) = trend.delta {
                        ui.small(format!("{delta:+} pp"));
                    }
                });
                ui.add(
                    egui::ProgressBar::new(trend.recent as f32 / trend.recent_total as f32)
                        .fill(appearance::ACCENT)
                        .desired_height(5.0),
                );
                if trend.earlier_total > 0 {
                    ui.small(format!(
                        "{} {}/{}",
                        tr(italian, "Earlier", "Prima"),
                        trend.earlier,
                        trend.earlier_total
                    ));
                }
                ui.add_space(6.0);
            }
        });
    }
    fn exercise_heading(&self, ui: &mut egui::Ui, card: &TrainingCard, italian: bool) {
        let index = self.data.index + 1;
        let total = self.data.session.len();
        let completed = self.data.index
            + usize::from(matches!(
                self.data.state,
                PracticeState::Correct | PracticeState::Revealed
            ));
        ui.horizontal_wrapped(|ui| {
            ui.strong(focus_name(card.pattern, italian));
            ui.small(format!("{index} / {total}"));
        });
        ui.add(
            egui::ProgressBar::new(completed as f32 / total as f32)
                .fill(appearance::ACCENT)
                .desired_height(4.0),
        );
        ui.add_space(7.0);
        let state = self.data.state;
        ui.heading(match state {
            PracticeState::Checking => {
                tr(italian, "Checking your move…", "Controllo la tua mossa…")
            }
            PracticeState::Correct => tr(italian, "Well found!", "Ben trovato!"),
            PracticeState::Missed => tr(
                italian,
                "There is a better choice",
                "C’è una scelta migliore",
            ),
            PracticeState::Revealed => tr(italian, "The move to find", "La mossa da trovare"),
            _ => tr(italian, "Find a better move", "Trova una mossa migliore"),
        });
        ui.label(prompt(card.pattern, italian));
        ui.small(match card.result.color {
            Color::White => tr(italian, "Play as White", "Giochi con il Bianco"),
            Color::Black => tr(italian, "Play as Black", "Giochi con il Nero"),
        });
    }

    fn exercise(
        &mut self,
        ui: &mut egui::Ui,
        platform: &Platform,
        card: &TrainingCard,
        game: Option<&Game>,
        italian: bool,
    ) -> Option<TrainingAction> {
        let state = self.data.state;
        if state == PracticeState::Revealed
            && let Some(solution) = play_uci(&card.fen, &card.result.best)
        {
            ui.strong(&solution.san);
        }
        if state == PracticeState::Missed
            && let Some(reply) = self.data.reply.get(self.data.reply_index.unwrap_or(0))
        {
            ui.label(&reply.text);
            ui.horizontal_wrapped(|ui| {
                if ui
                    .button(tr(italian, "Play reply", "Mostra risposta"))
                    .clicked()
                {
                    let starting = self.data.reply_index.is_none();
                    let next = self
                        .data
                        .reply_index
                        .map_or(0, |index| (index + 1) % self.data.reply.len());
                    let step = &self.data.reply[next];
                    self.data.fen.clone_from(&step.fen);
                    self.data.r#move.clone_from(&step.r#move);
                    self.data.reply_index = Some(next);
                    self.motion = if next > 0 || starting {
                        Some(Instant::now())
                    } else {
                        None
                    };
                    self.dirty = true;
                }
                if self.data.reply_index.is_some()
                    && ui
                        .button(tr(italian, "Back to your move", "Torna alla tua mossa"))
                        .clicked()
                {
                    self.data.fen.clone_from(&self.data.reply[0].before_fen);
                    self.data.r#move.clone_from(&self.data.attempt);
                    self.data.reply_index = None;
                    self.motion = None;
                    self.dirty = true;
                }
            });
        }
        let mut action = None;
        ui.horizontal_wrapped(|ui| {
            if matches!(
                state,
                PracticeState::Ready | PracticeState::Error | PracticeState::Missed
            ) && ui
                .button(tr(italian, "Show solution", "Mostra soluzione"))
                .clicked()
            {
                self.reveal(ui.ctx(), platform, card);
            }
            if matches!(
                state,
                PracticeState::Missed | PracticeState::Revealed | PracticeState::Error
            ) && ui.button(tr(italian, "Try again", "Riprova")).clicked()
            {
                self.reset_board();
            }
            if matches!(
                state,
                PracticeState::Correct | PracticeState::Missed | PracticeState::Revealed
            ) {
                let label = if self.data.index + 1 == self.data.session.len() {
                    tr(italian, "Finish", "Termina")
                } else {
                    tr(italian, "Next position", "Prossima posizione")
                };
                if ui.add(appearance::primary(label)).clicked() {
                    self.advance();
                }
            }
            if ui
                .button(tr(
                    italian,
                    "Open source position",
                    "Apri posizione originale",
                ))
                .clicked()
            {
                action = Some(TrainingAction::OpenSource {
                    game_id: card.game_id.clone(),
                    ply: card.result.ply,
                });
            }
        });
        if let Some(game) = game {
            ui.collapsing(tr(italian, "Original game", "Partita originale"), |ui| {
                let header = |name| game.headers.get(name).map_or("?", String::as_str);
                ui.label(format!("{} — {}", header("White"), header("Black")));
                if matches!(state, PracticeState::Correct | PracticeState::Revealed) {
                    let coaching = review_coaching(
                        game,
                        &card.result,
                        CoachingOptions {
                            language: if italian {
                                CoachingLanguage::Italian
                            } else {
                                CoachingLanguage::English
                            },
                            player_color: Some(card.result.color),
                        },
                    );
                    if !coaching.text.is_empty() {
                        ui.label(coaching.text);
                    }
                    if !coaching.detail.is_empty() {
                        ui.label(coaching.detail);
                    }
                }
            });
        }
        action
    }

    fn recap(&mut self, ui: &mut egui::Ui, italian: bool) {
        let summary = summarize_training(&self.data.session, &self.data.outcomes, &self.history);
        panel(ui, |ui| {
            ui.label(
                RichText::new(tr(italian, "Training complete", "Allenamento completato"))
                    .size(25.0)
                    .strong(),
            );
            ui.add_space(12.0);
            ui.columns(3, |columns| {
                for (column, (value, label)) in columns.iter_mut().zip([
                    (
                        format!("{}/{}", summary.independent, summary.total),
                        tr(italian, "First try", "Al primo tentativo"),
                    ),
                    (
                        summary.retried.to_string(),
                        tr(italian, "After a retry", "Dopo un tentativo"),
                    ),
                    (
                        summary.assisted.to_string(),
                        tr(italian, "Solution shown", "Soluzione mostrata"),
                    ),
                ]) {
                    column.label(RichText::new(value).size(24.0).strong());
                    column.label(label);
                }
            });
        });
        if summary.next_due > 0 || !summary.retry.is_empty() {
            ui.add_space(12.0);
            panel(ui, |ui| self.recap_followup(ui, italian, summary));
        }
    }

    fn recap_followup(
        &mut self,
        ui: &mut egui::Ui,
        italian: bool,
        summary: chessash_review_core::TrainingSummary,
    ) {
        if !summary.retry.is_empty() {
            ui.strong(tr(italian, "What to revisit", "Da ripassare"));
            for card in &summary.retry {
                ui.label(focus_name(card.pattern, italian));
            }
        }
        if summary.next_due > 0 {
            let seconds = summary.next_due.saturating_sub(now()) / 1000;
            let minutes = seconds.div_ceil(60);
            if minutes == 0 {
                ui.label(tr(
                    italian,
                    "Positions are ready for another try.",
                    "Ci sono posizioni pronte per riprovare.",
                ));
            } else if minutes < 60 {
                ui.label(format!(
                    "{} · {minutes} min",
                    tr(italian, "Next practice", "Prossimo ripasso")
                ));
            } else {
                ui.label(format!(
                    "{} · {} h",
                    tr(italian, "Next practice", "Prossimo ripasso"),
                    minutes.div_ceil(60)
                ));
            }
        }
        if !summary.retry.is_empty()
            && ui
                .add(appearance::primary(tr(
                    italian,
                    "Practice these again",
                    "Riprova queste posizioni",
                )))
                .clicked()
        {
            self.begin(summary.retry);
        }
    }
}

impl Drop for Training {
    fn drop(&mut self) {
        self.abort();
    }
}

fn setting(store: Option<&Store>, key: &str) -> Option<String> {
    store.and_then(|store| store.local_setting(key).ok().flatten())
}

fn panel<T>(ui: &mut egui::Ui, content: impl FnOnce(&mut egui::Ui) -> T) -> T {
    appearance::panel(ui)
        .inner_margin(16)
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            content(ui)
        })
        .inner
}

fn training_policy(
    platform: &Platform,
) -> impl Fn(&[TrainingPolicyFact]) -> Result<Vec<TrainingDecision>, String> + Send + use<> {
    let foxash = Foxash::new(
        platform::executable(&platform.engines, "foxash"),
        platform.data.join("foxash"),
    );
    move |facts| {
        foxash
            .training_decisions(facts)
            .map_err(|error| error.to_string())
    }
}

fn square_name(index: usize) -> String {
    format!("{}{}", char::from(b'a' + (index % 8) as u8), 8 - index / 8)
}

fn tr<'a>(italian: bool, en: &'a str, it: &'a str) -> &'a str {
    if italian { it } else { en }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn focus_name(pattern: TrainingFocus, italian: bool) -> &'static str {
    let (en, it) = match pattern {
        TrainingFocus::Capture => ("Capture opportunities", "Occasioni di cattura"),
        TrainingFocus::Check => ("Finding checks", "Scacchi da trovare"),
        TrainingFocus::Reply => ("Opponent replies", "Risposte avversarie"),
        TrainingFocus::Improve => ("Better choices", "Scelte da migliorare"),
        TrainingFocus::Undefended => ("Undefended pieces", "Pezzi indifesi"),
        TrainingFocus::Fork => ("Forks", "Attacchi doppi"),
        TrainingFocus::Backrank => ("Back-rank mates", "Matto sull’ultima traversa"),
    };
    tr(italian, en, it)
}

fn prompt(pattern: TrainingFocus, italian: bool) -> &'static str {
    let (en, it) = match pattern {
        TrainingFocus::Capture => (
            "Compare the available captures before choosing.",
            "Confronta le catture disponibili prima di scegliere.",
        ),
        TrainingFocus::Check => (
            "Look for a check and consider the king’s replies.",
            "Cerca uno scacco e controlla le risposte del re.",
        ),
        TrainingFocus::Reply => (
            "Check your opponent’s checks and captures before deciding.",
            "Controlla gli scacchi e le catture del tuo avversario prima di decidere.",
        ),
        TrainingFocus::Improve => (
            "Compare your candidate moves and the opponent’s replies.",
            "Confronta le tue mosse candidate e le risposte avversarie.",
        ),
        TrainingFocus::Undefended => (
            "Check which pieces are undefended before choosing.",
            "Controlla quali pezzi sono senza difesa prima di scegliere.",
        ),
        TrainingFocus::Fork => (
            "Look for a move that attacks two pieces at once.",
            "Cerca una mossa che attacchi due pezzi contemporaneamente.",
        ),
        TrainingFocus::Backrank => (
            "Check the back-rank checks and the king’s escape squares.",
            "Controlla gli scacchi sull’ultima traversa e le vie di fuga del re.",
        ),
    };
    tr(italian, en, it)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chessash_review_core::{
        Label, MoveReview, Perspective, Review, TrainingEvidence, parse_pgn,
    };

    fn fixture() -> Game {
        let mut game = parse_pgn("1. f3 e5 2. g4 Qh4# 0-1", "PGN").unwrap();
        game.review_as = Some(Perspective::White);
        game.review = Some(Review {
            version: 2,
            engine: "fixture".into(),
            depth: 14,
            results: vec![MoveReview {
                ply: 3,
                r#move: "g2g4".into(),
                san: Some("g4".into()),
                color: Color::White,
                before: 0,
                after: -29800,
                loss: 29800,
                label: Label::Blunder,
                best: "b1c3".into(),
                pv: vec![],
                depth: 14,
                explanation: String::new(),
                hints: vec![],
                key: true,
                facts: None,
                mate: Some(-2),
                consequence_of: None,
                reply_pv: Some(vec!["d8h4".into()]),
                sacrifice_evidence: None,
            }],
            completed: true,
            created_at: None,
        });
        game
    }

    #[test]
    fn revealed_training_is_saved_and_restored_for_selected_pgn_sides() {
        let mut store = Store::open(":memory:").unwrap();
        let cards = training_cards(&[fixture()], "");
        let mut training = Training::default();
        training.key = training_storage_key("");
        training.begin(cards.clone());
        training.remember(false, true, 600, vec![]);
        training.flush(Some(&mut store)).unwrap();
        let session_key = format!("{}:session", training.key);
        let stored = store.local_setting(&session_key).unwrap().unwrap();
        let resumed = restore_training(&stored, &cards, "en").unwrap();
        assert_eq!(resumed.state, PracticeState::Revealed);
        assert!(resumed.outcomes[&cards[0].id].assisted);
        assert_eq!(resumed.r#move, "b1c3");
        training.advance();
        training.flush(Some(&mut store)).unwrap();
        assert!(store.local_setting(&session_key).unwrap().is_none());
        let events = store
            .local_setting(&format!("{}:events", training.key))
            .unwrap()
            .unwrap();
        assert!(parse_practice_events(&events)[0].assisted);
    }

    #[test]
    fn board_selection_submits_legal_uci() {
        let mut training = Training::default();
        let card = training_cards(&[fixture()], "").pop().unwrap();
        assert_eq!(training.choose_square(&card, 57), None);
        assert_eq!(training.choose_square(&card, 42), Some("b1c3".into()));
    }

    #[cfg(windows)]
    #[test]
    fn foxash_training_bridge_matches_native_decisions_when_installed() {
        let platform = Platform::new();
        if !platform::executable(&platform.engines, "foxash").is_file() {
            return;
        }
        let facts = [
            TrainingPolicyFact {
                evidence: TrainingEvidence {
                    fork: true,
                    ..Default::default()
                },
                attempts: 1,
                passed: true,
                ..Default::default()
            },
            TrainingPolicyFact {
                evidence: TrainingEvidence {
                    best_capture: true,
                    ..Default::default()
                },
                loss: 200,
                ..Default::default()
            },
        ];
        assert_eq!(
            training_policy(&platform)(&facts).unwrap(),
            chessash_review_core::default_training_decisions(&facts)
        );
    }
}
