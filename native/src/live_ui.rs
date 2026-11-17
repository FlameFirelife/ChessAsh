use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use chessash_persistence::Store;
use chessash_review_core::{Game, Review};
use shakmaty::Outcome;

use super::{Preferences, player_strip, quality, quality_icon, soft_panel};
use crate::live_game::LiveGame;
use crate::{
    appearance,
    audio::MoveSound,
    board::{self, Board, BoardView, Transition},
    platform::{self, Platform},
};
use chessash_review_core::{Perspective, QualityNames, parse_fen, play_uci};
use chessash_review_engine::{
    AnalyzeOptions, CoachingLanguage, CoachingOptions, Foxash, UciEngine, analyze_live_game,
    review_coaching,
};
use eframe::egui::{self, RichText, Vec2};
use shakmaty::Position;
use std::sync::mpsc::Receiver;

#[derive(Default)]
pub(super) struct LiveUi {
    white: String,
    black: String,
    session: Option<Session>,
    confirm_reset: bool,
    save_error: Option<String>,
}

pub(super) struct View<'a> {
    pub board: &'a Board,
    pub platform: &'a Platform,
    pub sound: &'a mut MoveSound,
    pub prefs: &'a Preferences,
    pub italian: bool,
    pub mobile: bool,
    pub store: Option<&'a Store>,
}

pub(super) enum Action {
    Save(Game),
    OpenLibrary,
}

struct Worker {
    games: mpsc::Sender<Game>,
    reviews: Receiver<Result<Review, String>>,
    cancelled: Arc<AtomicBool>,
}

