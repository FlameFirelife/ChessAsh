use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    time::Instant,
};

use chessash_persistence::{LegacyBackup, Store};
use chessash_review_core::{
    Color, Game, INITIAL_FEN, Label, MoveReview, Perspective, QualityNames, Review, accuracy,
    parse_fen, parse_pgn, parse_pgn_collection, play_uci,
};
use chessash_review_engine::{
    AnalyzeOptions, CoachingLanguage, CoachingOptions, Foxash, UciEngine, analyze_game,
    review_coaching,
};
use eframe::egui::{self, Color32, RichText, Vec2};
use serde::{Deserialize, Serialize};
use shakmaty::Position;

#[path = "live_ui.rs"]
mod live_ui;

use crate::{
    accounts::{self, Account, Library, Sync},
    appearance::{self, ACCENT, Art, BLUE, COACH, COACH_INK, Icon},
    audio::MoveSound,
    board::{self, Board, BoardView, Transition},
    card,
    import::{self, Provider},
    platform::{self, Platform},
};

#[derive(PartialEq)]
enum Screen {
    Review,
    Library,
    Training,
    Play,
}

#[derive(Clone, Copy, Default, PartialEq)]
enum ReviewTab {
    #[default]
    Review,
    Explore,
    #[cfg(windows)]
    Tutor,
}

#[derive(Clone, Copy, PartialEq)]
enum Dialog {
    Import,
    Settings,
    Share,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    quality_names: String,
    depth: usize,
    theme: String,
    reduced: bool,
    sound: bool,
    font: f32,
    arrows: bool,
    graph: bool,
    advanced: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            quality_names: "chessash".into(),
            depth: 12,
            theme: "dark".into(),
            reduced: false,
            sound: false,
            font: 16.0,
            arrows: true,
            graph: false,
            advanced: false,
        }
    }
}

enum Event {
    Move(MoveReview),
    Review(Result<Review, String>),
    Import(Result<Vec<Game>, String>, bool, Option<Account>),
    Position(Result<chessash_review_core::EngineResult, String>),
    Variation(Result<(Game, MoveReview), String>),
}

struct Motion {
    start: Instant,
    fast: bool,
    uci: String,
    reverse: bool,
    duration: f32,
    captured: Option<(char, usize)>,
}

type FileRead = Receiver<Result<Vec<u8>, String>>;

pub struct ChessAsh {
    platform: Platform,
    store: Option<Store>,
    board: Board,
    art: Art,
    sound: MoveSound,
    screen: Screen,
    tab: ReviewTab,
    quality_filter: Option<Label>,
    short_review: bool,
    position_result: Option<chessash_review_core::EngineResult>,
    variation_review: Option<(Game, MoveReview)>,
    dialog: Option<Dialog>,
    games: Vec<Game>,
    game: Option<Game>,
    ply: usize,
    flipped: bool,
    coach_square: Option<String>,
    prefs: Preferences,
    italian: bool,
    message: String,
    pgn: String,
    username: String,
    link: String,
    provider: Provider,
    months: usize,
    import_as_main: bool,
    library: Library,
    main_account: Option<Account>,
    sync: Sync,
    syncing: bool,
    note: String,
    side: Option<usize>,
    variation: Vec<String>,
    preview: Option<(Vec<String>, Vec<String>, usize)>,
    motion: Option<Motion>,
    last_step: Option<Instant>,
    card_kind: card::Kind,
    card_index: usize,
    card_names: bool,
    latest: Vec<MoveReview>,
    events: Option<Receiver<Event>>,
    cancel: Option<Arc<AtomicBool>>,
    pending_file: Option<(bool, FileRead)>,
    confirm_delete: Option<String>,
    last_save: Option<Instant>,
    #[cfg(target_os = "android")]
    migration_poll: bool,
    #[cfg(windows)]
    tutor: crate::tutor::Tutor,
    training: crate::training_ui::Training,
    live: live_ui::LiveUi,
}

impl ChessAsh {
    pub fn new(cc: &eframe::CreationContext<'_>, platform: Platform) -> Self {
        let result = std::fs::create_dir_all(&platform.data)
            .map_err(|error| error.to_string())
            .and_then(|_| {
                Store::open(platform.data.join("data.sqlite3")).map_err(|error| error.to_string())
            });
        let mut message = String::new();
        let store = match result {
            Ok(store) => Some(store),
            Err(error) => {
                message = error;
                None
            }
        };
        #[cfg(windows)]
        let store = {
            let mut store = store;
            if let Some(store) = &mut store {
                match store.import_staged(&platform.data) {
                    Ok(Some(_)) => {
                        if let Some(profile) = crate::windows_upgrade::legacy_profile()
                            && let Err(error) = store.import_windows_tutor_credential(&profile)
                        {
                            message = error.to_string();
                        }
                    }
                    Ok(None) => {}
                    Err(error) => message = error.to_string(),
                }
            }
            store
        };
        let setting = |key| {
            store
                .as_ref()
                .and_then(|store| store.local_setting(key).ok().flatten())
        };
        let mut games = store
            .as_ref()
            .and_then(|store| store.games().ok())
            .unwrap_or_default();
        accounts::sort_games(&mut games);
        let main_account = setting(accounts::MAIN_KEY).and_then(|key| Account::from_key(&key));
        let sync = Sync::restored(
            sync_times(store.as_ref())
                .get(main_account.as_ref().map_or("", Account::key))
                .copied()
                .unwrap_or_default(),
        );
        let active = setting("chessash:active");
        let prefs: Preferences = setting("chessash:prefs")
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let italian = setting("chessash:language").as_deref() == Some("it");
        let provider = if setting("chessash:import-provider").as_deref() == Some("lichess") {
            Provider::Lichess
        } else {
            Provider::ChessCom
        };
        let username = setting("chessash:username").unwrap_or_default();
        let game = active
            .and_then(|id| games.iter().find(|game| game.id == id))
            .or_else(|| games.first())
            .cloned();
        appearance::style(&cc.egui_ctx, prefs.theme == "light", prefs.font);
        #[cfg(windows)]
        let tutor = crate::tutor::Tutor::new(store.as_ref());
        let mut app = Self {
            platform,
            store,
            board: Board::new(&cc.egui_ctx),
            art: Art::new(&cc.egui_ctx),
            sound: MoveSound::new(),
            screen: Screen::Review,
            tab: ReviewTab::Review,
            quality_filter: None,
            short_review: true,
            position_result: None,
            variation_review: None,
            dialog: None,
            games,
            game: None,
            ply: 0,
            flipped: false,
            coach_square: None,
            prefs,
            italian,
            message,
            pgn: String::new(),
            username,
            link: String::new(),
            provider,
            months: 3,
            import_as_main: false,
            library: Default::default(),
            main_account,
            sync,
            syncing: false,
            note: String::new(),
            side: None,
            variation: vec![],
            preview: None,
            motion: None,
            last_step: None,
            card_kind: Default::default(),
            card_index: 0,
            card_names: false,
            latest: vec![],
            events: None,
            cancel: None,
            pending_file: None,
            confirm_delete: None,
            last_save: None,
            #[cfg(target_os = "android")]
            migration_poll: false,
            #[cfg(windows)]
            tutor,
            training: Default::default(),
            live: Default::default(),
        };
        if let Some(game) = game {
            app.select(game);
        }
        #[cfg(all(windows, feature = "visual-qa"))]
        if std::env::var("CHESSASH_QA_SCREEN").as_deref() == Ok("training") {
            app.screen = Screen::Training;
        }
        #[cfg(target_os = "android")]
        if app.platform.legacy_migration_pending()
            || app
                .platform
                .data
                .join(chessash_persistence::LEGACY_SNAPSHOT_NAME)
                .exists()
        {
            app.migration_poll = true;
        }
        app
    }

    fn tr<'a>(&self, english: &'a str, italian: &'a str) -> &'a str {
        if self.italian { italian } else { english }
    }

    fn names(&self) -> QualityNames {
        if self.prefs.quality_names == "chesscom" {
            QualityNames::ChessCom
        } else {
            QualityNames::ChessAsh
        }
    }

    fn select(&mut self, game: Game) {
        self.persist();
        self.ply = game.last_ply.unwrap_or(0).min(game.moves.len());
        self.flipped = chessash_review_core::player_color_for(
            &game,
            self.main_account.as_ref().map_or("", Account::key),
        ) == Some(Color::Black);
        self.coach_square = None;
        self.note = game
            .notes
            .as_ref()
            .and_then(|notes| notes.get(&self.ply))
            .cloned()
            .unwrap_or_default();
        self.set_setting("chessash:active", &game.id);
        self.game = Some(game);
        self.latest.clear();
        self.side = None;
        self.variation.clear();
        self.preview = None;
        self.position_result = None;
        self.variation_review = None;
        self.quality_filter = None;
        self.motion = None;
        self.screen = Screen::Review;
    }

    fn set_setting(&mut self, key: &str, value: &str) {
        if let Some(store) = &mut self.store
            && let Err(error) = store.set_local_setting(key, value)
        {
            self.message = error.to_string();
        }
    }

    fn persist(&mut self) {
        let Some(game) = &self.game else { return };
        if let Some(store) = &mut self.store
            && let Err(error) = store.save_game(game)
        {
            self.message = error.to_string();
        }
        if let Some(item) = self.games.iter_mut().find(|item| item.id == game.id) {
            *item = game.clone();
        }
    }

