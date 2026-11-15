use std::{collections::BTreeMap, io::Read, path::Path, time::Duration};

pub use chessash_review_core::Game;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::CredentialChange;

pub const LEGACY_FORMAT: &str = "chessash-v1.5-backup";
pub const LEGACY_SNAPSHOT_NAME: &str = "chessash-v15-migration.json";
pub const LEGACY_MIGRATED_NAME: &str = "chessash-v15-migrated";
const MAX_BACKUP_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Could not access ChessAsh data: {0}")]
    Io(#[from] std::io::Error),
    #[error("Could not access the ChessAsh library: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Invalid ChessAsh data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(&'static str),
    #[cfg(windows)]
    #[error("Could not access the tutor credential for this Windows user.")]
    Credential,
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyBackup {
    pub format: String,
    pub games: Vec<Game>,
    pub local_storage: BTreeMap<String, String>,
    pub tutor_settings: Option<TutorSettings>,
    pub coaching_pack: Option<Value>,
}

impl LegacyBackup {
    pub fn from_reader(reader: impl Read) -> Result<Self> {
        let mut bytes = Vec::new();
        reader.take(MAX_BACKUP_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BACKUP_BYTES {
            return Err(Error::Invalid("The ChessAsh backup exceeds 128 MB."));
        }
        let backup: Self = serde_json::from_slice(&bytes)?;
        if backup.format != LEGACY_FORMAT {
            return Err(Error::Invalid(
                "This ChessAsh backup format is unsupported.",
            ));
        }
        Ok(backup)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TutorSettings {
    pub mode: TutorMode,
    pub endpoint: String,
    pub model: String,
}

impl Default for TutorSettings {
    fn default() -> Self {
        Self {
            mode: TutorMode::Off,
            endpoint: "http://localhost:11434".into(),
            model: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TutorMode {
    Off,
    Ollama,
    Api,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    pub games_imported: usize,
    pub local_settings_imported: usize,
    pub games_needing_replay: Vec<String>,
}

pub struct Store {
    db: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        let mut db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i64 =
            transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 1 {
            return Err(Error::Invalid(
                "This library requires a newer ChessAsh build.",
            ));
        }
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, record TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS local_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS deleted_games (id TEXT PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS deleted_settings (key TEXT PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS credentials (key TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);
             PRAGMA user_version = 1;",
        )?;
        transaction.commit()?;
        Ok(Self { db })
    }

    pub fn games(&self) -> Result<Vec<Game>> {
        let mut statement = self.db.prepare("SELECT record FROM games ORDER BY id")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn game(&self, id: &str) -> Result<Option<Game>> {
        let record: Option<String> = self
            .db
            .query_row("SELECT record FROM games WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        record
            .map(|record| serde_json::from_str(&record).map_err(Error::from))
            .transpose()
    }

    pub fn save_game(&mut self, game: &Game) -> Result<()> {
        self.save_games(std::slice::from_ref(game))
    }

    pub fn save_games(&mut self, games: &[Game]) -> Result<()> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for game in games {
            validate_game_id(game)?;
            transaction.execute(
                "INSERT INTO games VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET record = excluded.record",
                params![game.id, serde_json::to_string(game)?],
            )?;
            transaction.execute("DELETE FROM deleted_games WHERE id = ?1", [&game.id])?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_game(&mut self, id: &str) -> Result<bool> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let removed = transaction.execute("DELETE FROM games WHERE id = ?1", [id])? != 0;
        if removed {
            transaction.execute("INSERT OR IGNORE INTO deleted_games VALUES (?1)", [id])?;
        }
        transaction.commit()?;
        Ok(removed)
    }

    pub fn local_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row(
                "SELECT value FROM local_settings WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_local_setting(&mut self, key: &str, value: &str) -> Result<()> {
        self.set_local_settings(&[(key, Some(value))])
    }

    pub fn set_local_settings(&mut self, values: &[(&str, Option<&str>)]) -> Result<()> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for (key, value) in values {
            if let Some(value) = value {
                transaction.execute(
                    "INSERT INTO local_settings VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, value],
                )?;
                transaction.execute("DELETE FROM deleted_settings WHERE key = ?1", [key])?;
            } else {
                transaction.execute("DELETE FROM local_settings WHERE key = ?1", [key])?;
                transaction.execute("INSERT OR IGNORE INTO deleted_settings VALUES (?1)", [key])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn remove_local_setting(&mut self, key: &str) -> Result<bool> {
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let removed = transaction.execute("DELETE FROM local_settings WHERE key = ?1", [key])? != 0;
        if removed {
            transaction.execute("INSERT OR IGNORE INTO deleted_settings VALUES (?1)", [key])?;
        }
        transaction.commit()?;
        Ok(removed)
    }

    pub fn tutor_settings(&self) -> Result<TutorSettings> {
        Ok(self.metadata("tutor")?.unwrap_or_default())
    }

    pub fn coaching_pack(&self) -> Result<Option<Value>> {
        self.metadata("coaching_pack")
    }

    pub fn save_coaching_pack(&mut self, pack: &Value) -> Result<()> {
        self.db.execute(
            "INSERT INTO metadata VALUES ('coaching_pack', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(pack)?],
        )?;
        Ok(())
    }

    fn metadata<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let value: Option<String> = self
            .db
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Error::from))
            .transpose()
    }

    pub fn import_legacy(&mut self, mut backup: LegacyBackup) -> Result<ImportReport> {
        if backup.format != LEGACY_FORMAT {
            return Err(Error::Invalid(
                "This ChessAsh backup format is unsupported.",
            ));
        }
        let mut report = ImportReport::default();
        for game in &mut backup.games {
            validate_game_id(game)?;
            if game.hydrate().is_err() {
                report.games_needing_replay.push(game.id.clone());
            }
        }
        let transaction = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for game in &backup.games {
            report.games_imported += transaction.execute(
                "INSERT OR IGNORE INTO games
                 SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM deleted_games WHERE id = ?1)",
                params![game.id, serde_json::to_string(game)?],
            )?;
        }
        for (key, value) in &backup.local_storage {
            if is_legacy_setting(key) {
                report.local_settings_imported += transaction.execute(
                    "INSERT OR IGNORE INTO local_settings
                     SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM deleted_settings WHERE key = ?1)",
                    params![key, value],
                )?;
            }
        }
        if let Some(tutor) = backup.tutor_settings {
            transaction.execute(
                "INSERT OR IGNORE INTO metadata VALUES ('tutor', ?1)",
                [serde_json::to_string(&tutor)?],
            )?;
        }
        if let Some(pack) = backup.coaching_pack {
            transaction.execute(
                "INSERT OR IGNORE INTO metadata VALUES ('coaching_pack', ?1)",
                [serde_json::to_string(&pack)?],
            )?;
        }
        transaction.commit()?;
        Ok(report)
    }

    pub fn import_staged(&mut self, directory: &Path) -> Result<Option<ImportReport>> {
        let marker = directory.join(LEGACY_MIGRATED_NAME);
        if marker.is_file() {
            return Ok(None);
        }
        let snapshot = directory.join(LEGACY_SNAPSHOT_NAME);
        let file = match std::fs::File::open(&snapshot) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let report = self.import_legacy(LegacyBackup::from_reader(file)?)?;
        std::fs::File::create(marker)?.sync_all()?;
        match std::fs::remove_file(snapshot) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(Some(report))
    }
}

fn validate_game_id(game: &Game) -> Result<()> {
    if game.id.is_empty() {
        return Err(Error::Invalid("A game in this library has no identifier."));
    }
    Ok(())
}

fn is_legacy_setting(key: &str) -> bool {
    matches!(
        key,
        "chessash:prefs"
            | "chessash:active"
            | "chessash:screen"
            | "chessash:import-provider"
            | "chessash:username"
            | "chessash:main-username"
            | "chessash:account-sync-times"
            | "chessash:language"
    ) || key.starts_with("chessash:training:v1:")
        || key.starts_with("chessash.chat.")
}

#[cfg(test)]
mod tests {
    use chessash_review_core::parse_pgn;
    use serde_json::json;

    use super::*;

    fn fixture() -> LegacyBackup {
        let mut game = parse_pgn("1. e4 {Centre} e5 *", "PGN").unwrap();
        game.uci_moves.clear();
        game.comments.clear();
        game.notes = Some(BTreeMap::from([(1, "my note".to_owned())]));
        game.last_ply = Some(2);
        game.review = Some(
            serde_json::from_value(json!({
                "version": 1, "depth": 12, "engine": "Stockfish", "completed": true, "results": [{
                    "ply": 1, "move": "e2e4", "san": "e4", "color": "w", "before": 20, "after": 20,
                    "loss": 0, "label": "book", "best": "e2e4", "pv": [], "depth": 12,
                    "explanation": "Book move.", "hints": [], "key": false
                }]
            }))
            .unwrap(),
        );
        LegacyBackup {
            format: LEGACY_FORMAT.into(),
            games: vec![game],
            local_storage: BTreeMap::from([
                (
                    "chessash:training:v1:user".into(),
                    r#"{"card":{"attempts":2,"solved":1,"streak":1,"due":9,"last":8}}"#.into(),
                ),
                ("chessash:training:v1:user:events".into(), "[]".into()),
                ("chessash:training:v1:user:session".into(), "null".into()),
                ("chessash:prefs".into(), r#"{"sound":true}"#.into()),
                ("chessash.chat.game".into(), "[]".into()),
                ("api-key".into(), "not a ChessAsh key".into()),
            ]),
            tutor_settings: Some(TutorSettings::default()),
            coaching_pack: Some(json!({"templates": {"best": "Keep it short."}})),
        }
    }

    #[test]
    fn migrates_saved_data_without_replacing_native_changes() {
        let mut store = Store::open(":memory:").unwrap();
        let legacy = fixture();
        let wire = serde_json::to_vec(&legacy).unwrap();
        let imported = LegacyBackup::from_reader(wire.as_slice()).unwrap();
        let report = store.import_legacy(imported).unwrap();
        assert_eq!(report.games_imported, 1);
        assert_eq!(report.local_settings_imported, 5);
        assert!(report.games_needing_replay.is_empty());
        let id = &legacy.games[0].id;
        let mut game = store.game(id).unwrap().unwrap();
        assert_eq!(game.review, legacy.games[0].review);
        assert_eq!(game.notes, legacy.games[0].notes);
        assert_eq!(game.comments.get(&1).map(String::as_str), Some("Centre"));
        assert_eq!(game.uci_moves, ["e2e4", "e7e5"]);
        assert_eq!(
            store.local_setting("chessash:training:v1:user").unwrap(),
            legacy
                .local_storage
                .get("chessash:training:v1:user")
                .cloned()
        );
        assert!(store.local_setting("api-key").unwrap().is_none());
        assert_eq!(store.coaching_pack().unwrap(), legacy.coaching_pack);
        game.notes.as_mut().unwrap().insert(1, "new note".into());
        store.save_game(&game).unwrap();
        store.set_local_setting("chessash:prefs", "{}").unwrap();
        assert_eq!(
            store.import_legacy(legacy.clone()).unwrap(),
            ImportReport::default()
        );
        assert_eq!(store.game(id).unwrap().unwrap(), game);
        assert_eq!(
            store.local_setting("chessash:prefs").unwrap().as_deref(),
            Some("{}")
        );
        assert!(store.delete_game(id).unwrap());
        assert!(
            store
                .remove_local_setting("chessash:training:v1:user:session")
                .unwrap()
        );
        assert_eq!(
            store.import_legacy(legacy.clone()).unwrap().games_imported,
            0
        );
        assert!(store.games().unwrap().is_empty());
        assert_eq!(
            store
                .local_setting("chessash:training:v1:user:session")
                .unwrap(),
            None
        );
    }

    #[test]
    fn rejects_invalid_import_before_any_rows_are_added() {
        let mut store = Store::open(":memory:").unwrap();
        let mut legacy = fixture();
        legacy.games.push(Game::default());
        assert!(store.import_legacy(legacy).is_err());
        assert!(store.games().unwrap().is_empty());
        assert_eq!(store.local_setting("chessash:prefs").unwrap(), None);
    }

    #[test]
    fn staged_snapshot_is_consumed_once_after_commit() {
        let directory = std::env::temp_dir().join(format!(
            "chessash-staged-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir(&directory).unwrap();
        let snapshot = directory.join(LEGACY_SNAPSHOT_NAME);
        std::fs::write(&snapshot, serde_json::to_vec(&fixture()).unwrap()).unwrap();
        let mut store = Store::open(":memory:").unwrap();
        assert_eq!(
            store
                .import_staged(&directory)
                .unwrap()
                .unwrap()
                .games_imported,
            1
        );
        assert!(!snapshot.exists());
        assert!(store.import_staged(&directory).unwrap().is_none());
        std::fs::remove_file(directory.join(LEGACY_MIGRATED_NAME)).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