impl Worker {
    fn new(view: &View<'_>, ctx: &egui::Context) -> Self {
        let (games, incoming) = mpsc::channel();
        let (results, reviews) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel = cancelled.clone();
        let engine_path = platform::executable(&view.platform.engines, "stockfish");
        let policy_path = platform::executable(&view.platform.engines, "foxash");
        let scratch = view.platform.data.join("foxash");
        let depth = view.prefs.depth;
        let pack: chessash_review_engine::CoachingPack = view
            .store
            .and_then(|store| store.coaching_pack().ok().flatten())
            .and_then(|pack| serde_json::from_value(pack).ok())
            .unwrap_or_default();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let mut engine = UciEngine::new(engine_path);
            let policy = Foxash::new(policy_path, scratch);
            let mut existing = None;
            while let Ok(mut game) = incoming.recv() {
                while let Ok(newer) = incoming.try_recv() {
                    game = newer;
                }
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let result = analyze_live_game(
                    &mut engine,
                    &policy,
                    &game,
                    AnalyzeOptions {
                        depth,
                        pack: pack.clone(),
                        existing: existing.as_ref(),
                        cancel: Some(&cancel),
                        ..Default::default()
                    },
                    |_| {},
                )
                .map_err(|error| error.to_string());
                if let Ok(review) = &result {
                    existing = Some(review.clone());
                }
                if results.send(result).is_err() {
                    break;
                }
                ctx.request_repaint();
            }
        });
        Self {
            games,
            reviews,
            cancelled,
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

struct Session {
    live: LiveGame,
    worker: Worker,
    review: Option<Review>,
    error: Option<String>,
    selected: Option<usize>,
    promotion: Option<String>,
    motion: Option<(Instant, Option<(char, usize)>)>,
    flipped: bool,
    saved: Option<(usize, usize)>,
    inspect: Option<usize>,
}

impl LiveUi {
    pub(super) fn receive(&mut self) {
        if let Some(session) = &mut self.session {
            loop {
                match session.worker.reviews.try_recv() {
                    Ok(Ok(review)) => {
                        session.error = None;
                        session.review = Some(review);
                    }
                    Ok(Err(error)) => session.error = Some(error),
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        session
                            .error
                            .get_or_insert_with(|| "Live review stopped.".into());
                        break;
                    }
                }
            }
        }
    }

    pub(super) fn saved(&mut self) {
        if let Some(session) = &mut self.session {
            session.saved = Some(session.revision());
        }
        self.save_error = None;
    }

    pub(super) fn save_error(&mut self, error: String) {
        self.save_error = Some(error);
    }

    pub(super) fn show(&mut self, ui: &mut egui::Ui, mut view: View<'_>) -> Option<Action> {
        let italian = view.italian;
        let tr = |en, it| if italian { it } else { en };
        let mut action = None;
        if let Some(session) = &mut self.session {
            ui.horizontal_wrapped(|ui| {
                ui.label(
                    RichText::new(tr("Live game", "Partita dal vivo"))
                        .size(25.0)
                        .strong(),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button(tr("New game", "Nuova partita")).clicked() {
                        self.confirm_reset = true;
                    }
                });
            });
            ui.add_space(5.0);
            ui.horizontal_wrapped(|ui| {
                let revision = session.revision();
                let needs_save = revision.0 > 0 && session.saved != Some(revision);
                if ui
                    .add_enabled(
                        needs_save,
                        appearance::primary(tr("Save to Library", "Salva nell’archivio")),
                    )
                    .clicked()
                {
                    match session.library_game() {
                        Ok(game) => action = Some(Action::Save(game)),
                        Err(error) => self.save_error = Some(error),
                    }
                }
                if session.saved.is_some()
                    && ui.button(tr("Open Library", "Apri archivio")).clicked()
                {
                    action = Some(Action::OpenLibrary);
                }
                if session.saved == Some(revision) {
                    ui.small(tr(
                        "Saved in PGN files and samples",
                        "Salvata in File PGN ed esempi",
                    ));
                }
            });
            if let Some(error) = &self.save_error {
                ui.colored_label(ui.visuals().error_fg_color, error);
            }
            ui.add_space(10.0);
            session.show(ui, &mut view);
            if self.confirm_reset {
                let unsaved = session.revision().0 > session.saved.map_or(0, |saved| saved.0);
                if unsaved {
                    egui::Modal::new(egui::Id::new("discard-live-game")).show(ui.ctx(), |ui| {
                        ui.label(tr(
                            "Start a new game and discard unsaved moves?",
                            "Iniziare una nuova partita e perdere le mosse non salvate?",
                        ));
                        ui.horizontal(|ui| {
                            if ui
                                .button(tr("Keep playing", "Continua a giocare"))
                                .clicked()
                            {
                                self.confirm_reset = false;
                            }
                            if ui
                                .button(tr("Start new game", "Inizia nuova partita"))
                                .clicked()
                            {
                                self.session = None;
                                self.confirm_reset = false;
                            }
                        });
                    });
                } else {
                    self.session = None;
                    self.confirm_reset = false;
                }
            }
        } else {
            ui.vertical_centered(|ui| {
                ui.add_space(if view.mobile { 15.0 } else { 48.0 });
                let width = ui.available_width().min(430.0);
                ui.allocate_ui_with_layout(
                    Vec2::new(width, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        soft_panel(ui, 20).show(ui, |ui| {
                            ui.set_width((width - 40.0).max(0.0));
                            ui.label(
                                RichText::new(tr("Play a live game", "Gioca una partita dal vivo"))
                                    .size(26.0)
                                    .strong(),
                            );
                            ui.label(tr(
                                "Play both sides and get a review after each move.",
                                "Gioca con entrambi i colori e ricevi un’analisi dopo ogni mossa.",
                            ));
                            ui.add_space(12.0);
                            appearance::field_style(ui);
                            ui.label(tr("White player", "Giocatore del Bianco"));
                            ui.add(
                                egui::TextEdit::singleline(&mut self.white)
                                    .hint_text(tr("White", "Bianco"))
                                    .char_limit(80)
                                    .desired_width(f32::INFINITY),
                            );
                            ui.add_space(6.0);
                            ui.label(tr("Black player", "Giocatore del Nero"));
                            ui.add(
                                egui::TextEdit::singleline(&mut self.black)
                                    .hint_text(tr("Black", "Nero"))
                                    .char_limit(80)
                                    .desired_width(f32::INFINITY),
                            );
                            ui.add_space(12.0);
                            if ui
                                .add(
                                    appearance::primary(tr("Start game", "Inizia partita"))
                                        .min_size(Vec2::new(ui.available_width(), 40.0)),
                                )
                                .clicked()
                            {
                                let white = if self.white.trim().is_empty() {
                                    tr("White", "Bianco")
                                } else {
                                    &self.white
                                };
                                let black = if self.black.trim().is_empty() {
                                    tr("Black", "Nero")
                                } else {
                                    &self.black
                                };
                                self.session = Some(Session {
                                    live: LiveGame::new(white, black),
                                    worker: Worker::new(&view, ui.ctx()),
                                    review: None,
                                    error: None,
                                    selected: None,
                                    promotion: None,
                                    motion: None,
                                    flipped: false,
                                    saved: None,
                                    inspect: None,
                                });
                                self.save_error = None;
                            }
                        });
                    },
                );
            });
        }
        action
    }
}

impl Session {
    fn revision(&self) -> (usize, usize) {
        (
            self.live.game().moves.len(),
            self.review
                .as_ref()
                .map_or(0, |review| review.results.len()),
        )
    }

    fn library_game(&self) -> Result<Game, String> {
        let mut game = self
            .live
            .library_game()
            .map_err(|error| error.to_string())?;
        game.review = self.review.clone().map(|mut review| {
            review.completed = review.results.len() == game.moves.len();
            review
        });
        game.last_ply = Some(game.moves.len());
        game.review_as = Some(Perspective::Neutral);
        Ok(game)
    }