    fn set_ply(&mut self, new: usize) {
        let Some(game) = &mut self.game else { return };
        let new = new.min(game.moves.len());
        if new == self.ply && self.variation.is_empty() {
            return;
        }
        let mut uci = String::new();
        if self.ply.abs_diff(new) == 1 && self.variation.is_empty() {
            let index = self.ply.max(new) - 1;
            uci = game
                .uci_moves
                .get(index)
                .or_else(|| {
                    game.review
                        .as_ref()?
                        .results
                        .get(index)
                        .map(|row| &row.r#move)
                })
                .cloned()
                .unwrap_or_default();
        }
        self.animate(uci, new < self.ply);
        self.ply = new;
        self.coach_square = None;
        self.variation.clear();
        self.preview = None;
        self.side = None;
        if let Some(game) = &mut self.game {
            game.last_ply = Some(new);
            self.note = game
                .notes
                .as_ref()
                .and_then(|notes| notes.get(&new))
                .cloned()
                .unwrap_or_default();
        }
        self.last_save = Some(Instant::now());
    }

    fn animate(&mut self, uci: String, reverse: bool) {
        self.position_result = None;
        self.variation_review = None;
        let interval = self
            .last_step
            .map(|last| last.elapsed().as_secs_f32())
            .unwrap_or(1.0);
        let fast = interval < 0.21;
        let captured = if reverse {
            None
        } else {
            self.variation
                .last()
                .or_else(|| self.game.as_ref()?.positions.get(self.ply))
                .and_then(|fen| board::captured_piece(fen, &uci))
        };
        self.motion = Some(Motion {
            start: Instant::now(),
            fast,
            uci,
            reverse,
            duration: if fast {
                (interval + 0.075).clamp(0.15, 0.23)
            } else {
                0.33
            },
            captured,
        });
        self.last_step = Some(Instant::now());
        if self.prefs.sound {
            self.sound.play(&self.platform);
        }
    }

    fn preview_line(&mut self, fen: String, moves: Vec<String>) {
        let mut positions = vec![fen];
        for uci in &moves {
            let Some(next) = positions.last().and_then(|fen| play_uci(fen, uci)) else {
                return;
            };
            positions.push(next.fen);
        }
        self.variation = vec![positions[0].clone()];
        self.preview = Some((positions, moves, 0));
        self.motion = None;
        self.side = None;
        self.coach_square = None;
    }

    fn step(&mut self, forward: bool) {
        if let Some((positions, moves, index)) = &mut self.preview {
            let next = if forward {
                (*index + 1).min(positions.len() - 1)
            } else {
                index.saturating_sub(1)
            };
            if next != *index {
                let uci = moves[next.max(*index) - 1].clone();
                *index = next;
                let next_fen = positions[next].clone();
                self.animate(uci, !forward);
                self.variation = vec![next_fen];
            }
        } else {
            self.set_ply(if forward {
                self.ply + 1
            } else {
                self.ply.saturating_sub(1)
            });
        }
    }

    fn review(&mut self, context: egui::Context, fresh: bool) {
        if self.events.is_some() {
            return;
        }
        let Some(mut game) = self.game.clone() else {
            return;
        };
        if game.uci_moves.len() != game.moves.len() {
            match parse_pgn(&game.pgn, &game.source) {
                Ok(replayed) if replayed.moves.len() == game.moves.len() => {
                    game.uci_moves = replayed.uci_moves
                }
                _ => {
                    self.message = "Could not replay this saved PGN.".into();
                    return;
                }
            }
        }
        let (tx, rx) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = cancel.clone();
        let engine_path = platform::executable(&self.platform.engines, "stockfish");
        let foxash_path = platform::executable(&self.platform.engines, "foxash");
        let depth = self.prefs.depth;
        let scratch = self.platform.data.join("foxash");
        let pack = self
            .store
            .as_ref()
            .and_then(|store| store.coaching_pack().ok().flatten())
            .and_then(|pack| serde_json::from_value(pack).ok())
            .unwrap_or_default();
        self.cancel = Some(cancel);
        self.events = Some(rx);
        self.latest.clear();
        self.persist();
        self.message.clear();
        std::thread::spawn(move || {
            let mut engine = UciEngine::new(engine_path);
            let foxash = Foxash::new(foxash_path, scratch);
            let options = AnalyzeOptions {
                depth,
                fresh,
                cancel: Some(&worker_cancel),
                pack,
                ..Default::default()
            };
            let result = analyze_game(&mut engine, &foxash, &game, options, |row| {
                let _ = tx.send(Event::Move(row.clone()));
                context.request_repaint();
            })
            .map_err(|error| error.to_string());
            let _ = tx.send(Event::Review(result));
            context.request_repaint();
        });
    }

    fn receive(&mut self) {
        loop {
            let Some(receiver) = &self.events else { break };
            match receiver.try_recv() {
                Ok(Event::Move(row)) => self.latest.push(row),
                Ok(Event::Review(result)) => {
                    self.cancel = None;
                    self.events = None;
                    match result {
                        Ok(review) => {
                            self.message = if review.completed {
                                "Review complete".into()
                            } else {
                                "Partial review saved".into()
                            };
                            if let Some(game) = &mut self.game {
                                game.review = Some(review);
                            }
                            self.persist();
                        }
                        Err(error) => self.message = error,
                    }
                    self.latest.clear();
                }
                Ok(Event::Import(result, sync, main)) => {
                    self.events = None;
                    self.syncing = false;
                    match result {
                        Ok(games) => {
                            let saved = self.import_games(games, !sync);
                            if saved && let Some(account) = main {
                                self.set_setting(accounts::MAIN_KEY, account.key());
                                self.main_account = Some(account);
                                self.sync = Sync::restored(now_ms());
                            }
                            if saved && sync {
                                let now = now_ms();
                                self.sync.succeeded(now);
                                if let Some(account) = &self.main_account {
                                    let mut times = sync_times(self.store.as_ref());
                                    times.insert(account.key().to_owned(), now);
                                    if let Ok(value) = serde_json::to_string(&times) {
                                        self.set_setting(accounts::SYNC_TIMES_KEY, &value);
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            if sync {
                                self.sync.failed(now_ms());
                            }
                            self.message = error;
                        }
                    }
                }
                Ok(Event::Position(result)) => {
                    self.events = None;
                    match result {
                        Ok(result) => self.position_result = Some(result),
                        Err(error) => self.message = error,
                    }
                }
                Ok(Event::Variation(result)) => {
                    self.events = None;
                    match result {
                        Ok((game, row)) if self.variation.last() == game.positions.last() => {
                            self.variation_review = Some((game, row))
                        }
                        Ok(_) => {}
                        Err(error) => self.message = error,
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.events = None;
                    self.cancel = None;
                    self.latest.clear();
                    self.message = "Background task stopped unexpectedly.".into();
                }
            }
        }
        if let Some((legacy, receiver)) = &self.pending_file {
            let legacy = *legacy;
            match receiver.try_recv() {
                Ok(result) => {
                    self.pending_file = None;
                    match result {
                        Ok(bytes) if legacy => self.migrate(&bytes),
                        Ok(bytes) => {
                            let content = String::from_utf8_lossy(&bytes);
                            self.import_pgn(&content);
                        }
                        Err(error) => self.message = error,
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => self.pending_file = None,
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
    }

    fn migrate(&mut self, bytes: &[u8]) {
        self.persist();
        let result = LegacyBackup::from_reader(bytes).and_then(|backup| {
            self.store
                .as_mut()
                .ok_or(chessash_persistence::Error::Invalid(
                    "Native storage unavailable.",
                ))?
                .import_legacy(backup)
        });
        match result {
            Ok(report) => {
                self.apply_migration(report);
            }
            Err(error) => self.message = error.to_string(),
        }
    }

    fn apply_migration(&mut self, report: chessash_persistence::ImportReport) {
        if let Some(store) = &self.store {
            self.games = store.games().unwrap_or_default();
            accounts::sort_games(&mut self.games);
            self.main_account = store
                .local_setting(accounts::MAIN_KEY)
                .ok()
                .flatten()
                .and_then(|key| Account::from_key(&key));
            self.sync = Sync::restored(
                sync_times(Some(store))
                    .get(self.main_account.as_ref().map_or("", Account::key))
                    .copied()
                    .unwrap_or_default(),
            );
            self.prefs = store
                .local_setting("chessash:prefs")
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_default();
            self.italian = store
                .local_setting("chessash:language")
                .ok()
                .flatten()
                .as_deref()
                == Some("it");
            let active = store.local_setting("chessash:active").ok().flatten();
            #[cfg(windows)]
            {
                self.tutor = crate::tutor::Tutor::new(Some(store));
            }
            self.game = None;
            if let Some(game) = active
                .and_then(|id| self.games.iter().find(|game| game.id == id))
                .or_else(|| self.games.first())
                .cloned()
            {
                self.select(game);
            }
        }
        self.message = format!(
            "Imported {} games and {} settings from V1.5.",
            report.games_imported, report.local_settings_imported
        );
    }

    #[cfg(target_os = "android")]
    fn poll_migration(&mut self, ctx: &egui::Context) {
        if !self.migration_poll {
            return;
        }
        let reading_legacy_storage = self.platform.legacy_migration_pending();
        if self.events.is_none()
            && let Some(store) = &mut self.store
        {
            match store.import_staged(&self.platform.data) {
                Ok(Some(report)) => {
                    self.migration_poll = false;
                    self.apply_migration(report);
                    self.message.clear();
                    appearance::style(ctx, self.prefs.theme == "light", self.prefs.font);
                    return;
                }
                Ok(None) => {}
                Err(error) => {
                    self.message = error.to_string();
                    self.migration_poll = false;
                    return;
                }
            }
        }
        if reading_legacy_storage {
            ctx.request_repaint_after(std::time::Duration::from_millis(150));
        } else {
            self.migration_poll = false;
        }
    }

    fn import_games(&mut self, games: Vec<Game>, open: bool) -> bool {
        self.persist();
        let Some(first) = games.first() else {
            return false;
        };
        let id = first.id.clone();
        let count = games.len();
        let games = accounts::merge_imports(&self.games, games);
        if let Some(store) = &mut self.store {
            if let Err(error) = store.save_games(&games) {
                self.message = error.to_string();
                return false;
            }
            self.games = store.games().unwrap_or_default();
        } else {
            for game in games {
                if let Some(index) = self
                    .games
                    .iter()
                    .position(|existing| game.id == existing.id)
                {
                    self.games[index] = game;
                } else {
                    self.games.push(game);
                }
            }
        }
        accounts::sort_games(&mut self.games);
        if open {
            if let Some(game) = self
                .games
                .iter()
                .find(|game| game.id == id)
                .cloned()
                .or_else(|| self.games.first().cloned())
            {
                self.select(game);
            }
            self.message = format!("{} {count}", self.tr("Games imported", "Partite importate"));
            self.dialog = None;
        }
        true
    }

    fn import_pgn(&mut self, pgn: &str) {
        match parse_pgn_collection(pgn, "PGN") {
            Ok(games) => {
                self.import_games(games, true);
            }
            Err(error) => self.message = error.to_string(),
        }
    }

    fn nav(&mut self, ui: &mut egui::Ui, narrow: bool) {
        let split = narrow && self.screen != Screen::Review;
        let compact = narrow || ui.available_width() < 720.0;
        if split {
            let icon_import = ui.available_width() < 390.0;
            ui.horizontal(|ui| {
                self.art.icon(ui, Icon::Flame, 23.0, ACCENT);
                ui.label(RichText::new("ChessAsh").size(21.0).strong());
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let import = self.tr("Import game", "Importa partita");
                    let clicked = if icon_import {
                        ui.add_enabled_ui(self.events.is_none(), |ui| {
                            self.art.icon_button(ui, Icon::Plus, import, Vec2::splat(36.0))
                        }).inner.clicked()
                    } else {
                        ui.add_enabled(
                            self.events.is_none(),
                            appearance::primary(&format!("+  {import}")).min_size(Vec2::new(110.0, 39.0)),
                        ).clicked()
                    };
                    if clicked {
                        self.dialog = Some(Dialog::Import);
                    }
                    if self
                        .art
                        .icon_button(ui, Icon::Settings, "Settings", Vec2::splat(33.0))
                        .clicked()
                    {
                        self.dialog = Some(Dialog::Settings);
                    }
                });
            });
            ui.add_space(10.0);
        }
        ui.horizontal(|ui| {
            if !compact {
                self.art.icon(ui, Icon::Flame, 23.0, ACCENT);
                ui.spacing_mut().item_spacing.x = 2.0;
                ui.label(RichText::new("Chess").size(21.0).strong());
                ui.label(RichText::new("Ash").size(21.0).strong().color(ACCENT));
                ui.label(
                    RichText::new(concat!(
                        env!("CARGO_PKG_VERSION_MAJOR"),
                        ".",
                        env!("CARGO_PKG_VERSION_MINOR")
                    ))
                    .size(10.0),
                );
                ui.add_space(34.0);
                ui.spacing_mut().item_spacing.x = 8.0;
            }
            let reserve = if split { 0.0 } else if compact { 82.0 } else { 165.0 };
            let nav_width = if compact {
                ((ui.available_width() - reserve - 4.0 * ui.spacing().item_spacing.x) / 4.0)
                    .max(30.0)
            } else {
                94.0
            };
            for (screen, text, icon) in [
                (Screen::Review, self.tr("Review", "Analisi"), Icon::Book),
                (
                    Screen::Library,
                    self.tr("Library", "Archivio"),
                    Icon::Library,
                ),
                (Screen::Training, self.tr("Training", "Pratica"), Icon::Check),
                (Screen::Play, self.tr("Play", "Gioca"), Icon::Play),
            ] {
                let title = if screen == Screen::Library {
                    format!("{text}  {}", self.games.len())
                } else {
                    text.to_owned()
                };

                let color = if self.screen == screen {
                    ui.visuals().text_color()
                } else if ui.visuals().dark_mode {
                    Color32::from_rgb(191, 203, 180)
                } else {
                    Color32::from_rgb(68, 68, 65)
                };
                let fill = if self.screen == screen {
                    ui.visuals().window_fill
                } else {
                    Color32::TRANSPARENT
                };
                let response = if compact {
                    ui.add_sized(
                        [nav_width, 40.0],
                        egui::Button::new(RichText::new(title).size(12.0).color(color))
                            .fill(fill)
                            .corner_radius(10),
                    )
                } else {
                    ui.add_sized(
                        [nav_width, 40.0],
                        egui::Button::image_and_text(
                            egui::Image::new((
                                self.art.icons[icon as usize].id(),
                                Vec2::splat(16.0),
                            ))
                            .tint(color),
                            RichText::new(title).size(14.0).color(color),
                        )
                        .fill(fill)
                        .corner_radius(10),
                    )
                };
                if response.clicked() {
                    self.screen = screen;
                }
            }
            if !split {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui
                        .add_sized(
                            [if compact { 36.0 } else { 132.0 }, 40.0],
                            egui::Button::image_and_text(
                                egui::Image::new((
                                    self.art.icons[Icon::Plus as usize].id(),
                                    Vec2::splat(17.0),
                                )),
                                RichText::new(if compact { "" } else { self.tr("Import game", "Importa partita") })
                                    .size(14.0)
                                    .strong()
                                    .color(appearance::INK),
                            )
                            .fill(Color32::from_rgb(78, 117, 43))
                            .corner_radius(10),
                        )
                        .clicked()
                        && self.events.is_none()
                    {
                        self.dialog = Some(Dialog::Import);
                    }
                    if self
                        .art
                        .icon_button(ui, Icon::Settings, "Settings", Vec2::new(26.0, 40.0))
                        .clicked()
                    {
                        self.dialog = Some(Dialog::Settings);
                    }
                });
            }
        });
    }

    fn live_game(&mut self, ui: &mut egui::Ui, mobile: bool) {
        let options = live_ui::View {
            board: &self.board,
            platform: &self.platform,
            sound: &mut self.sound,
            prefs: &self.prefs,
            italian: self.italian,
            mobile,
            store: self.store.as_ref(),
        };
        match self.live.show(ui, options) {
            Some(live_ui::Action::Save(mut game)) => {
                let current = self.game.as_ref().filter(|current| current.id == game.id);
                if self.events.is_some() && current.is_some() {
                    self.live.save_error(self.tr(
                        "Wait for the Library review to finish, then save again.",
                        "Attendi la fine dell’analisi in archivio, poi salva di nuovo.",
                    ).to_owned());
                    return;
                }
                if let Some(saved) = current.or_else(|| self.games.iter().find(|existing| existing.id == game.id)) {
                    game.notes.clone_from(&saved.notes);
                    game.review_as = saved.review_as;
                    game.last_ply = saved.last_ply;
                    if saved.moves.len() == game.moves.len()
                        && saved.review.as_ref().is_some_and(|review| review.completed)
                    {
                        game.review.clone_from(&saved.review);
                    }
                }
                let unavailable = self.tr("Library storage is unavailable.", "Archivio non disponibile.");
                let result = self.store.as_mut().ok_or_else(|| unavailable.to_owned())
                    .and_then(|store| store.save_game(&game).map_err(|error| error.to_string()));
                match result {
                    Ok(()) => {
                        let id = game.id.clone();
                        if let Some(current) = self.game.as_mut().filter(|current| current.id == id) {
                            *current = game.clone();
                        }
                        if let Some(saved) = self.games.iter_mut().find(|saved| saved.id == id) {
                            *saved = game;
                        } else {
                            self.games.push(game);
                        }
                        accounts::sort_games(&mut self.games);
                        self.live.saved();
                    }
                    Err(error) => self.live.save_error(error),
                }
            }
            Some(live_ui::Action::OpenLibrary) => self.screen = Screen::Library,
            None => {}
        }
    }

    fn review_ui(&mut self, ui: &mut egui::Ui, mobile: bool) {
        if self.game.is_none() {
            ui.vertical_centered(|ui| {
                ui.add_space(50.0);
                ui.heading(self.tr("Review a game", "Analizza una partita"));
                if ui
                    .button(self.tr("Import a game", "Importa partita"))
                    .clicked()
                {
                    self.dialog = Some(Dialog::Import);
                }
                ui.add_space(16.0);
                self.board.show(
                    ui,
                    BoardView {
                        fen: INITIAL_FEN,
                        size: ui.available_width().min(450.0),
                        flipped: false,
                        last: "",
                        best: "",
                        selected: None,
                        quality: None,
                        transition: None,
                        check: false,
                        mate: false,
                    },
                );
            });
            return;
        }
        let gutter = if cfg!(target_os = "android") {
            0.0
        } else {
            15.0
        };
        let total_width = (ui.available_width() - gutter).min(1136.0);
        if mobile {
            ui.set_width(total_width);
            appearance::panel(ui)
                .inner_margin(8)
                .corner_radius(16)
                .show(ui, |ui| self.review_board(ui, true));
            ui.add_space(10.0);
            self.review_details(ui);
        } else {
            let offset = ((ui.available_width() - gutter - total_width) / 2.0).max(0.0);
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = 0.0;
                ui.add_space(offset);
                ui.vertical(|ui| {
                    ui.set_width((total_width - 24.0) * 0.60);
                    ui.set_max_width((total_width - 24.0) * 0.60);
                    ui.spacing_mut().item_spacing.x = 8.0;
                    appearance::panel(ui).show(ui, |ui| self.review_board(ui, false));
                });
                ui.add_space(24.0);
                ui.vertical(|ui| {
                    ui.set_width((total_width - 24.0) * 0.40);
                    self.review_details(ui);
                });
            });
        }
    }

    fn result(&self) -> Option<&MoveReview> {
        if self.ply == 0 {
            return None;
        }
        let game = self.game.as_ref()?;
        self.latest
            .get(self.ply - 1)
            .or_else(|| game.review.as_ref()?.results.get(self.ply - 1))
    }

    fn review_board(&mut self, ui: &mut egui::Ui, mobile: bool) {
        let Some(game) = &self.game else { return };
        let players = [self.tr("White", "Bianco"), self.tr("Black", "Nero")]
            .into_iter()
            .zip(["White", "Black"])
            .map(|(fallback, key)| {
                game.headers
                    .get(key)
                    .filter(|name| !name.is_empty() && *name != "?")
                    .cloned()
                    .unwrap_or(fallback.into())
            })
            .collect::<Vec<_>>();
        let total = game.moves.len();
        let game_source = game.source.clone();
        let game_result = game.headers.get("Result").cloned().unwrap_or_default();
        let variation = self.variation.last().cloned();
        let fen = variation.clone().unwrap_or_else(|| {
            game.positions
                .get(self.ply)
                .cloned()
                .unwrap_or(INITIAL_FEN.into())
        });
        let position = parse_fen(&fen).ok();
        let check = position.as_ref().is_some_and(Position::is_check);
        let mate = position.as_ref().is_some_and(Position::is_checkmate);
        let stale = position.as_ref().is_some_and(Position::is_stalemate);
        let temporary = self
            .variation_review
            .as_ref()
            .filter(|(game, _)| variation.as_ref() == game.positions.last());
        let reviewed_game = temporary.map_or(game, |(game, _)| game);
        let row = temporary.map(|(_, row)| row.clone()).or_else(|| {
            variation
                .is_none()
                .then(|| self.result().cloned())
                .flatten()
        });
        let is_temporary_review = temporary.is_some();
        let coaching_origin = row
            .as_ref()
            .and_then(|row| reviewed_game.positions.get(row.ply.saturating_sub(1)))
            .cloned();
        let mut perspective = game.review_as;
        let account = self.main_account.as_ref().map_or("", Account::key);
        let coaching_options = CoachingOptions {
            language: if self.italian {
                CoachingLanguage::Italian
            } else {
                CoachingLanguage::English
            },
            player_color: chessash_review_core::player_color_for(game, account),
        };
        let coaching = row.as_ref().map(|row| review_coaching(reviewed_game, row, coaching_options));
        let last = if variation.is_some() {
            self.motion
                .as_ref()
                .map(|motion| motion.uci.clone())
                .unwrap_or_default()
        } else {
            game.uci_moves
                .get(self.ply.saturating_sub(1))
                .filter(|_| self.ply > 0)
                .cloned()
                .or_else(|| row.as_ref().map(|r| r.r#move.clone()))
                .unwrap_or_default()
        };
        let eval_width = if mobile { 16.0 } else { 20.0 };
        let height = ui.ctx().content_rect().height();
        let (top, bottom) = self.platform.vertical_insets();
        let max_board = (height
            - (top + bottom) / ui.ctx().pixels_per_point()
            - 56.0
            - (height * 0.23).clamp(160.0, 196.0)
            - 198.0)
            .max(240.0);
        let width = (ui.available_width() - eval_width - 8.0).min(if mobile {
            max_board
        } else {
            f32::INFINITY
        });
        let prior = perspective;
        let mut export = false;
        let italian = self.italian;
        let side_name = |side| match (side, italian) {
            (None, false) => "My account",
            (None, true) => "Il mio account",
            (Some(Perspective::Neutral), false) => "White / Black",
            (Some(Perspective::Neutral), true) => "Entrambi",
            (Some(Perspective::White), false) => "White",
            (Some(Perspective::White), true) => "Bianco",
            (Some(Perspective::Black), false) => "Black",
            (Some(Perspective::Black), true) => "Nero",
        };
        let mut share = false;
        let title = game
            .headers
            .get("Event")
            .filter(|event| !event.is_empty() && *event != "?")
            .map_or("Game review", String::as_str);
        let heading_width = ui.available_width();
        let (heading, _) = ui.allocate_exact_size(
            Vec2::new(heading_width, if mobile { 44.0 } else { 48.0 }),
            egui::Sense::hover(),
        );
        let name = chessash_review_core::opening_name(&game.moves);
        let has_review = game
            .review
            .as_ref()
            .is_some_and(|review| !review.results.is_empty());
        let title_width = if mobile {
            heading.width() * 0.38
        } else {
            heading.width() * 0.55
        };
        ui.scope_builder(
            egui::UiBuilder::new()
                .max_rect(egui::Rect::from_min_size(
                    heading.left_top() + Vec2::new(0.0, 5.0),
                    Vec2::new(title_width, 38.0),
                ))
                .layout(egui::Layout::top_down(egui::Align::Min)),
            |ui| {
                ui.spacing_mut().item_spacing.y = if mobile { 2.0 } else { 3.0 };
                ui.label(
                    RichText::new(name)
                        .size(if mobile { 10.0 } else { 11.0 })
                        .color(Color32::from_rgb(191, 203, 180)),
                );
                ui.add(
                    egui::Label::new(
                        RichText::new(title)
                            .size(if mobile { 13.0 } else { 17.0 })
                            .strong(),
                    )
                    .truncate(),
                );
            },
        );
        if mobile {
            let width = (heading.width() * 0.38).max(91.0);
            let start = egui::pos2(heading.right() - width, heading.top());
            ui.scope_builder(
                egui::UiBuilder::new()
                    .max_rect(egui::Rect::from_min_size(start, Vec2::new(width, 44.0)))
                    .layout(egui::Layout::top_down(egui::Align::Min)),
                |ui| {
                    ui.spacing_mut().item_spacing.y = 1.0;
                    ui.label(RichText::new("Review as").size(10.0));
                    perspective_selector(ui, &mut perspective, &side_name, width);
                },
            );
        }
        let download_x = if mobile {
            heading.right() - (heading.width() * 0.38).max(91.0) - 24.0
        } else {
            heading.right() - 20.0
        };
        let share_x = if mobile {
            download_x - 42.0
        } else {
            heading.left() + heading.width() * 0.585
        };
        for (icon, x, tooltip) in [
            (Icon::Download, download_x, "Export annotated PGN"),
            (Icon::Share, share_x, "Share review"),
        ] {
            if matches!(icon, Icon::Share) && !has_review {
                continue;
            }
            let rect =
                egui::Rect::from_center_size(egui::pos2(x, heading.center().y), Vec2::splat(29.0));
            let response = ui
                .put(
                    rect,
                    egui::Button::image(
                        egui::Image::new((self.art.icons[icon as usize].id(), Vec2::splat(18.0)))
                            .tint(ui.visuals().text_color()),
                    )
                    .frame(false),
                )
                .on_hover_text(tooltip);
            if response.clicked() {
                if matches!(icon, Icon::Share) {
                    share = true;
                } else {
                    export = true;
                }
            }
        }
        if !mobile {
            ui.allocate_ui_with_layout(
                Vec2::new(ui.available_width(), 40.0),
                egui::Layout::left_to_right(egui::Align::Center),
                |ui| {
                    ui.label(RichText::new("Review as").size(12.0));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        perspective_selector(ui, &mut perspective, &side_name, 120.0)
                    });
                },
            );
        }
        if share {
            self.card_index = 0;
            self.dialog = Some(Dialog::Share);
        }
        if export {
            let pgndata = chessash_review_core::export_pgn_with_review_text(game, self.names(), |row| {
                review_coaching(game, row, coaching_options).annotation()
            });
            if let Err(error) = self.platform.save_pgn(pgndata.as_bytes()) {
                self.message = error;
            }
        }
        if perspective != prior {
            if let Some(game) = &mut self.game {
                game.review_as = perspective;
                self.flipped = chessash_review_core::player_color_for(game, account)
                    == Some(Color::Black);
            }
            self.coach_square = None;
            self.persist();
        }
        let mut hovered_coach_square = None;
        let coach_ply = row.as_ref().map_or(self.ply, |row| row.ply);
        let coach_height = if mobile {
            (height * 0.23).clamp(160.0, 196.0) + 2.0
        } else {
            181.0
        };
        let avatar_width = if mobile { 32.0 } else { 42.0 };
        ui.add_space(if mobile { 2.0 } else { 14.0 });
        let mut coach_frame = None;
        let bubble_width =
            (ui.available_width() - avatar_width - ui.spacing().item_spacing.x - 20.0).max(80.0);
        ui.horizontal_top(|ui| {
            let (avatar, _) = ui.allocate_exact_size(
                Vec2::new(avatar_width, coach_height),
                egui::Sense::hover(),
            );
            let icon = egui::Rect::from_center_size(avatar.center(), Vec2::splat(avatar.width()));
            ui.painter().image(
                self.art.coach.id(),
                icon,
                egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)),
                Color32::WHITE,
            );
            let frame = egui::Frame::new()
                .fill(COACH)
                .corner_radius(egui::CornerRadius { nw: 18, ne: 18, sw: 5, se: 18 })
                .inner_margin(10)
                .show(ui, |ui| {
                    ui.allocate_ui_with_layout(Vec2::new(bubble_width, coach_height - 20.0),
                        egui::Layout::top_down(egui::Align::Min), |ui| {
                    ui.set_max_width(bubble_width);
                    ui.visuals_mut().override_text_color = Some(COACH_INK);
                    ui.visuals_mut().widgets.inactive.fg_stroke.color = COACH_INK;
                    ui.visuals_mut().widgets.hovered.fg_stroke.color = COACH_INK;
                    ui.visuals_mut().widgets.inactive.weak_bg_fill =
                        Color32::from_rgb(227, 235, 213);
                    if mobile {
                        ui.spacing_mut().item_spacing.y = 4.0;
                    }
                    let action_height = if row.is_some() { 38.0 } else { 0.0 };
                    egui::ScrollArea::vertical()
                        .id_salt(("coach-explanation", coach_ply, variation.is_some()))
                        .max_width(bubble_width)
                        .max_height(coach_height - 20.0 - action_height)
                        .auto_shrink([false, false])
                        .show(ui, |ui| {
                            ui.horizontal_wrapped(|ui| {
                                ui.label(RichText::new(self.tr("Coach", "Allenatore")).size(11.0));
                                if let Some(row) = &row {
                                    quality_icon(ui, row.label, COACH_INK);
                                    let number = coaching_origin.as_deref().and_then(|fen| fen.split_whitespace().nth(5)).unwrap_or("1");
                                    let dots = if row.color == Color::White { "." } else { "…" };
                                    ui.label(RichText::new(format!("{number}{dots} {}", row.san.as_deref().unwrap_or(&row.r#move))).size(12.0));
                                    if !mobile { ui.label(RichText::new(row.label.name(self.names())).size(12.0)); }
                                }
                            });
                            if let Some(coaching) = &coaching {
                                if !coaching.text.is_empty() {
                                    coach_text(ui, &coaching.text, if mobile { 13.0 } else { 14.0 }, &mut self.coach_square, &mut hovered_coach_square);
                                }
                                if !coaching.best.is_empty() {
                                    egui::Frame::new()
                                        .inner_margin(egui::Margin::symmetric(8, 3))
                                        .show(ui, |ui| {
                                            coach_text(ui, &coaching.best, 13.0, &mut self.coach_square, &mut hovered_coach_square);
                                            let rect = ui.min_rect().expand2(Vec2::new(6.0, 2.0));
                                            ui.painter().line_segment(
                                                [rect.left_top(), rect.left_bottom()],
                                                egui::Stroke::new(2.5_f32, BLUE),
                                            );
                                        });
                                }
                                if !coaching.detail.is_empty() || coaching.hint.is_some()
                                {
                                    ui.collapsing(
                                        self.tr("Full explanation", "Spiegazione completa"),
                                        |ui| {
                                            for paragraph in coaching.detail.lines() {
                                                coach_text(ui, paragraph, 13.0, &mut self.coach_square, &mut hovered_coach_square);
                                            }
                                            if let Some(hint) = &coaching.hint {
                                                coach_text(ui, hint, 13.0, &mut self.coach_square, &mut hovered_coach_square);
                                            }
                                        },
                                    );
                                }
                            } else if variation.is_some() {
                                ui.add(egui::Label::new(if self.events.is_some() {
                                    self.tr("Reviewing your move…", "Analisi della tua mossa…")
                                } else {
                                    self.tr("Try a move on the board.", "Prova una mossa sulla scacchiera.")
                                }).wrap());
                            } else if let Some(game) = &self.game {
                                let rows = self.review_rows(game);
                                if rows.is_empty() {
                                    ui.add(egui::Label::new(self.tr("Let’s look at this game together. Start a review to find the moments worth practicing.",
                                        "Analizziamo questa partita. Avvia l’analisi per trovare i momenti su cui esercitarti.")).wrap());
                                } else {
                                    ui.add(egui::Label::new(self.tr("Your review is ready. Let’s look at a turning point.", "L’analisi è pronta. Vediamo un momento decisivo.")).wrap());
                                    let first = turning_points(rows, self.short_review, None).first().map(|row| row.ply).unwrap_or(1);
                                    if ui.add(appearance::primary(self.tr("Start walkthrough", "Inizia la revisione guidata"))).clicked() { self.set_ply(first); }
                                }
                            }
                        });
                    if let Some(row) = &row {
                        ui.horizontal(|ui| {
                            if ui
                                .add(egui::Button::image_and_text(egui::Image::new((self.art.icons[Icon::Retry as usize].id(), Vec2::splat(14.0))),
                                    RichText::new(self.tr("Try again", "Riprova")).size(12.0).strong().color(appearance::INK))
                                    .fill(Color32::from_rgb(78,117,43)).min_size(Vec2::new(85.0,34.0)))
                                .clicked()
                            {
                                if let Some(fen) = coaching_origin.clone()
                                {
                                    self.variation = vec![fen];
                                    self.preview = None;
                                    self.motion = None;
                                    self.coach_square = None;
                                }
                            }
                            if !row.pv.is_empty()
                                && ui
                                    .add(egui::Button::image_and_text(egui::Image::new((self.art.icons[Icon::Play as usize].id(),Vec2::splat(14.0))).tint(COACH_INK),
                                    RichText::new(self.tr("Show line", "Mostra continuazione")).size(12.0).color(COACH_INK))
                                    .min_size(Vec2::new(90.0,34.0)))
                                    .clicked()
                            {
                                if let Some(fen) = coaching_origin.clone() {
                                    self.preview_line(fen, row.pv.clone());
                                }
                            }
                        });
                    }
                    });
                });
            coach_frame = Some(frame.response.rect);
        });
        if let Some(rect) = coach_frame.filter(|_| !mobile) {
            let point = rect.left_top() + Vec2::new(0.0, 30.0);
            ui.painter().add(egui::Shape::convex_polygon(
                vec![
                    point + Vec2::new(-8.0, 0.0),
                    point + Vec2::new(3.0, -8.0),
                    point + Vec2::new(3.0, 8.0),
                ],
                COACH,
                egui::Stroke::NONE,
            ));
        }
        ui.add_space(if mobile { 16.0 } else { 45.0 });
        let mut selected_square = None;
        ui.vertical_centered(|ui| {
            player_strip(
                ui,
                &players[usize::from(!self.flipped)],
                self.flipped,
                &game_result,
                mobile,
            );
            let elapsed = self
                .motion
                .as_ref()
                .map(|motion| motion.start.elapsed().as_secs_f32())
                .unwrap_or(99.0);
            let transition = self
                .motion
                .as_ref()
                .filter(|motion| !self.prefs.reduced && elapsed < motion.duration)
                .map(|motion| Transition {
                    uci: &motion.uci,
                    progress: elapsed / motion.duration,
                    fast: motion.fast,
                    reverse: motion.reverse,
                });
            let focused = hovered_coach_square.as_ref().or(self.coach_square.as_ref());
            let threat = focused.and_then(|square| {
                let threat = coaching.as_ref()?.threat.as_deref()?;
                let matches_square = threat.get(..2) == Some(square.as_str())
                    || threat.get(2..4) == Some(square.as_str());
                (matches_square && self.prefs.arrows && self.tab == ReviewTab::Review).then_some(threat)
            });
            let best = if self.prefs.arrows && self.tab == ReviewTab::Review && threat.is_none() {
                row.as_ref().map(|row| row.best.as_str()).unwrap_or("")
            } else {
                ""
            };
            let label = row
                .as_ref()
                .filter(|_| variation.is_none() || is_temporary_review)
                .map(|r| r.label);
            let badge = label.map(quality);
            let brilliant = label
                .filter(|label| *label == Label::Sacrifice)
                .filter(|_| {
                    self.motion.as_ref().is_some_and(|motion| {
                        !motion.reverse && !motion.fast && !motion.uci.is_empty()
                    })
                })
                .map(|label| label.name(self.names()));
            let king = if fen.split_whitespace().nth(1) == Some("w") {
                'K'
            } else {
                'k'
            };
            let situation = board::placement(&fen)
                .iter()
                .position(|piece| *piece == Some(king))
                .and_then(|square| {
                    if mate {
                        Some((
                            self.tr("Checkmate", "Scacco matto"),
                            Color32::from_rgb(245, 213, 140),
                            square,
                        ))
                    } else if stale {
                        Some((
                            self.tr("Stalemate", "Stallo"),
                            Color32::from_rgb(217, 233, 243),
                            square,
                        ))
                    } else if check {
                        Some((
                            self.tr("Check", "Scacco"),
                            Color32::from_rgb(244, 177, 144),
                            square,
                        ))
                    } else {
                        None
                    }
                });
            ui.horizontal(|ui| {
                let score = row.as_ref().map(|row| row.after);
                let white = score
                    .map(|score| (chessash_review_core::win_chance(score) / 100.0) as f32)
                    .unwrap_or(0.5);
                ui.spacing_mut().item_spacing.x = 8.0;
                let (bar, _) =
                    ui.allocate_exact_size(Vec2::new(eval_width, width), egui::Sense::hover());
                let painter = ui.painter_at(bar);
                painter.rect_filled(bar, 3.0, Color32::from_rgb(41, 52, 40));
                let white_rect = if self.flipped {
                    egui::Rect::from_min_max(
                        bar.min,
                        egui::pos2(bar.right(), bar.top() + width * white),
                    )
                } else {
                    egui::Rect::from_min_max(
                        egui::pos2(bar.left(), bar.bottom() - width * white),
                        bar.max,
                    )
                };
                painter.rect_filled(white_rect, 2.0, Color32::from_rgb(237, 242, 231));
                if let Some(score) = score {
                    painter.text(
                        bar.center_bottom() - Vec2::new(0.0, 4.0),
                        egui::Align2::CENTER_BOTTOM,
                        if score.abs() >= 29_000 {
                            "M".into()
                        } else {
                            format!("{:.1}", score.abs() as f32 / 100.0)
                        },
                        egui::FontId::proportional(9.0),
                        COACH_INK,
                    );
                }
                selected_square = self.board.show_with_layers(
                    ui,
                    BoardView {
                        fen: &fen,
                        size: width,
                        flipped: self.flipped,
                        last: &last,
                        best,
                        selected: self.side,
                        quality: badge,
                        transition,
                        check,
                        mate,
                    },
                    |ui, rect| {
                        if !self.prefs.reduced
                            && let Some((piece, square)) =
                                self.motion.as_ref().and_then(|motion| motion.captured)
                        {
                            self.board
                                .capture(ui, rect, piece, square, self.flipped, elapsed);
                        }
                    },
                    |ui, rect| {
                        if let Some(coaching) = &coaching {
                            board::review_highlights(ui, rect, self.flipped, &coaching.targets);
                        }
                        if let Some(square) = focused {
                            board::review_highlights(ui, rect, self.flipped, std::slice::from_ref(square));
                        }
                        if let Some(threat) = threat {
                            board::review_threat(ui, rect, self.flipped, threat);
                        }
                        if self.prefs.reduced
                            && let Some((title, color, _)) = situation
                        {
                            board::position_notice(ui, rect, title, color, None);
                        }
                        if !self.prefs.reduced
                            && self.motion.as_ref().is_some_and(|motion| !motion.fast)
                        {
                            board::effects(
                                ui,
                                rect,
                                elapsed,
                                &last,
                                self.flipped,
                                badge,
                                brilliant,
                                situation,
                            );
                        }
                    },
                );
            });
            if mobile {
                ui.add_space(-5.0);
            }
            player_strip(
                ui,
                &players[usize::from(self.flipped)],
                !self.flipped,
                &game_source,
                mobile,
            );
        });
        if let Some(square) = selected_square {
            self.board_click(square, &fen, ui.ctx());
        }
        if !mobile && (mate || stale) {
            ui.label(
                RichText::new(if mate {
                    self.tr("Checkmate", "Scacco matto")
                } else {
                    self.tr("Stalemate", "Stallo")
                })
                .color(ACCENT)
                .strong(),
            );
        }
        egui::Frame::new()
            .fill(ui.visuals().widgets.inactive.bg_fill)
            .corner_radius(11)
            .inner_margin(egui::Margin::symmetric(0, if mobile { 6 } else { 3 }))
            .show(ui, |ui| {
                let width = ui.available_width();
                let length = self.preview.as_ref().map_or(total, |(_, moves, _)| moves.len());
                let digits = length.to_string().len();
                let counter_width = ui.painter().layout_no_wrap(
                    format!("{:0>digits$}/{length}", 0),
                    egui::FontId::monospace(13.0),
                    ui.visuals().text_color(),
                ).size().x + 10.0;
                let counter_width = counter_width.max(49.0).min(width / 3.0);
                let button_width = ((width - counter_width) / 6.0).min(34.0);
                let spare_width = (width - counter_width - 6.0 * button_width).max(0.0);
                let gap = (spare_width / 4.0).min(if mobile { 2.0 } else { 8.0 });
                let jump_gap = (spare_width / 2.0 - gap).min(gap + 8.0);
                let (bar, _) = ui.allocate_exact_size(Vec2::new(width, 34.0), egui::Sense::hover());
                let inner = bar.center().x - counter_width / 2.0;
                let cell = |left, width| {
                    egui::Rect::from_min_size(egui::pos2(left, bar.top()), Vec2::new(width, 34.0))
                };
                let button_size = Vec2::new(button_width, 34.0);
                let previous = inner - button_width - gap;
                let next = inner + counter_width + gap;
                if move_control(ui, cell(bar.left(), button_width), |ui| {
                    self.art.icon_button(ui, Icon::Rotate, "Flip board", button_size)
                }).clicked() {
                    self.flipped = !self.flipped;
                }
                if move_control(ui, cell(previous - button_width - jump_gap, button_width), |ui| {
                    step_button(ui, &self.art, Icon::First, "First position", self.prefs.reduced)
                }).clicked() {
                    self.set_ply(0);
                }
                if move_control(ui, cell(previous, button_width), |ui| {
                    step_button(ui, &self.art, Icon::Previous, "Previous move", self.prefs.reduced)
                }).clicked() {
                    self.step(false);
                }
                let (position, count) = self.preview.as_ref().map_or((self.ply, total), |(_, moves, index)| {
                    (*index, moves.len())
                });
                move_control(ui, cell(inner, counter_width), |ui| {
                    move_counter(ui, position, count, self.motion.as_ref().filter(|_| !self.prefs.reduced));
                });
                if move_control(ui, cell(next, button_width), |ui| {
                    step_button(ui, &self.art, Icon::Next, "Next move", self.prefs.reduced)
                }).clicked() {
                    self.step(true);
                }
                if move_control(ui, cell(next + button_width + jump_gap, button_width), |ui| {
                    step_button(ui, &self.art, Icon::Last, "Last position", self.prefs.reduced)
                }).clicked() {
                    self.set_ply(total);
                }
                if move_control(ui, cell(bar.right() - button_width, button_width), |ui| {
                    self.art.icon_button(ui, Icon::Sliders, "Analysis settings", button_size)
                }).clicked() {
                    self.dialog = Some(Dialog::Settings);
                }
            });
        if !self.variation.is_empty()
            && ui
                .button(self.tr("Return to game", "Torna alla partita"))
                .clicked()
        {
            self.variation.clear();
            self.preview = None;
            self.side = None;
            self.motion = None;
        }
        self.advantage(ui);
    }

    fn board_click(&mut self, square: usize, fen: &str, context: &egui::Context) {
        let pieces = board::placement(fen);
        let white = fen.split_whitespace().nth(1) == Some("w");
        if let Some(from) = self.side.take() {
            if from != square {
                let mut uci = format!("{}{}", board::coordinate(from), board::coordinate(square));
                if pieces[from].is_some_and(|ch| ch.eq_ignore_ascii_case(&'p'))
                    && (square < 8 || square >= 56)
                {
                    uci.push('q');
                }
                if let Some(next) = play_uci(fen, &uci) {
                    self.preview = None;
                    self.animate(uci, false);
                    self.variation.push(next.fen.clone());
                    if self.events.is_none() && self.tab == ReviewTab::Review {
                        let game = Game {
                            positions: vec![fen.to_owned(), next.fen],
                            moves: vec![next.san],
                            uci_moves: vec![
                                self.motion
                                    .as_ref()
                                    .map(|motion| motion.uci.clone())
                                    .unwrap_or_default(),
                            ],
                            source: "variation".into(),
                            ..Default::default()
                        };
                        self.start_variation_review(context, game);
                    }
                    return;
                }
            }
        }
        if pieces[square].is_some_and(|piece| piece.is_ascii_uppercase() == white) {
            self.side = Some(square);
        }
    }

    fn start_variation_review(&mut self, context: &egui::Context, game: Game) {
        let (tx, rx) = mpsc::channel();
        let engine_path = platform::executable(&self.platform.engines, "stockfish");
        let foxash_path = platform::executable(&self.platform.engines, "foxash");
        let scratch = self.platform.data.join("foxash");
        let depth = self.prefs.depth;
        let context = context.clone();
        self.events = Some(rx);
        std::thread::spawn(move || {
            let mut engine = UciEngine::new(engine_path);
            let foxash = Foxash::new(foxash_path, scratch);
            let result = analyze_game(
                &mut engine,
                &foxash,
                &game,
                AnalyzeOptions {
                    depth,
                    ..Default::default()
                },
                |_| {},
            )
            .map_err(|error| error.to_string())
            .and_then(|review| {
                review
                    .results
                    .into_iter()
                    .next()
                    .map(|row| (game, row))
                    .ok_or_else(|| "The move review did not finish.".into())
            });
            let _ = tx.send(Event::Variation(result));
            context.request_repaint();
        });
    }
}

impl eframe::App for ChessAsh {
    #[cfg(all(windows, feature = "visual-qa"))]
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let Ok(path) = std::env::var("CHESSASH_QA_SCREENSHOT") else {
            return;
        };
        if self.screen == Screen::Training && self.training.waiting_for_preview() {
            ctx.request_repaint_after(std::time::Duration::from_millis(40));
            return;
        }
        if let Some(image) = ctx.input(|input| {
            input.events.iter().find_map(|event| {
                if let egui::Event::Screenshot { image, .. } = event {
                    Some(image.clone())
                } else {
                    None
                }
            })
        }) {
            let pixels: Vec<_> = image
                .pixels
                .iter()
                .flat_map(|pixel| pixel.to_array())
                .collect();
            let pixmap = resvg::tiny_skia::Pixmap::from_vec(
                pixels,
                resvg::tiny_skia::IntSize::from_wh(image.size[0] as u32, image.size[1] as u32)
                    .unwrap(),
            )
            .unwrap();
            pixmap.save_png(path).expect("save QA screenshot");
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else if ctx.cumulative_pass_nr() >= 4 {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
        } else {
            ctx.request_repaint();
        }
    }

    fn clear_color(&self, visuals: &egui::Visuals) -> [f32; 4] {
        visuals.panel_fill.to_normalized_gamma_f32()
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.receive();
        self.live.receive();
        let ctx = ui.ctx().clone();
        #[cfg(target_os = "android")]
        self.poll_migration(&ctx);
        #[cfg(target_os = "android")]
        if self.migration_poll {
            ui.centered_and_justified(|ui| {
                ui.vertical_centered(|ui| {
                    ui.spinner();
                    ui.label(self.tr("Opening your saved games…", "Apertura delle partite salvate…"));
                });
            });
            return;
        }
        if let Some(last) = self.last_save {
            let delay = std::time::Duration::from_millis(240);
            if let Some(remaining) = delay.checked_sub(last.elapsed()) {
                ctx.request_repaint_after(remaining);
            } else {
                self.last_save = None;
                self.persist();
            }
        }
        let (top, bottom) = self.platform.vertical_insets();
        let scale = ctx.pixels_per_point();
        let narrow = cfg!(target_os = "android") || ui.available_width() < 720.0;
        if self.main_account.is_some() && ctx.input(|input| input.focused) {
            if self.events.is_none() && self.sync.due(now_ms()) {
                self.start_sync(&ctx);
            }
            ctx.request_repaint_after(std::time::Duration::from_secs(30));
        }
        if screen_keyboard(&ctx) && self.screen == Screen::Review && self.dialog.is_none() {
            if ctx.input(|input| input.key_pressed(egui::Key::ArrowLeft)) {
                self.step(false);
            }
            if ctx.input(|input| input.key_pressed(egui::Key::ArrowRight)) {
                self.step(true);
            }
            if ctx.input(|input| input.key_pressed(egui::Key::Home)) {
                self.set_ply(0);
            }
            if ctx.input(|input| input.key_pressed(egui::Key::End)) {
                self.set_ply(usize::MAX);
            }
        }
        ui.add_space(top / scale);
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(if narrow { 8 } else { 32 }, 0))
            .fill(ui.visuals().panel_fill)
            .show(ui, |ui| {
                let width = ui.available_width()
                    - if cfg!(target_os = "android") {
                        0.0
                    } else {
                        15.0
                    };
                ui.allocate_ui_with_layout(
                    Vec2::new(width, if narrow && self.screen != Screen::Review { 94.0 } else if narrow { 48.0 } else { 68.0 }),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(width);
                        if narrow {
                            ui.add_space(4.0);
                        }
                        self.nav(ui, narrow);
                    },
                );
            });
        let content_width = ui.available_width();
        egui::ScrollArea::vertical()
            .id_salt(match self.screen {
                Screen::Review => "review-scroll",
                Screen::Library => "library-scroll",
                Screen::Training => "training-scroll",
                Screen::Play => "play-scroll",
            })
            .auto_shrink([false, false])
            .max_height((ui.available_height() - bottom / scale).max(1.0))
            .show(ui, |ui| {
                ui.set_width(content_width.min(ui.available_width()));
                egui::Frame::new()
                    .inner_margin(egui::Margin::symmetric(
                        if narrow { 12 } else if matches!(self.screen, Screen::Training | Screen::Play) { 24 } else { 0 },
                        if narrow { 5 } else { 19 },
                    ))
                    .show(ui, |ui| {
                        let width = ui.available_width();
                        ui.set_width(width);
                        ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Wrap);
                        match self.screen {
                            Screen::Review => self.review_ui(ui, narrow),
                            Screen::Library => self.library(ui),
                            Screen::Play => self.live_game(ui, narrow),
                            Screen::Training => {
                                match self.training.show(
                                    ui,
                                    &self.board,
                                    &self.games,
                                    self.store.as_mut(),
                                    &self.platform,
                                    self.italian,
                                    &mut self.sound,
                                    self.prefs.sound,
                                    self.prefs.reduced,
                                ) {
                                    Some(crate::training_ui::TrainingAction::OpenLibrary) => {
                                        self.screen = Screen::Library
                                    }
                                    Some(crate::training_ui::TrainingAction::OpenSource {
                                        game_id,
                                        ply,
                                    }) => {
                                        if let Some(game) = self
                                            .games
                                            .iter()
                                            .find(|game| game.id == game_id)
                                            .cloned()
                                        {
                                            self.select(game);
                                            self.set_ply(ply);
                                        }
                                    }
                                    None => {}
                                }
                            }
                        }
                        if !self.message.is_empty() {
                            ui.separator();
                            ui.label(&self.message);
                        }
                    });
            });
        if let Some(dialog) = self.dialog {
            self.show_dialog(&ctx, dialog);
        }
    }
}

fn soft_panel(ui: &egui::Ui, padding: i8) -> egui::Frame {
    let underlay = ui.visuals().panel_fill;
    let fill = Color32::from_rgb(
        underlay.r().saturating_add(10),
        underlay.g().saturating_add(11),
        underlay.b().saturating_add(8),
    );
    egui::Frame::new()
        .fill(fill)
        .inner_margin(padding)
        .corner_radius(16)
}

fn review_tab(
    ui: &mut egui::Ui,
    art: &Art,
    icon: Icon,
    tab: &mut ReviewTab,
    value: ReviewTab,
    title: &str,
) {
    let active = *tab == value;
    let color = if active {
        ui.visuals().text_color()
    } else {
        Color32::from_rgb(191, 203, 180)
    };
    let r = ui.add_sized(
        [86.0, 54.0],
        egui::Button::image_and_text(
            egui::Image::new((art.icons[icon as usize].id(), Vec2::splat(16.0))).tint(color),
            RichText::new(title).size(14.0).color(color),
        )
        .frame(false),
    );
    if active {
        ui.painter().line_segment(
            [r.rect.left_bottom(), r.rect.right_bottom()],
            egui::Stroke::new(2.0_f32, ACCENT),
        );
    }
    if r.clicked() {
        *tab = value;
    }
}

fn player_strip(ui: &mut egui::Ui, name: &str, white: bool, trailing: &str, mobile: bool) {
    let badge = if mobile { 22.0 } else { 28.0 };
    let height = if mobile { 24.0 } else { 34.0 };
    ui.allocate_ui_with_layout(
        Vec2::new(ui.available_width(), height),
        egui::Layout::left_to_right(egui::Align::Center),
        |ui| {
            let (rect, _) = ui.allocate_exact_size(Vec2::splat(badge), egui::Sense::hover());
            let color = Color32::from_rgb(237, 242, 231);
            ui.painter().rect_filled(
                rect,
                8.0,
                if white {
                    color
                } else {
                    Color32::from_rgb(48, 54, 43)
                },
            );
            ui.painter().rect_stroke(
                rect,
                8.0,
                egui::Stroke::new(1.0_f32, Color32::from_rgb(123, 141, 109)),
                egui::StrokeKind::Inside,
            );
            ui.painter().text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                if white { "W" } else { "B" },
                egui::FontId::monospace(11.0),
                if white { COACH_INK } else { color },
            );
            ui.label(
                RichText::new(name)
                    .size(if mobile { 12.0 } else { 14.0 })
                    .strong(),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    RichText::new(trailing)
                        .size(12.0)
                        .color(Color32::from_rgb(191, 203, 180)),
                );
            });
        },
    );
}

