use std::collections::{BTreeMap, HashMap};

use chessash_review_core::Game;

use crate::import::Provider;

pub const MAIN_KEY: &str = "chessash:main-username";
pub const SYNC_TIMES_KEY: &str = "chessash:account-sync-times";
pub const SYNC_INTERVAL_MS: u64 = 120_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    key: String,
}

impl Account {
    pub fn from_key(key: &str) -> Option<Self> {
        let key = key.trim().to_ascii_lowercase();
        let (_, name) = provider_name(&key);
        if !(2..=30).contains(&name.len())
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return None;
        }
        Some(Self { key })
    }

    pub fn from_provider(username: &str, provider: Provider) -> Option<Self> {
        let key = match provider {
            Provider::ChessCom => username.trim().to_owned(),
            Provider::Lichess => format!("lichess:{}", username.trim()),
        };
        Self::from_key(&key).filter(|account| account.provider() == provider)
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn provider(&self) -> Provider {
        provider_name(&self.key).0
    }

    pub fn username(&self) -> &str {
        provider_name(&self.key).1
    }

    pub fn title(&self) -> String {
        match self.provider() {
            Provider::ChessCom => self.username().into(),
            Provider::Lichess => format!("{} · Lichess", self.username()),
        }
    }

    pub fn includes(&self, game: &Game) -> bool {
        ["White", "Black"]
            .iter()
            .filter_map(|name| game.headers.get(*name))
            .any(|name| name.trim().eq_ignore_ascii_case(self.username()))
    }
}

fn provider_name(key: &str) -> (Provider, &str) {
    match key.strip_prefix("lichess:") {
        Some(username) => (Provider::Lichess, username),
        None => (Provider::ChessCom, key),
    }
}

fn account_names(game: &Game) -> impl Iterator<Item = Account> + '_ {
    game.account_usernames
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|key| Account::from_key(key))
}

pub fn associate_games(games: &mut [Game], account: &Account) {
    for game in games {
        let mut names: Vec<_> = account_names(game).map(|account| account.key).collect();
        names.push(account.key.clone());
        names.sort();
        names.dedup();
        game.account_usernames = Some(names);
    }
}

pub fn migrate_legacy_game(game: &mut Game, account: &Account) -> bool {
    if account.provider() != Provider::ChessCom
        || game.source != "Chess.com"
        || account_names(game).next().is_some()
        || !account.includes(game)
    {
        return false;
    }
    associate_games(std::slice::from_mut(game), account);
    true
}

pub fn merge_imports(existing: &[Game], incoming: Vec<Game>) -> Vec<Game> {
    let existing: HashMap<_, _> = existing
        .iter()
        .map(|game| (game.id.as_str(), game))
        .collect();
    let mut merged = BTreeMap::<String, Game>::new();
    for incoming in incoming {
        let id = incoming.id.clone();
        if let Some(previous) = merged.get_mut(&id) {
            merge_metadata(previous, incoming);
        } else {
            let game = if let Some(previous) = existing.get(id.as_str()) {
                let mut previous = (*previous).clone();
                merge_metadata(&mut previous, incoming);
                previous
            } else {
                incoming
            };
            merged.insert(id, game);
        }
    }
    let mut games = merged.into_values().collect::<Vec<_>>();
    sort_games(&mut games);
    games
}

fn merge_metadata(previous: &mut Game, incoming: Game) {
    let mut names = account_names(previous)
        .chain(account_names(&incoming))
        .map(|name| name.key)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    if !names.is_empty() {
        previous.account_usernames = Some(names);
    }
    for (key, value) in incoming.headers {
        previous.headers.entry(key).or_insert(value);
    }
    previous.url = previous.url.take().or(incoming.url);
    previous.time_class = previous.time_class.take().or(incoming.time_class);
}

