mod accounts;
mod appearance;
mod audio;
mod board;
mod card;
mod import;
mod live_game;
mod platform;
mod training_ui;
#[cfg(windows)]
mod tutor;
#[cfg(windows)]
pub mod windows_upgrade;

#[cfg(windows)]
use eframe::egui;

#[cfg(windows)]
pub fn run_windows() -> eframe::Result {
    let icon = eframe::icon_data::from_png_bytes(include_bytes!("../../build/icon.png")).ok();
    let viewport = egui::ViewportBuilder::default()
        .with_maximized(true)
        .with_min_inner_size([720.0, 570.0]);
    #[cfg(feature = "visual-qa")]
    let viewport = if let Some((width, height)) =
        std::env::var("CHESSASH_QA_SIZE").ok().and_then(|size| {
            let (w, h) = size.split_once('x')?;
            Some((w.parse::<f32>().ok()?, h.parse::<f32>().ok()?))
        }) {
        egui::ViewportBuilder::default()
            .with_inner_size([width, height])
            .with_decorations(false)
            .with_active(false)
    } else {
        viewport
    };
    let options = eframe::NativeOptions {
        viewport: if let Some(icon) = icon {
            viewport.with_icon(icon)
        } else {
            viewport
        },
        ..Default::default()
    };
    eframe::run_native(
        "ChessAsh",
        options,
        Box::new(|cc| Ok(Box::new(app::ChessAsh::new(cc, platform::Platform::new())))),
    )
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(android: winit::platform::android::activity::AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default().with_max_level(log::LevelFilter::Info),
    );
    let platform = platform::Platform::new(android.clone());
    let options = eframe::NativeOptions {
        android_app: Some(android),
        ..Default::default()
    };
    if let Err(error) = eframe::run_native(
        "ChessAsh Native",
        options,
        Box::new(move |cc| Ok(Box::new(app::ChessAsh::new(cc, platform)))),
    ) {
        log::error!("{error}");
    }
}

mod app;