fn setting_select<T: PartialEq>(
    ui: &mut egui::Ui,
    id: &str,
    label: &str,
    value: &mut T,
    choices: impl IntoIterator<Item = (T, &'static str)> + Clone,
    width: f32,
) {
    ui.label(label);
    let selected = choices
        .clone()
        .into_iter()
        .find(|(candidate, _)| candidate == value)
        .map_or("", |(_, title)| title);
    appearance::field_combo(id, width, selected).show_ui(ui, |ui| {
        for (candidate, title) in choices {
            ui.selectable_value(value, candidate, title);
        }
    });
}

fn perspective_selector(
    ui: &mut egui::Ui,
    perspective: &mut Option<Perspective>,
    name: &impl Fn(Option<Perspective>) -> &'static str,
    width: f32,
) {
    egui::ComboBox::from_id_salt("review-perspective")
        .width(width)
        .selected_text(RichText::new(name(*perspective)).size(12.0))
        .show_ui(ui, |ui| {
            for side in [None, Some(Perspective::White), Some(Perspective::Black), Some(Perspective::Neutral)] {
                ui.selectable_value(perspective, side, name(side));
            }
        });
}

fn coach_text(
    ui: &mut egui::Ui,
    text: &str,
    size: f32,
    selected: &mut Option<String>,
    hovered: &mut Option<String>,
) {
    let bytes = text.as_bytes();
    let boundary = |at: usize| {
        bytes.get(at).is_none_or(|ch| !ch.is_ascii_alphanumeric() && *ch != b'_')
    };
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    let normal = egui::TextFormat::simple(egui::FontId::proportional(size), COACH_INK);
    let link_color = Color32::from_rgb(20, 97, 131);
    let link = egui::TextFormat {
        color: link_color,
        underline: egui::Stroke::new(1.0_f32, link_color),
        ..normal.clone()
    };
    let mut links = Vec::new();
    let mut start = 0;
    for (index, pair) in bytes.windows(2).enumerate() {
        if !(b'a'..=b'h').contains(&pair[0])
            || !(b'1'..=b'8').contains(&pair[1])
            || index > 0 && !boundary(index - 1)
            || !boundary(index + 2)
        {
            continue;
        }
        let square = &text[index..index + 2];
        job.append(&text[start..index], 0.0, normal.clone());
        job.append(square, 0.0, link.clone());
        links.push((text[..index].chars().count(), square));
        start = index + 2;
    }
    job.append(&text[start..], 0.0, normal);
    let galley = ui.fonts_mut(|fonts| fonts.layout_job(job));
    let (rect, response) = ui.allocate_exact_size(galley.size(), egui::Sense::hover());
    let mut offset = 0;
    for row in &galley.rows {
        let end = offset + row.glyphs.len();
        for &(index, square) in &links {
            let first = index.max(offset);
            let last = (index + 2).min(end);
            if first >= last {
                continue;
            }
            let hit = egui::Rect::from_x_y_ranges(
                (rect.min.x + row.pos.x + row.glyphs[first - offset].pos.x)
                    ..=(rect.min.x + row.pos.x + row.glyphs[last - offset - 1].max_x()),
                (rect.min.y + row.pos.y)..=(rect.min.y + row.pos.y + row.size.y),
            );
            let link = ui.interact(hit, response.id.with((index, offset)), egui::Sense::click());
            if link.clicked() {
                *selected = if selected.as_deref() == Some(square) { None } else { Some(square.to_owned()) };
            }
            let link = link.on_hover_cursor(egui::CursorIcon::PointingHand);
            if link.hovered() || link.has_focus() && !ui.ctx().input(|input| input.pointer.has_pointer()) {
                *hovered = Some(square.to_owned());
            }
        }
        offset = end + usize::from(row.ends_with_newline);
    }
    ui.painter().galley(rect.min, galley, COACH_INK);
}

fn screen_keyboard(ctx: &egui::Context) -> bool {
    !ctx.egui_wants_keyboard_input()
}

fn move_control<T>(ui: &mut egui::Ui, rect: egui::Rect, content: impl FnOnce(&mut egui::Ui) -> T) -> T {
    let mut slot = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect)
            .layout(egui::Layout::top_down(egui::Align::Center)),
    );
    content(&mut slot)
}