pub fn sort_games(games: &mut [Game]) {
    fn date(game: &Game) -> (&str, &str) {
        let headers = &game.headers;
        let date = headers
            .get("UTCDate")
            .filter(|date| !date.is_empty())
            .or_else(|| headers.get("Date"));
        let time = headers.get("UTCTime");
        (
            date.map_or("", String::as_str),
            time.map_or("", String::as_str),
        )
    }
    games.sort_by(|a, b| {
        date(b)
            .cmp(&date(a))
            .then(b.imported_at.cmp(&a.imported_at))
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum GroupKind {
    Main,
    Guest,
    Files,
    Earlier,
}

pub struct Group<'a> {
    pub key: String,
    pub title: String,
    pub account: Option<Account>,
    pub kind: GroupKind,
    pub games: Vec<&'a Game>,
}

pub fn groups<'a>(games: &'a [Game], main: Option<&Account>) -> Vec<Group<'a>> {
    let mut groups = BTreeMap::<String, Group<'a>>::new();
    if let Some(main) = main {
        groups.insert(
            main.key.clone(),
            account_group(main.clone(), GroupKind::Main),
        );
    }
    for game in games {
        let mut accounts: Vec<_> = account_names(game).collect();
        accounts.sort_by(|a, b| a.key.cmp(&b.key));
        accounts.dedup();
        if accounts.is_empty() {
            let (key, title, kind) = match game.source.as_str() {
                "Lichess" => ("lichess-games", "Lichess games", GroupKind::Files),
                "Chess.com" => ("earlier-imports", "Earlier imports", GroupKind::Earlier),
                _ => ("pgn-files", "PGN files and samples", GroupKind::Files),
            };
            groups
                .entry(format!("files:{key}"))
                .or_insert_with(|| Group {
                    key: format!("files:{key}"),
                    title: title.into(),
                    account: None,
                    kind,
                    games: Vec::new(),
                })
                .games
                .push(game);
        } else {
            for account in accounts {
                groups
                    .entry(account.key.clone())
                    .or_insert_with(|| account_group(account, GroupKind::Guest))
                    .games
                    .push(game);
            }
        }
    }
    let mut groups: Vec<_> = groups.into_values().collect();
    groups.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.title.cmp(&b.title)));
    groups
}

fn account_group(account: Account, kind: GroupKind) -> Group<'static> {
    Group {
        key: account.key.clone(),
        title: account.title(),
        account: Some(account),
        kind,
        games: Vec::new(),
    }
}

#[derive(Default)]
pub struct Sync {
    pub last_synced: u64,
    next_check: u64,
    failures: u32,
}

impl Sync {
    pub fn restored(last_synced: u64) -> Self {
        Self {
            last_synced,
            next_check: if last_synced == 0 {
                0
            } else {
                last_synced.saturating_add(SYNC_INTERVAL_MS)
            },
            failures: 0,
        }
    }

    pub fn due(&self, now: u64) -> bool {
        now >= self.next_check
    }

    pub fn succeeded(&mut self, now: u64) {
        *self = Self::restored(now);
    }

    pub fn failed(&mut self, now: u64) {
        let interval = (SYNC_INTERVAL_MS << self.failures.min(4)).min(1_800_000);
        self.next_check = now.saturating_add(interval);
        self.failures = self.failures.saturating_add(1);
    }
}

#[derive(Default)]
pub struct Library {
    query: String,
    review: ReviewFilter,
    result: &'static str,
    time: &'static str,
    main_draft: String,
    provider: Provider,
}

#[derive(Clone, Copy, Default, PartialEq)]
enum ReviewFilter {
    #[default]
    All,
    Complete,
    Incomplete,
}

pub enum Action {
    Open(String),
    Delete(String),
    Main(Option<Account>),
    Sync,
    Import,
}

pub struct LibraryView<'a> {
    pub games: &'a [Game],
    pub main: Option<&'a Account>,
    pub sync: &'a Sync,
    pub syncing: bool,
    pub busy: bool,
    pub italian: bool,
}