    fn queue_review(&mut self) {
        self.error = None;
        if self.worker.games.send(self.live.game().clone()).is_err() {
            self.error = Some("Live review stopped.".into());
        }
    }

    fn play(&mut self, uci: &str, view: &mut View<'_>) {
        let fen = self.live.game().positions.last().expect("live position");
        let captured = board::captured_piece(fen, uci);
        if self.live.play(uci) {
            self.selected = None;
            self.motion = Some((Instant::now(), captured));
            if view.prefs.sound {
                view.sound.play(view.platform);
            }
            self.queue_review();
        }
    }

    fn click(&mut self, square: usize, view: &mut View<'_>) {
        let fen = self.live.game().positions.last().expect("live position");
        let white = self.live.position().turn() == shakmaty::Color::White;
        let pieces = board::placement(fen);
        if let Some(from) = self.selected.take() {
            if from == square {
                return;
            }
            let uci = format!("{}{}", board::coordinate(from), board::coordinate(square));
            if pieces[from].is_some_and(|piece| piece.eq_ignore_ascii_case(&'p'))
                && !(8..56).contains(&square)
                && play_uci(fen, &format!("{uci}q")).is_some()
            {
                self.promotion = Some(uci);
                return;
            }
            if play_uci(fen, &uci).is_some() {
                self.play(&uci, view);
                return;
            }
        }
        if pieces[square].is_some_and(|piece| piece.is_ascii_uppercase() == white) {
            self.selected = Some(square);
        }
    }