fn step_button(
    ui: &mut egui::Ui,
    art: &Art,
    icon: Icon,
    label: &str,
    reduced: bool,
) -> egui::Response {
    let response = ui
        .add_sized([ui.available_width().min(34.0), 34.0], egui::Button::new("").frame(false))
        .on_hover_text(label);
    response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, label));
    let time = ui.input(|input| input.time);
    let id = response.id.with("release");
    if response.clicked() && !reduced {
        ui.data_mut(|data| data.insert_temp(id, time));
    }
    let phase = if reduced {
        1.0
    } else {
        ui.data(|data| data.get_temp::<f64>(id))
            .map_or(1.0, |since| ((time - since) / 0.34).clamp(0.0, 1.0)) as f32
    };
    let held = response.is_pointer_button_down_on() && !reduced;
    let light = if held {
        0.23
    } else {
        0.25 * (1.0 - phase).powi(2)
    };
    if light > 0.0 {
        ui.painter().rect_filled(
            response.rect.shrink(if held { 3.0 } else { 1.0 }),
            8.0,
            ACCENT.gamma_multiply(light),
        );
        ui.ctx().request_repaint();
    }
    let direction = if matches!(icon, Icon::First | Icon::Previous) {
        -1.0
    } else {
        1.0
    };
    let bounce = if phase < 0.62 {
        (std::f32::consts::PI * phase / 0.62).sin() * 3.0 * direction
    } else {
        0.0
    };
    let size = if held { 18.0 } else { 21.0 };
    let center = response.rect.center() + Vec2::new(bounce, 0.0);
    ui.painter().image(
        art.icons[icon as usize].id(),
        egui::Rect::from_center_size(center, Vec2::splat(size)),
        egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)),
        ui.visuals().text_color(),
    );
    response
}

