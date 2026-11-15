#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
fn main() -> eframe::Result {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("--prepare-windows-update")) {
        let result = args
            .next()
            .zip(args.next())
            .ok_or_else(|| {
                std::io::Error::other("The old installation and transfer helper are required.")
            })
            .and_then(|(old, helper)| {
                chessash_native::windows_upgrade::prepare(old.as_ref(), helper.as_ref())
            });
        std::process::exit(match result {
            Ok(()) => 0,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => 2,
            Err(_) => 1,
        });
    }
    chessash_native::run_windows()
}

#[cfg(not(windows))]
fn main() {}