    fn show(&mut self, ui: &mut egui::Ui, view: &mut View<'_>) {
        let italian = view.italian;
        let tr = |en, it| if italian { it } else { en };
        let wide = !view.mobile && ui.available_width() >= 660.0;
        let max = (ui.ctx().content_rect().height() - 272.0).clamp(250.0, 570.0);
        if wide {
            let size = (ui.available_width() * 0.58).min(max);
            ui.horizontal_top(|ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(size, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(size);
                        self.board(ui, view, size);
                    },
                );
                ui.add_space(12.0);
                ui.vertical(|ui| self.feedback(ui, view));
            });
        } else {
            let size = ui.available_width().min(max);
            ui.vertical_centered(|ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(size, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(size);
                        self.board(ui, view, size);
                    },
                );
            });
            self.feedback(ui, view);
        }
        if let Some(uci) = self.promotion.clone() {
            egui::Modal::new(egui::Id::new("live-promotion")).show(ui.ctx(), |ui| {
                ui.strong(tr("Promote pawn", "Promuovi il pedone"));
                for (role, name) in [
                    ('q', tr("Queen", "Donna")),
                    ('r', tr("Rook", "Torre")),
                    ('b', tr("Bishop", "Alfiere")),
                    ('n', tr("Knight", "Cavallo")),
                ] {
                    if ui.button(name).clicked() {
                        self.play(&format!("{uci}{role}"), view);
                        self.promotion = None;
                    }
                }
                if ui.button(tr("Cancel", "Annulla")).clicked() {
                    self.promotion = None;
                }
            });
        }
    }

    fn board(&mut self, ui: &mut egui::Ui, view: &mut View<'_>, size: f32) {
        let italian = view.italian;
        let tr = |en, it| if italian { it } else { en };
        let game = self.live.game();
        let ply = self.inspect.unwrap_or(game.moves.len());
        let fen = &game.positions[ply];
        let position = parse_fen(fen).expect("live position");
        let turn_white = position.turn() == shakmaty::Color::White;
        let playing = self.inspect.is_none() && self.live.outcome() == Outcome::Unknown;
        let name = |white| &game.headers[if white { "White" } else { "Black" }];
        let turn = |white| {
            if playing && white == turn_white {
                tr("To move", "Al tratto")
            } else {
                ""
            }
        };
        player_strip(
            ui,
            name(self.flipped),
            self.flipped,
            turn(self.flipped),
            view.mobile,
        );
        let last = ply
            .checked_sub(1)
            .and_then(|index| game.uci_moves.get(index))
            .map_or("", String::as_str);
        let badge = self
            .review
            .as_ref()
            .and_then(|review| review.results.get(ply.wrapping_sub(1)))
            .map(|row| quality(row.label));
        let motion = self
            .motion
            .as_ref()
            .filter(|_| self.inspect.is_none() && !view.prefs.reduced);
        let elapsed = motion.map_or(1.0, |(start, _)| start.elapsed().as_secs_f32());
        let transition = (elapsed < 0.33).then_some(Transition {
            uci: last,
            progress: elapsed / 0.33,
            reverse: false,
            fast: false,
        });
        if transition.is_some() {
            ui.ctx().request_repaint_after(Duration::from_millis(16));
        }
        let selected = view.board.show_with_layers(
            ui,
            BoardView {
                fen,
                size,
                flipped: self.flipped,
                last,
                best: "",
                selected: self.selected,
                quality: badge,
                transition,
                check: position.is_check(),
                mate: position.is_checkmate(),
            },
            |ui, rect| {
                if let Some((_, Some((piece, square)))) = motion.filter(|_| elapsed < 0.33) {
                    view.board
                        .capture(ui, rect, *piece, *square, self.flipped, elapsed);
                }
            },
            |_, _| {},
        );
        player_strip(
            ui,
            name(!self.flipped),
            !self.flipped,
            turn(!self.flipped),
            view.mobile,
        );
        ui.horizontal_wrapped(|ui| {
            if ui.button(tr("Flip board", "Ruota scacchiera")).clicked() {
                self.flipped = !self.flipped;
            }
            if self.inspect.is_some()
                && ui
                    .button(tr("Return to live game", "Torna alla partita"))
                    .clicked()
            {
                self.inspect = None;
            }
        });
        if playing
            && self.promotion.is_none()
            && let Some(square) = selected
        {
            self.click(square, view);
        }
    }

    fn feedback(&mut self, ui: &mut egui::Ui, view: &View<'_>) {
        let italian = view.italian;
        let tr = |en, it| if italian { it } else { en };
        let game = self.live.game();
        let ply = self.inspect.unwrap_or(game.moves.len());
        if let Outcome::Known(outcome) = self.live.outcome() {
            let result = match outcome {
                shakmaty::KnownOutcome::Decisive {
                    winner: shakmaty::Color::White,
                } => tr("White wins", "Il Bianco vince"),
                shakmaty::KnownOutcome::Decisive {
                    winner: shakmaty::Color::Black,
                } => tr("Black wins", "Il Nero vince"),
                shakmaty::KnownOutcome::Draw => tr("Draw", "Patta"),
            };
            ui.label(RichText::new(result).size(19.0).strong());
        }
        soft_panel(ui, 13).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.strong(tr("Live review", "Analisi dal vivo"));
            if let Some(row) = self
                .review
                .as_ref()
                .and_then(|review| review.results.get(ply.wrapping_sub(1)))
            {
                let names = if view.prefs.quality_names == "chesscom" {
                    QualityNames::ChessCom
                } else {
                    QualityNames::ChessAsh
                };
                ui.horizontal_wrapped(|ui| {
                    quality_icon(ui, row.label, ui.visuals().text_color());
                    ui.strong(format!(
                        "{} · {}",
                        game.moves[ply - 1],
                        row.label.name(names)
                    ));
                    let score = row.mate.map_or_else(
                        || format!("{:+.2}", row.after as f32 / 100.0),
                        |mate| format!("M{mate:+}"),
                    );
                    ui.label(RichText::new(score).monospace()).on_hover_text(tr(
                        "Evaluation from White’s side",
                        "Valutazione dal punto di vista del Bianco",
                    ));
                });
                let coaching = review_coaching(
                    game,
                    row,
                    CoachingOptions {
                        language: if view.italian {
                            CoachingLanguage::Italian
                        } else {
                            CoachingLanguage::English
                        },
                        ..Default::default()
                    },
                );
                ui.label(coaching.text);
                if !coaching.best.is_empty() {
                    ui.label(coaching.best);
                }
                if !coaching.detail.is_empty() {
                    ui.collapsing(tr("Full explanation", "Spiegazione completa"), |ui| {
                        ui.label(coaching.detail);
                    });
                }
            } else if ply == 0 {
                ui.label(tr(
                    "Make a move to see its review.",
                    "Fai una mossa per vedere l’analisi.",
                ));
            } else if let Some(error) = &self.error {
                ui.colored_label(ui.visuals().error_fg_color, error);
                if ui.button(tr("Retry review", "Riprova analisi")).clicked() {
                    if self.worker.games.send(game.clone()).is_ok() {
                        self.error = None;
                    }
                }
            } else {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(tr("Reviewing move…", "Analisi della mossa…"));
                });
            }
        });
        if !game.moves.is_empty() {
            ui.collapsing(tr("Moves", "Mosse"), |ui| {
                egui::ScrollArea::vertical()
                    .id_salt("live-moves")
                    .max_height(170.0)
                    .show(ui, |ui| {
                        for (turn, moves) in game.moves.chunks(2).enumerate() {
                            ui.horizontal(|ui| {
                                ui.monospace(format!("{:>3}.", turn + 1));
                                for (offset, san) in moves.iter().enumerate() {
                                    let index = turn * 2 + offset + 1;
                                    if ui.selectable_label(ply == index, san).clicked() {
                                        self.selected = None;
                                        self.inspect = (index < game.moves.len()).then_some(index);
                                    }
                                }
                            });
                        }
                    });
            });
        }
    }
}