fn move_counter(ui: &mut egui::Ui, ply: usize, total: usize, motion: Option<&Motion>) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 34.0), egui::Sense::hover());
    let phase = motion.map_or(1.0, |motion| {
        (motion.start.elapsed().as_secs_f32() / 0.19).min(1.0)
    });
    let remaining = (1.0 - phase).powi(3);
    let offset = 5.0
        * remaining
        * if motion.is_some_and(|motion| motion.reverse) {
            -1.0
        } else {
            1.0
        };
    let format = egui::FontId::monospace(13.0);
    let ink = ui.visuals().text_color();
    let current = ui.painter().layout_no_wrap(ply.to_string(), format.clone(), ink);
    let suffix = ui.painter().layout_no_wrap(format!("/{total}"), format.clone(), ink);
    let divider = rect.center().x + (current.size().x - suffix.size().x) * 0.5;
    let point = egui::pos2(divider, rect.center().y + offset);
    ui.painter().text(
        point,
        egui::Align2::RIGHT_CENTER,
        ply,
        format.clone(),
        ui.visuals()
            .text_color()
            .gamma_multiply(1.0 - 0.55 * remaining),
    );
    ui.painter().text(
        egui::pos2(divider, rect.center().y),
        egui::Align2::LEFT_CENTER,
        format!("/{total}"),
        format,
        ui.visuals().text_color(),
    );
    if phase < 1.0 {
        ui.ctx().request_repaint();
    }
}

