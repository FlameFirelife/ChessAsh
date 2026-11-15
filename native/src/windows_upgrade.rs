use std::{
    fs::{self, File, OpenOptions},
    io::{self, ErrorKind},
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use chessash_persistence::{LEGACY_MIGRATED_NAME, LEGACY_SNAPSHOT_NAME, LegacyBackup};

pub(crate) fn legacy_profile() -> Option<PathBuf> {
    std::env::var_os("CHESSASH_LEGACY_DATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(|root| PathBuf::from(root).join("chessash")))
}

fn link_or_copy(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination).or_else(|_| fs::copy(source, destination).map(|_| ()))
}

fn legacy_locks(profile: &Path) -> io::Result<Vec<File>> {
    let mut paths = vec![profile.join("Local Storage/leveldb/LOCK")];
    match profile.join("IndexedDB").read_dir() {
        Ok(entries) => {
            for entry in entries {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    paths.push(entry.path().join("LOCK"));
                }
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let mut locks = Vec::new();
    for path in paths {
        match OpenOptions::new().read(true).share_mode(0).open(path) {
            Ok(file) => locks.push(file),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) if error.raw_os_error() == Some(32) || error.raw_os_error() == Some(33) => {
                return Err(io::Error::new(
                    ErrorKind::WouldBlock,
                    "Close the previous ChessAsh window before updating.",
                ));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(locks)
}

pub fn prepare(installed: &Path, helper: &Path) -> io::Result<()> {
    let data = crate::platform::Platform::new().data;
    let Some(profile) = legacy_profile().filter(|profile| {
        profile.join("IndexedDB").is_dir() || profile.join("Local Storage").is_dir()
    }) else {
        return Ok(());
    };
    if data.join(LEGACY_MIGRATED_NAME).is_file() || !installed.join("resources/app.asar").is_file()
    {
        return Ok(());
    }
    let _locks = legacy_locks(&profile)?;
    let scratch = tempfile::Builder::new()
        .prefix("chessash-upgrade-")
        .tempdir()?;
    let host = scratch.path().join("host");
    fs::create_dir_all(host.join("resources"))?;
    fs::create_dir_all(host.join("locales"))?;
    for entry in installed.read_dir()? {
        let entry = entry?;
        let path = entry.path();
        let runtime = entry.file_name() == "ChessAsh.exe"
            || path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| matches!(extension, "dll" | "pak" | "dat" | "bin"))
            || entry.file_name() == "vk_swiftshader_icd.json";
        if runtime && entry.file_type()?.is_file() {
            link_or_copy(&path, &host.join(entry.file_name()))?;
        }
    }
    for entry in installed.join("locales").read_dir()? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            link_or_copy(&entry.path(), &host.join("locales").join(entry.file_name()))?;
        }
    }
    fs::copy(helper, host.join("resources/app.asar"))?;
    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let extracted = scratch.path().join("snapshot.json");
    let profile_copy = scratch.path().join("profile");
    fs::create_dir(&profile_copy)?;
    let mut child = Command::new(host.join("ChessAsh.exe"))
        .args([&profile, &extracted, &profile_copy])
        .current_dir(&host)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= Duration::from_secs(45) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                ErrorKind::TimedOut,
                "The old ChessAsh library did not respond.",
            ));
        }
        thread::sleep(Duration::from_millis(50));
    };
    if !status.success() {
        return Err(io::Error::other(
            "The old ChessAsh library could not be read.",
        ));
    }
    LegacyBackup::from_reader(File::open(&extracted)?).map_err(io::Error::other)?;
    fs::create_dir_all(&data)?;
    let mut snapshot = tempfile::NamedTempFile::new_in(&data)?;
    io::copy(&mut File::open(extracted)?, &mut snapshot)?;
    snapshot.as_file().sync_all()?;
    snapshot
        .persist(data.join(LEGACY_SNAPSHOT_NAME))
        .map_err(|error| error.error)?;
    Ok(())
}