impl Library {
    pub fn show(&mut self, ui: &mut eframe::egui::Ui, view: LibraryView<'_>) -> Option<Action> {
        use eframe::egui::{self, CollapsingHeader, Color32, ComboBox, RichText, TextEdit, Vec2};
        let LibraryView {
            games,
            main,
            sync,
            syncing,
            busy,
            italian,
        } = view;
        let tr = |en, it| if italian { it } else { en };
        let mut action = None;
        let width = ui.available_width();
        ui.horizontal(|ui| {
            let text_width = (width - 120.0 - ui.spacing().item_spacing.x).max(60.0);
            ui.allocate_ui_with_layout(
                Vec2::new(text_width, 60.0),
                egui::Layout::top_down(egui::Align::Min),
                |ui| {
                    ui.set_width(text_width);
                    ui.label(
                        RichText::new(tr("Your library", "Il tuo archivio"))
                            .size(24.0)
                            .strong(),
                    );
                    ui.add(
                    egui::Label::new(tr(
                        "Your games and the players you follow, kept apart.",
                        "Le tue partite e quelle dei giocatori che segui, in raccolte separate.",
                    ))
                    .wrap(),
                );
                },
            );
            if ui
                .add_enabled(
                    !busy,
                    crate::appearance::primary(tr("Import games", "Importa partite"))
                        .wrap()
                        .min_size(Vec2::new(112.0, 45.0)),
                )
                .clicked()
            {
                action = Some(Action::Import);
            }
        });
        ui.add_space(16.0);
        crate::appearance::panel(ui).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            if let Some(main) = main {
                ui.strong(main.title());
                if syncing {
                    ui.spinner();
                    ui.small(tr("Checking for new games…", "Ricerca nuove partite…"));
                } else if let Some(date) =
                    chrono::DateTime::from_timestamp_millis(sync.last_synced as i64)
                        .filter(|_| sync.last_synced != 0)
                {
                    ui.small(format!(
                        "{} {}",
                        tr("Last checked", "Ultimo controllo"),
                        date.with_timezone(&chrono::Local).format("%H:%M")
                    ));
                }
                ui.label(RichText::new(tr("Syncs while ChessAsh is open. Public archives can be delayed.", "Sincronizza mentre ChessAsh è aperto. Gli archivi pubblici possono essere in ritardo.")).size(12.0));
                if ui
                    .add_enabled(!busy, egui::Button::new(tr("Check now", "Controlla ora")))
                    .clicked()
                {
                    action = Some(Action::Sync);
                }
                ui.collapsing(tr("Manage account","Gestisci account"),|ui| {
                    if ui.add_enabled(!busy,egui::Button::new(tr("Remove main account","Rimuovi account principale"))).clicked() {action=Some(Action::Main(None));}
                });
            } else {
                ui.label(tr("Main account", "Account principale"));
                ComboBox::from_id_salt("main-provider")
                    .selected_text(provider_label(self.provider))
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.provider, Provider::ChessCom, "Chess.com");
                        ui.selectable_value(&mut self.provider, Provider::Lichess, "Lichess");
                    });
                ui.add(
                    TextEdit::singleline(&mut self.main_draft)
                        .hint_text(tr("Public username", "Nome utente pubblico"))
                        .desired_width(130.0),
                );
                let account = Account::from_provider(&self.main_draft, self.provider);
                if ui
                    .add_enabled(
                        !busy && account.is_some(),
                        egui::Button::new(tr("Set", "Imposta")),
                    )
                    .clicked()
                {
                    action = Some(Action::Main(account));
                    self.main_draft.clear();
                }
            }
        });
        ui.add_space(16.0);
        ui.add_sized(
            [ui.available_width(), 44.0],
            TextEdit::singleline(&mut self.query)
                .hint_text(tr(
                    "Search player, opening or date",
                    "Cerca giocatore, apertura o data",
                ))
                .desired_width(width),
        );
        ui.horizontal_wrapped(|ui| {
            let review_options = [
                (ReviewFilter::All, tr("All games", "Tutte")),
                (ReviewFilter::Complete, tr("Reviewed", "Analizzate")),
                (ReviewFilter::Incomplete, tr("To review", "Da analizzare")),
            ];
            let selected = review_options
                .iter()
                .find(|(filter, _)| *filter == self.review)
                .unwrap()
                .1;
            ComboBox::from_id_salt("review-filter")
                .selected_text(selected)
                .show_ui(ui, |ui| {
                    for (value, label) in review_options {
                        ui.selectable_value(&mut self.review, value, label);
                    }
                });
            select_filter(
                ui,
                "result-filter",
                &mut self.result,
                tr("Any result", "Qualsiasi risultato"),
                &["1-0", "0-1", "1/2-1/2"],
            );
            select_filter(
                ui,
                "time-filter",
                &mut self.time,
                tr("Any time control", "Qualsiasi cadenza"),
                &[
                    "ultraBullet",
                    "bullet",
                    "blitz",
                    "rapid",
                    "classical",
                    "daily",
                    "correspondence",
                ],
            );
        });
        let query = self.query.trim().to_lowercase();
        let active_filter = !query.is_empty()
            || self.review != ReviewFilter::All
            || !self.result.is_empty()
            || !self.time.is_empty();
        if games.is_empty() && main.is_none() {
            ui.label(tr("No saved games.", "Nessuna partita salvata."));
        }
        for group in groups(games, main) {
            let title = match group.title.as_str() {
                "Earlier imports" => tr("Earlier imports", "Importazioni precedenti"),
                "Lichess games" => tr("Lichess games", "Partite Lichess"),
                "PGN files and samples" => tr("PGN files and samples", "File PGN ed esempi"),
                title => title,
            };
            let label = format!("{title} ({})", group.games.len());
            let mut header = CollapsingHeader::new(label)
                .id_salt(&group.key)
                .default_open(group.kind != GroupKind::Guest);
            if active_filter {
                header = header.open(Some(true));
            }
            ui.add_space(8.0);
            crate::appearance::panel(ui).show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                header.show(ui, |ui| {
                    if let Some(account) = group.account
                        && group.kind == GroupKind::Guest
                        && ui
                            .add_enabled(
                                !busy,
                                egui::Button::new(tr("Make main", "Rendi principale")),
                            )
                            .clicked()
                    {
                        action = Some(Action::Main(Some(account)));
                    }
                    let mut visible = 0;
                    for game in group.games {
                        if !self.matches(game, &query) {
                            continue;
                        }
                        visible += 1;
                        let white = header_text(game, "White", tr("White", "Bianco"));
                        let black = header_text(game, "Black", tr("Black", "Nero"));
                        let opening = game_opening(game);
                        let reviewed = game.review.as_ref().is_some_and(|review| review.completed);
                        egui::Frame::new()
                            .fill(Color32::from_rgb(69, 77, 63))
                            .corner_radius(10)
                            .inner_margin(8)
                            .show(ui, |ui| {
                                ui.set_min_width(ui.available_width());
                                ui.horizontal(|ui| {
                                    let title_width = (ui.available_width() - 68.0).max(65.0);
                                    ui.allocate_ui_with_layout(
                                        Vec2::new(title_width, 53.0),
                                        egui::Layout::top_down(egui::Align::Min),
                                        |ui| {
                                            if ui
                                                .add_enabled(
                                                    !busy,
                                                    egui::Button::new(
                                                        RichText::new(format!(
                                                            "{white} vs {black}"
                                                        ))
                                                        .strong(),
                                                    )
                                                    .frame(false),
                                                )
                                                .clicked()
                                            {
                                                action = Some(Action::Open(game.id.clone()));
                                            }
                                            ui.small(opening);
                                            ui.label(
                                                RichText::new(if reviewed {
                                                    tr("Reviewed", "Analizzata")
                                                } else {
                                                    tr("To review", "Da analizzare")
                                                })
                                                .size(11.0)
                                                .color(if reviewed {
                                                    crate::appearance::ACCENT
                                                } else {
                                                    ui.visuals().text_color()
                                                }),
                                            );
                                        },
                                    );
                                    ui.with_layout(
                                        egui::Layout::right_to_left(egui::Align::Center),
                                        |ui| {
                                            let delete = ui
                                                .add_enabled(
                                                    !busy,
                                                    egui::Button::new("×").frame(false),
                                                )
                                                .on_hover_text(tr("Delete", "Elimina"));
                                            if delete.clicked() {
                                                action = Some(Action::Delete(game.id.clone()));
                                            }
                                            ui.label(header_text(game, "Result", "*"));
                                        },
                                    );
                                });
                            });
                    }
                    if visible == 0 {
                        ui.small(if active_filter {
                            tr(
                                "No games match these filters.",
                                "Nessuna partita corrisponde ai filtri.",
                            )
                        } else {
                            tr(
                                "No games in this collection yet.",
                                "Nessuna partita in questa raccolta.",
                            )
                        });
                    }
                });
            });
        }
        action
    }

    fn matches(&self, game: &Game, query: &str) -> bool {
        let complete = game.review.as_ref().is_some_and(|review| review.completed);
        if (self.review == ReviewFilter::Complete && !complete)
            || (self.review == ReviewFilter::Incomplete && complete)
        {
            return false;
        }
        if !self.time.is_empty() && game.time_class.as_deref() != Some(self.time) {
            return false;
        }
        if !self.result.is_empty() && header_text(game, "Result", "*") != self.result {
            return false;
        }
        query.is_empty()
            || ["White", "Black", "Opening", "Date", "UTCDate"]
                .iter()
                .any(|key| header_text(game, key, "").to_lowercase().contains(query))
            || game.source.to_lowercase().contains(query)
            || game_opening(game).to_lowercase().contains(query)
    }
}