fn quality(label: Label) -> (&'static str, Color32) {
    let (symbol, rgb) = match label {
        Label::Book => ("book", [150, 108, 72]),
        Label::Best => ("★", [99, 135, 74]),
        Label::Excellent => ("✓", [107, 131, 72]),
        Label::Good => ("+", [124, 136, 82]),
        Label::Inaccuracy => ("?!", [165, 137, 52]),
        Label::Mistake => ("?", [201, 150, 52]),
        Label::Blunder => ("??", [185, 73, 58]),
        Label::Miss => ("×", [169, 88, 100]),
        Label::Great => ("!", [76, 125, 157]),
        Label::Sacrifice => ("!!", [58, 143, 144]),
    };
    (symbol, Color32::from_rgb(rgb[0], rgb[1], rgb[2]))
}

impl ChessAsh {
    fn review_details(&mut self, ui: &mut egui::Ui) {
        appearance::panel(ui)
            .inner_margin(egui::Margin::symmetric(16, 0))
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                ui.allocate_ui_with_layout(
                    Vec2::new(ui.available_width(), 54.0),
                    egui::Layout::left_to_right(egui::Align::Center),
                    |ui| {
                        review_tab(
                            ui,
                            &self.art,
                            Icon::Book,
                            &mut self.tab,
                            ReviewTab::Review,
                            "Review",
                        );
                        review_tab(
                            ui,
                            &self.art,
                            Icon::Search,
                            &mut self.tab,
                            ReviewTab::Explore,
                            "Explore",
                        );
                        #[cfg(windows)]
                        review_tab(
                            ui,
                            &self.art,
                            Icon::Message,
                            &mut self.tab,
                            ReviewTab::Tutor,
                            "Tutor",
                        );
                    },
                );
            });
        ui.add_space(6.0);
        if self.tab == ReviewTab::Explore {
            appearance::panel(ui).show(ui, |ui| self.explore(ui));
            return;
        }
        #[cfg(windows)]
        if self.tab == ReviewTab::Tutor {
            if let Some(game) = &self.game {
                appearance::panel(ui).show(ui, |ui| {
                    self.tutor.show(
                        ui,
                        self.store.as_mut(),
                        game,
                        self.ply,
                        self.variation.last().map(String::as_str),
                        self.italian,
                        &platform::executable(&self.platform.engines, "stockfish"),
                        &self.board,
                    );
                });
            }
            return;
        }
        let Some(game) = &self.game else { return };
        let results = self.review_rows(game);
        let busy = self.cancel.is_some();
        let complete = game.review.as_ref().is_some_and(|review| review.completed);
        let total = game.moves.len();
        let mut start = false;
        let mut seek = None;
        let mut filter = self.quality_filter;
        let mut short = self.short_review;
        appearance::panel(ui).inner_margin(16).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.heading(if complete {
                self.tr("Your review", "La tua analisi")
            } else {
                self.tr("Review this game", "Analizza questa partita")
            });
            if results.is_empty() {
                ui.label(self.tr(
                    "Find the moments that mattered and try a better move.",
                    "Trova i momenti decisivi e prova una mossa migliore.",
                ));
            } else {
                ui.add_space(12.0);
                let caption = self.tr("Accuracy", "Precisione");
                ui.columns(2, |columns| {
                    for (index, side, key) in
                        [(0, Color::White, "White"), (1, Color::Black, "Black")]
                    {
                        let name = game
                            .headers
                            .get(key)
                            .filter(|name| *name != "?")
                            .map_or(key, String::as_str);
                        appearance::accuracy(
                            &mut columns[index],
                            accuracy(results, Some(side)),
                            name,
                            caption,
                        );
                    }
                });
            }
            ui.add_space(10.0);
            ui.allocate_ui_with_layout(
                Vec2::new(ui.available_width(), 36.0),
                egui::Layout::left_to_right(egui::Align::Center),
                |ui| {
                    if busy {
                        ui.add_enabled(
                            false,
                            appearance::primary(self.tr("Analysing…", "Analisi in corso…")),
                        );
                        if ui.button(self.tr("Pause", "Pausa")).clicked()
                            && let Some(cancel) = &self.cancel
                        {
                            cancel.store(true, Ordering::Relaxed);
                        }
                    } else if complete {
                        self.art.icon(ui, Icon::Check, 14.0, ACCENT);
                        ui.label(
                            RichText::new(self.tr("Review saved", "Analisi salvata"))
                                .color(ACCENT)
                                .size(12.0),
                        );
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            start = ui
                                .add_enabled(
                                    self.events.is_none(),
                                    egui::Button::new(
                                        RichText::new(self.tr("Reanalyse", "Rianalizza"))
                                            .size(12.0),
                                    )
                                    .min_size(Vec2::new(80.0, 36.0)),
                                )
                                .clicked();
                        });
                    } else {
                        let title = if results.is_empty() {
                            self.tr("Start review", "Inizia analisi")
                        } else {
                            self.tr("Continue review", "Continua analisi")
                        };
                        start = ui
                            .add_enabled(self.events.is_none(), appearance::primary(title))
                            .clicked();
                    }
                },
            );
            if busy {
                ui.add(
                    egui::ProgressBar::new(results.len() as f32 / total.max(1) as f32)
                        .show_percentage(),
                );
            }
            if !results.is_empty() {
                ui.add_space(18.0);
                egui::Frame::new()
                    .fill(Color32::from_rgb(66, 73, 59))
                    .corner_radius(16)
                    .inner_margin(14)
                    .show(ui, |ui| {
                        ui.set_min_width(ui.available_width());
                        ui.collapsing(self.tr("Move quality", "Qualità delle mosse"), |ui| {
                            let names = self.names();
                            let gap = 10.0;
                            let size = 11.0;
                            let width = ui.available_width();
                            let digits = results.len().to_string().len();
                            let count_width = ui.painter().layout_no_wrap(
                                format!("{:0>digits$}  {:0>digits$}", 0, 0),
                                egui::FontId::monospace(11.0),
                                ui.visuals().text_color(),
                            ).size().x;
                            let longest_name = QUALITY_ORDER.iter().map(|label| {
                                ui.painter().layout_no_wrap(
                                    label.name(names).to_owned(),
                                    egui::FontId::proportional(size),
                                    ui.visuals().text_color(),
                                ).size().x
                            }).fold(0.0_f32, f32::max);
                            let cell_min = 16.0 + 12.0 + longest_name + count_width;
                            let columns = if width >= cell_min * 2.0 + gap { 2 } else { 1 };
                            let cell = (width - gap * (columns - 1) as f32) / columns as f32;
                            for labels in QUALITY_ORDER.chunks(columns) {
                                ui.horizontal(|ui| {
                                    ui.spacing_mut().item_spacing.x = gap;
                                    for &label in labels {
                                        let (_, color) = quality(label);
                                        let mut counts = [0, 0];
                                        let mut first = None;
                                        for row in results.iter().filter(|row| row.label == label) {
                                            counts[usize::from(row.color == Color::Black)] += 1;
                                            first.get_or_insert(row.ply);
                                        }
                                        ui.allocate_ui_with_layout(
                                            Vec2::new(cell, 24.0),
                                            egui::Layout::left_to_right(egui::Align::Center),
                                            |ui| {
                                                ui.spacing_mut().item_spacing.x = 4.0;
                                                quality_icon(ui, label, color);
                                                let name = label.name(names);
                                                let name_width = (ui.available_width() - count_width - 4.0).max(0.0);
                                                if ui.add_sized(
                                                    [name_width, 24.0],
                                                    egui::Button::new(RichText::new(name).size(size))
                                                        .selected(filter == Some(label))
                                                        .frame_when_inactive(filter == Some(label))
                                                        .truncate(),
                                                ).on_hover_text(name).clicked() {
                                                    filter = if filter == Some(label) { None } else { Some(label) };
                                                    seek = first;
                                                }
                                                ui.add_sized(
                                                    [count_width, 24.0],
                                                    egui::Label::new(
                                                        RichText::new(format!("{:>digits$}  {:>digits$}", counts[0], counts[1]))
                                                            .monospace()
                                                            .size(11.0),
                                                    ).extend(),
                                                );
                                            },
                                        );
                                    }
                                });
                            }
                        });
                    });
            }
        });
        ui.add_space(6.0);
        if !results.is_empty() {
            soft_panel(ui, 16).show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.heading(self.tr("Turning points", "Momenti decisivi"));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.selectable_value(&mut short, false, self.tr("Full", "Completa"));
                        ui.selectable_value(&mut short, true, self.tr("Short", "Breve"));
                    });
                });
                let rows = turning_points(results, short, filter);
                ui.add_space(8.0);
                ui.horizontal_wrapped(|ui| {
                    for row in &rows {
                        let (symbol, color) = quality(row.label);
                        let san = row.san.as_deref().unwrap_or(&row.r#move);
                        let index = row.ply.saturating_sub(1);
                        let number = game
                            .positions
                            .get(index)
                            .and_then(|fen| fen.split_whitespace().nth(5))
                            .unwrap_or("1");
                        let punctuation = if row.color == Color::White {
                            "."
                        } else {
                            "…"
                        };
                        let selected = self.ply == row.ply;
                        let ink = if selected { ui.visuals().text_color() } else { color };
                        let icon = egui::Atom::custom(ui.id().with(row.ply), Vec2::splat(14.0));
                        let text = RichText::new(format!("{number}{punctuation} {san}"))
                            .size(12.0)
                            .color(ink);
                        let response = ui.add(egui::Button::selectable(selected, (icon, text)));
                        let center = response.rect.left_center()
                            + Vec2::new(ui.spacing().button_padding.x + 7.0, 0.0);
                        board::paint_quality_icon(ui.painter(), center, 11.0, symbol, ink);
                        if response.clicked() {
                            seek = Some(row.ply);
                        }
                    }
                    if rows.is_empty() {
                        ui.small(self.tr(
                            "No matching turning points.",
                            "Nessun momento decisivo corrispondente.",
                        ));
                    }
                });
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    if ui
                        .add(
                            egui::Button::new(
                                RichText::new(self.tr("‹  Previous", "‹  Precedente")).size(12.0),
                            )
                            .frame(false),
                        )
                        .clicked()
                    {
                        seek = rows
                            .iter()
                            .rev()
                            .find(|row| row.ply < self.ply)
                            .map(|row| row.ply);
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui
                            .add(
                                egui::Button::new(
                                    RichText::new(
                                        self.tr("Next moment  ›", "Momento successivo  ›"),
                                    )
                                    .size(12.0),
                                )
                                .frame(false),
                            )
                            .clicked()
                        {
                            seek = rows
                                .iter()
                                .find(|row| row.ply > self.ply)
                                .map(|row| row.ply);
                        }
                    });
                });
            });
        }
        ui.add_space(6.0);
        soft_panel(ui, 9).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            egui::CollapsingHeader::new(format!(
                "{}     {total} {}",
                self.tr("All moves", "Tutte le mosse"),
                self.tr("moves", "mosse")
            ))
            .default_open(self.prefs.advanced)
            .show(ui, |ui| {
                if let Some(ply) = move_list(
                    ui,
                    game,
                    results,
                    self.ply,
                    filter,
                    self.names(),
                    self.prefs.advanced,
                ) {
                    seek = Some(ply);
                }
            });
        });
        self.quality_filter = filter;
        self.short_review = short;
        if let Some(ply) = seek {
            self.set_ply(ply);
        }
        if start {
            self.review(ui.ctx().clone(), complete);
        }
    }

    fn review_rows<'a>(&'a self, game: &'a Game) -> &'a [MoveReview] {
        if self.cancel.is_some() {
            &self.latest
        } else {
            game.review
                .as_ref()
                .map(|review| review.results.as_slice())
                .unwrap_or_default()
        }
    }

    fn advantage(&mut self, ui: &mut egui::Ui) {
        let Some(game) = &self.game else { return };
        let results = self.review_rows(game);
        if results.is_empty() {
            return;
        }
        let total = game.moves.len();
        let mut seek = None;
        appearance::panel(ui).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            egui::CollapsingHeader::new(self.tr("Game advantage", "Vantaggio nella partita"))
                .default_open(self.prefs.graph)
                .show(ui, |ui| {
                    ui.label(RichText::new(self.tr("Above the middle favours White. Below favours Black. Select a point to revisit that moment.", "Sopra il centro è meglio per il Bianco. Sotto, per il Nero. Seleziona un punto per tornare a quella mossa.")).size(12.0));
                    ui.add_space(8.0);
                    let (area, input) = ui.allocate_exact_size(
                        Vec2::new(ui.available_width(), 64.0),
                        egui::Sense::click_and_drag(),
                    );
                    let painter = ui.painter_at(area);
                    painter.rect_filled(area, 4.0, ui.visuals().extreme_bg_color);
                    let y = |score: i32| area.center().y - (score as f32 / 450.0).tanh() * (area.height() / 2.0 - 4.0);
                    let x =
                        |ply: usize| area.left() + ply as f32 / total.max(1) as f32 * area.width();
                    let mut points = vec![egui::pos2(area.left(), y(results[0].before))];
                    points.extend(
                        results
                            .iter()
                            .map(|row| egui::pos2(x(row.ply), y(row.after))),
                    );
                    let mut fill = egui::Mesh::default();
                    let uv = egui::epaint::WHITE_UV;
                    for point in &points {
                        let mid = area.center().y;
                        let positive = point.y <= mid;
                        let color = if positive { Color32::from_white_alpha(122) } else { Color32::from_black_alpha(85) };
                        fill.vertices.push(egui::epaint::Vertex {pos:*point,uv,color});
                        fill.vertices.push(egui::epaint::Vertex {pos:egui::pos2(point.x,mid),uv,color:Color32::TRANSPARENT});
                    }
                    for i in 1..points.len() as u32 { let a=(i-1)*2;fill.indices.extend([a,a+2,a+1,a+1,a+2,a+3]); }
                    painter.add(egui::Shape::mesh(fill));
                    painter.line_segment(
                        [area.left_center(), area.right_center()],
                        egui::Stroke::new(1.0_f32, Color32::from_rgb(123, 141, 109)),
                    );
                    painter.add(egui::Shape::line(
                        points,
                        egui::Stroke::new(2.0_f32, Color32::from_rgb(214, 231, 202)),
                    ));
                    painter.line_segment(
                        [
                            egui::pos2(x(self.ply), area.top()),
                            egui::pos2(x(self.ply), area.bottom()),
                        ],
                        egui::Stroke::new(1.0_f32, ACCENT),
                    );
                    if (input.clicked() || input.dragged())
                        && let Some(point) = input.interact_pointer_pos()
                    {
                        seek = Some(
                            ((point.x - area.left()) / area.width() * total as f32)
                                .round()
                                .max(0.0) as usize,
                        );
                    }
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(self.tr("White above / Black below","Bianco sopra / Nero sotto")).size(11.0));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center),|ui| {ui.small(format!("{} {} / {}",self.tr("Move","Mossa"),self.ply.div_ceil(2),total.div_ceil(2)));});
                    });
                });
        });
        if let Some(ply) = seek {
            self.set_ply(ply);
        }
    }

    fn explore(&mut self, ui: &mut egui::Ui) {
        let Some(fen) = self
            .variation
            .last()
            .or_else(|| self.game.as_ref()?.positions.get(self.ply))
            .cloned()
        else {
            return;
        };
        ui.heading(self.tr("Explore the position", "Esplora la posizione"));
        ui.label(self.tr("Move pieces to explore an alternative. Ask the engine to compare candidate lines.",
            "Muovi i pezzi per esplorare un’alternativa. Chiedi al motore di confrontare le continuazioni."));
        if ui
            .add_enabled(
                self.events.is_none(),
                appearance::primary(self.tr("Evaluate position", "Valuta posizione")),
            )
            .clicked()
        {
            let (tx, rx) = mpsc::channel();
            let path = platform::executable(&self.platform.engines, "stockfish");
            let depth = self.prefs.depth;
            let ctx = ui.ctx().clone();
            self.events = Some(rx);
            let search_fen = fen.clone();
            std::thread::spawn(move || {
                let mut engine = UciEngine::new(path);
                let options = chessash_review_engine::SearchOptions {
                    depth,
                    multi_pv: 3,
                    ..Default::default()
                };
                let result = engine
                    .analyze(&search_fen, options)
                    .map_err(|error| error.to_string());
                let _ = tx.send(Event::Position(result));
                ctx.request_repaint();
            });
        }
        let mut line = None;
        if let Some(result) = self
            .position_result
            .as_ref()
            .filter(|result| result.fen == fen)
        {
            for candidate in &result.lines {
                let san = chessash_review_core::variation_san(&fen, &candidate.pv);
                let score = format!("{:+.2}", candidate.score as f32 / 100.0);
                if ui.button(format!("{score}    {}", san.join(" "))).clicked() {
                    line = Some(candidate.pv.clone());
                }
            }
        }
        if let Some(line) = line {
            self.preview_line(fen, line);
        }
        ui.label(self.tr("Position notes", "Note sulla posizione"));
        if ui
            .add(
                egui::TextEdit::multiline(&mut self.note)
                    .hint_text("What did you notice?")
                    .desired_rows(3)
                    .desired_width(f32::INFINITY),
            )
            .changed()
        {
            if let Some(game) = &mut self.game {
                let notes = game.notes.get_or_insert_with(Default::default);
                if self.note.is_empty() {
                    notes.remove(&self.ply);
                } else {
                    notes.insert(self.ply, self.note.clone());
                }
            }
            self.persist();
        }
        if let Some(game) = &self.game
            && let Some(ply) = move_list(
                ui,
                game,
                self.review_rows(game),
                self.ply,
                None,
                self.names(),
                self.prefs.advanced,
            )
        {
            self.set_ply(ply);
        }
    }

    fn library(&mut self, ui: &mut egui::Ui) {
        match self.library.show(
            ui,
            accounts::LibraryView {
                games: &self.games,
                main: self.main_account.as_ref(),
                sync: &self.sync,
                syncing: self.syncing,
                busy: self.events.is_some(),
                italian: self.italian,
            },
        ) {
            Some(accounts::Action::Open(id)) => {
                if let Some(game) = self.games.iter().find(|game| game.id == id).cloned() {
                    self.select(game);
                }
            }
            Some(accounts::Action::Delete(id)) => self.confirm_delete = Some(id),
            Some(accounts::Action::Main(account)) => {
                let key = account.as_ref().map_or("", Account::key).to_owned();
                self.set_setting(accounts::MAIN_KEY, &key);
                self.sync = Sync::restored(
                    sync_times(self.store.as_ref())
                        .get(&key)
                        .copied()
                        .unwrap_or_default(),
                );
                self.main_account = account;
                if let Some(account) = &self.main_account {
                    let updated: Vec<_> = self
                        .games
                        .iter_mut()
                        .filter_map(|game| {
                            accounts::migrate_legacy_game(game, account).then(|| game.clone())
                        })
                        .collect();
                    if let Some(store) = &mut self.store
                        && let Err(error) = store.save_games(&updated)
                    {
                        self.message = error.to_string();
                    }
                }
            }
            Some(accounts::Action::Sync) => self.start_sync(ui.ctx()),
            Some(accounts::Action::Import) => self.dialog = Some(Dialog::Import),
            None => {}
        }

        if let Some(id) = self.confirm_delete.clone() {
            egui::Window::new("Delete saved game?")
                .collapsible(false)
                .show(ui.ctx(), |ui| {
                    ui.horizontal(|ui| {
                        if ui.button("Cancel").clicked() {
                            self.confirm_delete = None;
                        }
                        if ui.button("Delete game").clicked() {
                            let result = self
                                .store
                                .as_mut()
                                .map(|store| store.delete_game(&id))
                                .transpose();
                            match result {
                                Ok(_) => {
                                    if self.game.as_ref().is_some_and(|game| game.id == id) {
                                        self.game = None;
                                    }
                                    self.games.retain(|game| game.id != id);
                                }
                                Err(error) => self.message = error.to_string(),
                            }
                            self.confirm_delete = None;
                        }
                    });
                });
        }
    }

    fn show_dialog(&mut self, ctx: &egui::Context, dialog: Dialog) {
        let title = match dialog {
            Dialog::Import => self.tr("Bring your games", "Importa le tue partite"),
            Dialog::Settings => self.tr("Make it yours", "Personalizza"),
            Dialog::Share => self.tr("Share game review", "Condividi analisi"),
        };
        let width = (ctx.content_rect().width() - 24.0).clamp(240.0, 520.0);
        let (top, bottom) = self.platform.vertical_insets();
        let max_height =
            (ctx.content_rect().height() - (top + bottom) / ctx.pixels_per_point() - 50.0)
                .max(180.0);
        let id = egui::Id::new(("chessash-dialog", title));
        let area = egui::Modal::default_area(id).default_size(Vec2::new(
            width,
            if dialog != Dialog::Share {
                max_height
            } else {
                420.0
            },
        ));
        let response = egui::Modal::new(id)
            .area(area)
            .backdrop_color(Color32::from_rgba_unmultiplied(9, 18, 8, 202))
            .frame(appearance::panel_for_modal(&ctx.global_style()))
            .show(ctx, |ui| {
                ui.set_width(width - 32.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new(title).size(19.0).strong());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui
                            .add(egui::Button::new(RichText::new("×").size(24.0)).frame(false))
                            .on_hover_text("Close dialog")
                            .clicked()
                        {
                            self.dialog = None;
                        }
                    });
                });
                ui.add_space(14.0);
                egui::ScrollArea::vertical()
                    .max_height((max_height - 65.0).max(110.0))
                    .auto_shrink([false, true])
                    .show(ui, |ui| match dialog {
                        Dialog::Import => self.import_dialog(ui),
                        Dialog::Settings => self.settings(ui),
                        Dialog::Share => self.share(ui),
                    });
            });
        if response.should_close() {
            self.dialog = None;
        }
    }

    fn import_dialog(&mut self, ui: &mut egui::Ui) {
        let width = ui.available_width();
        ui.style_mut().override_text_style = Some(egui::TextStyle::Button);
        let italy = self.italian;
        let tr = |en, it| if italy { it } else { en };
        ui.spacing_mut().item_spacing.y = 10.0;
        appearance::field_style(ui);
        ui.label(tr("Game source", "Origine delle partite"));
        appearance::field_combo(
            "import-provider",
            width,
            if self.provider == Provider::ChessCom {
                "Chess.com"
            } else {
                "Lichess"
            },
        )
        .show_ui(ui, |ui| {
            ui.selectable_value(&mut self.provider, Provider::ChessCom, "Chess.com");
            ui.selectable_value(&mut self.provider, Provider::Lichess, "Lichess");
        });
        let chesscom = self.provider == Provider::ChessCom;
        ui.label(if chesscom {
            tr(
                "Use your public Chess.com username. No password needed.",
                "Usa il tuo nome utente pubblico di Chess.com. Non serve una password.",
            )
        } else {
            tr(
                "Use a public Lichess username or game link. No password needed.",
                "Usa un nome utente pubblico o un link Lichess. Non serve una password.",
            )
        });
        ui.add_space(3.0);
        ui.label(if chesscom {
            "Chess.com username"
        } else {
            "Lichess username"
        });
        ui.add_sized(
            [width, 44.0],
            egui::TextEdit::singleline(&mut self.username)
                .margin(egui::Margin::symmetric(12, 8))
                .hint_text(tr("Your username", "Il tuo nome utente")),
        );
        appearance::checkbox(
            ui,
            &mut self.import_as_main,
            tr(
                "This is my account. Keep it synced.",
                "È il mio account. Tienilo sincronizzato.",
            ),
        );
        if let Some(account) = self.main_account.as_ref().filter(|_| !self.import_as_main) {
            ui.label(format!(
                "{} {}.",
                tr(
                    "These games will have their own collection. Your main account stays",
                    "Queste partite avranno la loro raccolta. Il tuo account principale resta"
                ),
                account.title()
            ));
        }
        ui.label(if chesscom {
            tr("Archives", "Archivi")
        } else {
            tr("Date range", "Intervallo di date")
        });
        let period = |months| {
            if italy {
                format!("Ultimi {months} mesi")
            } else if months == 1 {
                "Latest month".into()
            } else {
                format!("Latest {months} months")
            }
        };
        appearance::field_combo("import-date-range", width, period(self.months)).show_ui(
            ui,
            |ui| {
                for months in [1, 3, 6, 12, 24] {
                    ui.selectable_value(&mut self.months, months, period(months));
                }
            },
        );
        ui.label(tr(
            "Specific game link (optional)",
            "Link della partita (opzionale)",
        ));
        ui.add_sized(
            [width, 44.0],
            egui::TextEdit::singleline(&mut self.link)
                .margin(egui::Margin::symmetric(12, 8))
                .hint_text(if chesscom {
                    "https://www.chess.com/game/live/…"
                } else {
                    "https://lichess.org/…"
                }),
        );
        let available = self.events.is_none()
            && (!self.username.trim().is_empty() || (!chesscom && !self.link.trim().is_empty()));
        ui.add_enabled_ui(available, |ui| {
            if ui
                .add_sized(
                    [width, 40.0],
                    appearance::primary(tr("Fetch finished games", "Importa partite concluse")),
                )
                .clicked()
            {
                self.online_import(ui.ctx());
            }
        });
        ui.label(if chesscom {
            tr(
                "New games may take time to appear in Chess.com’s public archives.",
                "Le nuove partite possono richiedere tempo per apparire negli archivi pubblici.",
            )
        } else {
            tr(
                "Imports up to 300 finished standard games.",
                "Importa fino a 300 partite standard concluse.",
            )
        });
        ui.separator();
        ui.vertical_centered(|ui| ui.label(tr("Or import a PGN", "Oppure importa un PGN")));
        if ui
            .add_enabled(
                self.pending_file.is_none() && self.events.is_none(),
                egui::Button::new(tr("Choose PGN file", "Scegli file PGN"))
                    .min_size(Vec2::new(width, 44.0)),
            )
            .clicked()
        {
            self.pending_file = Some((false, self.platform.open(ui.ctx().clone(), "pgn")));
        }
        {
            ui.add(
                egui::TextEdit::multiline(&mut self.pgn)
                    .hint_text(tr("Paste PGN moves here…", "Incolla le mosse PGN…"))
                    .desired_width(width)
                    .desired_rows(5)
                    .margin(egui::Margin::symmetric(12, 10)),
            );
            if ui
                .add_enabled(
                    !self.pgn.trim().is_empty() && self.events.is_none(),
                    egui::Button::new("Import PGN"),
                )
                .clicked()
            {
                self.import_pgn(&self.pgn.clone());
            }
        }
        if ui
            .add_enabled(
                self.events.is_none(),
                egui::Button::new(
                    RichText::new(tr("Use the Opera game sample", "Usa la Partita dell’opera"))
                        .color(ACCENT),
                )
                .frame(false),
            )
            .clicked()
        {
            if let Ok(game) = parse_pgn(include_str!("../assets/opera.pgn"), "Sample") {
                self.import_games(vec![game], true);
            }
        }
        if !self.message.is_empty() {
            ui.label(&self.message);
        }
    }

    fn online_import(&mut self, context: &egui::Context) {
        let (tx, rx) = mpsc::channel();
        let (provider, username, link, months) = (
            self.provider,
            self.username.clone(),
            self.link.clone(),
            self.months,
        );
        let context = context.clone();
        self.set_setting(
            "chessash:import-provider",
            if provider == Provider::Lichess {
                "lichess"
            } else {
                "chesscom"
            },
        );
        if provider == Provider::ChessCom {
            self.set_setting("chessash:username", username.trim());
        }
        let main = self
            .import_as_main
            .then(|| Account::from_provider(&username, provider))
            .flatten();
        self.message = "Importing completed games…".into();
        self.events = Some(rx);
        std::thread::spawn(move || {
            let result = import::online(provider, &username, &link, months).map(|mut games| {
                if let Some(account) = Account::from_provider(&username, provider) {
                    accounts::associate_games(&mut games, &account);
                }
                games
            });
            let _ = tx.send(Event::Import(result, false, main));
            context.request_repaint();
        });
    }

    fn start_sync(&mut self, context: &egui::Context) {
        if self.events.is_some() {
            return;
        }
        let Some(account) = self.main_account.clone() else {
            return;
        };
        let (tx, rx) = mpsc::channel();
        self.events = Some(rx);
        self.syncing = true;
        let context = context.clone();
        std::thread::spawn(move || {
            let result =
                import::online(account.provider(), account.username(), "", 2).map(|mut games| {
                    accounts::associate_games(&mut games, &account);
                    games
                });
            let _ = tx.send(Event::Import(result, true, None));
            context.request_repaint();
        });
    }

    fn settings(&mut self, ui: &mut egui::Ui) {
        let old = serde_json::to_string(&self.prefs).ok();
        let language = self.italian;
        let width = ui.available_width();
        let italy = self.italian;
        let tr = |en, it| if italy { it } else { en };
        ui.spacing_mut().item_spacing.y = 10.0;
        ui.style_mut().override_text_style = Some(egui::TextStyle::Button);
        appearance::field_style(ui);
        setting_select(
            ui,
            "settings-language",
            tr("Language", "Lingua"),
            &mut self.italian,
            [(false, "English"), (true, "Italiano")],
            width,
        );
        setting_select(
            ui,
            "settings-quality",
            tr("Move-quality names", "Nomi delle qualità delle mosse"),
            &mut self.prefs.quality_names,
            [
                ("chessash".into(), "ChessAsh"),
                ("chesscom".into(), "Chess.com"),
            ],
            width,
        );
        setting_select(
            ui,
            "settings-theme",
            tr("Appearance", "Aspetto"),
            &mut self.prefs.theme,
            [
                ("dark".into(), tr("Dark", "Scuro")),
                ("light".into(), tr("Light", "Chiaro")),
            ],
            width,
        );
        setting_select(
            ui,
            "settings-font",
            tr("Text size", "Dimensione del testo"),
            &mut self.prefs.font,
            [
                (16.0, tr("Standard", "Standard")),
                (18.0, tr("Large", "Grande")),
                (20.0, tr("Extra large", "Molto grande")),
            ],
            width,
        );
        appearance::checkbox(
            ui,
            &mut self.prefs.sound,
            tr("Move sounds", "Suoni delle mosse"),
        );
        appearance::checkbox(
            ui,
            &mut self.prefs.reduced,
            tr("Reduce motion", "Riduci animazioni"),
        );
        ui.collapsing(tr("Advanced", "Avanzate"), |ui| {
            ui.label(tr(
                "Extra tools for exploring positions and customising your reviews.",
                "Strumenti per esplorare le posizioni e personalizzare l’analisi.",
            ));
            appearance::checkbox(
                ui,
                &mut self.prefs.advanced,
                tr("Show analysis tools", "Mostra strumenti di analisi"),
            );
            let depth = self.prefs.depth.to_string();
            ui.label(tr("Analysis depth", "Profondità di analisi"));
            let selected = match self.prefs.depth {
                10 => tr("Battery saver", "Risparmio batteria"),
                12 => "Standard",
                16 => tr("Deep", "Profonda"),
                20 => tr("Extended", "Estesa"),
                _ => &depth,
            };
            appearance::field_combo("settings-depth", ui.available_width(), selected).show_ui(
                ui,
                |ui| {
                    for (value, title) in [
                        (10, tr("Battery saver", "Risparmio batteria")),
                        (12, "Standard"),
                        (16, tr("Deep", "Profonda")),
                        (20, tr("Extended", "Estesa")),
                    ] {
                        ui.selectable_value(&mut self.prefs.depth, value, title);
                    }
                },
            );
            appearance::checkbox(
                ui,
                &mut self.prefs.arrows,
                tr("Show suggestion arrows", "Mostra frecce di suggerimento"),
            );
            ui.collapsing(tr("Backups", "Backup"), |ui| {
                if ui
                    .add_enabled(
                        self.pending_file.is_none() && self.events.is_none(),
                        egui::Button::new("Import V1.5 backup"),
                    )
                    .clicked()
                {
                    self.pending_file = Some((true, self.platform.open(ui.ctx().clone(), "json")));
                }
                #[cfg(windows)]
                if ui
                    .button("Recover V1.5 tutor credential")
                    .on_hover_text(
                        "Read the local Windows credential from the installed V1.5 profile.",
                    )
                    .clicked()
                    && let Some(store) = &mut self.store
                    && let Some(appdata) = std::env::var_os("APPDATA")
                {
                    self.message = match store.import_windows_tutor_credential(
                        &std::path::PathBuf::from(appdata).join("chessash"),
                    ) {
                        Ok(true) => "V1.5 tutor credential recovered.".into(),
                        Ok(false) => "No V1.5 tutor credential found.".into(),
                        Err(error) => error.to_string(),
                    };
                }
            });
        });
        ui.separator();
        ui.collapsing(tr("About your review","Informazioni sull’analisi"), |ui| {
            ui.label(tr("ChessAsh uses Stockfish and Foxash to review your games. Accuracy reflects how much each move changed your chances.", "ChessAsh usa Stockfish e Foxash. La precisione riflette quanto ogni mossa ha cambiato le tue possibilità."));
        });
        if !self.message.is_empty() {
            ui.label(&self.message);
        }
        if language != self.italian {
            self.set_setting("chessash:language", if self.italian { "it" } else { "en" });
        }
        if let Ok(new) = serde_json::to_string(&self.prefs)
            && old.as_deref() != Some(new.as_str())
        {
            self.set_setting("chessash:prefs", &new);
            appearance::style(ui.ctx(), self.prefs.theme == "light", self.prefs.font);
        }
    }

    fn share(&mut self, ui: &mut egui::Ui) {
        let names = self.names();
        let Some(game) = &self.game else { return };
        let Some(review) = &game.review else { return };
        ui.horizontal(|ui| {
            for kind in [
                card::Kind::Best,
                card::Kind::Mistake,
                card::Kind::Improvement,
            ] {
                if ui
                    .selectable_value(&mut self.card_kind, kind, kind.label())
                    .changed()
                {
                    self.card_index = 0;
                }
            }
        });
        let mut candidates = review
            .results
            .iter()
            .filter(|row| row.consequence_of.is_none())
            .filter(|row| {
                matches!(self.card_kind, card::Kind::Best)
                    && matches!(
                        row.label,
                        Label::Sacrifice
                            | Label::Great
                            | Label::Best
                            | Label::Excellent
                            | Label::Good
                    )
                    || self.card_kind == card::Kind::Mistake && row.loss > 0
                    || self.card_kind == card::Kind::Improvement
                        && row.loss > 0
                        && row.best != row.r#move
                        && game
                            .positions
                            .get(row.ply.saturating_sub(1))
                            .is_some_and(|fen| play_uci(fen, &row.best).is_some())
            })
            .collect::<Vec<_>>();
        if self.card_kind == card::Kind::Best {
            candidates.sort_by_key(|row| {
                (
                    match row.label {
                        Label::Sacrifice => 0,
                        Label::Great => 1,
                        Label::Best => 2,
                        Label::Excellent => 3,
                        _ => 4,
                    },
                    row.loss,
                    row.ply,
                )
            });
        } else {
            candidates.sort_by_key(|row| (std::cmp::Reverse(row.loss), row.ply));
        }
        let Some(row) = candidates
            .get(self.card_index.min(candidates.len().saturating_sub(1)))
            .copied()
        else {
            ui.label("No reviewed moves match this card.");
            return;
        };
        ui.horizontal(|ui| {
            if ui.button("◀").clicked() {
                self.card_index = self.card_index.saturating_sub(1);
            }
            ui.label(format!(
                "{} · {}",
                row.san.as_deref().unwrap_or(&row.r#move),
                row.label.name(names)
            ));
            if ui.button("▶").clicked() {
                self.card_index = (self.card_index + 1).min(candidates.len() - 1);
            }
        });
        ui.checkbox(&mut self.card_names, "Show player names");
        if ui
            .button(if cfg!(target_os = "android") {
                "Share"
            } else {
                "Save PNG"
            })
            .clicked()
        {
            let result = card::image(game, row, self.card_kind, names, self.card_names)
                .and_then(|png| self.platform.share_png("ChessAsh review.png", &png));
            if let Err(error) = result {
                self.message = error;
            }
        }
        ui.small("github.com/FlameFirelife/ChessAsh");
    }
}

fn sync_times(store: Option<&Store>) -> std::collections::BTreeMap<String, u64> {
    store
        .and_then(|store| store.local_setting(accounts::SYNC_TIMES_KEY).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

const QUALITY_ORDER: [Label; 10] = [
    Label::Sacrifice,
    Label::Great,
    Label::Best,
    Label::Excellent,
    Label::Good,
    Label::Book,
    Label::Inaccuracy,
    Label::Mistake,
    Label::Miss,
    Label::Blunder,
];

fn turning_points(rows: &[MoveReview], short: bool, filter: Option<Label>) -> Vec<&MoveReview> {
    let mut key: Vec<_> = rows.iter().filter(|row| row.key).collect();
    if short && key.len() > 3 {
        key.sort_by_key(|row| std::cmp::Reverse(row.loss));
        key.truncate(3);
        key.sort_by_key(|row| row.ply);
    }
    if let Some(label) = filter {
        key.retain(|row| row.label == label);
    }
    key
}

fn move_list(
    ui: &mut egui::Ui,
    game: &Game,
    results: &[MoveReview],
    current: usize,
    filter: Option<Label>,
    names: QualityNames,
    advanced: bool,
) -> Option<usize> {
    let mut seek = None;
    egui::ScrollArea::vertical()
        .id_salt("moves")
        .max_height(245.0)
        .show(ui, |ui| {
            for (index, san) in game.moves.iter().enumerate() {
                let ply = index + 1;
                let row = results.get(index);
                if filter.is_some_and(|label| row.is_none_or(|row| row.label != label)) {
                    continue;
                }
                let fen = game
                    .positions
                    .get(index)
                    .map(String::as_str)
                    .unwrap_or(INITIAL_FEN);
                let side = if fen.split_whitespace().nth(1) == Some("b") {
                    "…"
                } else {
                    "."
                };
                let number = fen.split_whitespace().nth(5).unwrap_or("1");
                ui.horizontal(|ui| {
                    if ui
                        .selectable_label(current == ply, format!("{number}{side} {san}"))
                        .clicked()
                    {
                        seek = Some(ply);
                    }
                    if let Some(row) = row {
                        let (_, color) = quality(row.label);
                        quality_icon(ui, row.label, color).on_hover_text(row.label.name(names));
                        if advanced {
                            ui.small(format!("{:+.2}", row.after as f32 / 100.0));
                        }
                    }
                });
            }
        });
    seek
}

fn quality_icon(ui: &mut egui::Ui, label: Label, color: Color32) -> egui::Response {
    let (symbol, _) = quality(label);
    let (area, response) = ui.allocate_exact_size(Vec2::splat(16.0), egui::Sense::hover());
    let size = if label == Label::Book { 10.0 } else { 13.0 };
    board::paint_quality_icon(ui.painter(), area.center(), size, symbol, color);
    response
}