fn game_opening(game: &Game) -> &str {
    header_text(
        game,
        "Opening",
        chessash_review_core::opening_name(&game.moves),
    )
}

fn header_text<'a>(game: &'a Game, key: &str, fallback: &'a str) -> &'a str {
    game.headers
        .get(key)
        .filter(|value| !value.is_empty())
        .map_or(fallback, String::as_str)
}

fn provider_label(provider: Provider) -> &'static str {
    match provider {
        Provider::ChessCom => "Chess.com",
        Provider::Lichess => "Lichess",
    }
}

fn select_filter(
    ui: &mut eframe::egui::Ui,
    id: &str,
    selected: &mut &'static str,
    any: &str,
    options: &[&'static str],
) {
    eframe::egui::ComboBox::from_id_salt(id)
        .selected_text(if selected.is_empty() { any } else { *selected })
        .show_ui(ui, |ui| {
            ui.selectable_value(selected, "", any);
            for option in options {
                ui.selectable_value(selected, *option, *option);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_import_preserves_notes_and_unions_account_ownership() {
        let mut saved = chessash_review_core::parse_pgn("1. e4 *", "PGN").unwrap();
        saved.notes = Some(BTreeMap::from([(1, "Keep this.".into())]));
        let mut incoming = saved.clone();
        incoming.notes = None;
        let main = Account::from_key(" Lichess:Main_User ").unwrap();
        let guest = Account::from_key("guest").unwrap();
        associate_games(std::slice::from_mut(&mut saved), &main);
        associate_games(std::slice::from_mut(&mut incoming), &guest);
        let games = merge_imports(std::slice::from_ref(&saved), vec![incoming]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].notes, saved.notes);
        let groups = groups(&games, Some(&main));
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].key, "lichess:main_user");
        assert_eq!(groups[1].key, "guest");
        assert_eq!(groups[0].games[0].id, groups[1].games[0].id);
    }

    #[test]
    fn sync_waits_and_backs_off() {
        let mut sync = Sync::restored(1);
        assert!(!sync.due(SYNC_INTERVAL_MS));
        assert!(sync.due(1 + SYNC_INTERVAL_MS));
        sync.failed(200_000);
        sync.failed(320_000);
        assert!(!sync.due(559_999));
        assert!(sync.due(560_000));
        sync.succeeded(560_000);
        assert_eq!(sync.last_synced, 560_000);
        assert!(sync.due(680_000));
    }
}
