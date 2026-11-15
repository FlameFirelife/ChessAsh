use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};

pub struct Platform {
    pub data: PathBuf,
    pub engines: PathBuf,
    #[cfg(target_os = "android")]
    android: winit::platform::android::activity::AndroidApp,
}

#[cfg(windows)]
impl Platform {
    pub fn new() -> Self {
        let data = std::env::var_os("CHESSASH_NATIVE_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_else(std::env::temp_dir)
                    .join("ChessAsh Native")
            });
        let engines = std::env::var_os("CHESSASH_ENGINES")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(|dir| dir.join("engines")))
                    .filter(|path| path.join("stockfish.exe").is_file())
            })
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("engines/windows"));
        Self { data, engines }
    }

    pub fn open(
        &self,
        context: eframe::egui::Context,
        extension: &str,
    ) -> Receiver<Result<Vec<u8>, String>> {
        let (tx, rx) = mpsc::channel();
        let extension = extension.to_owned();
        std::thread::spawn(move || {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter(extension.to_uppercase(), &[extension])
                .pick_file()
            {
                let _ = tx.send(std::fs::read(path).map_err(|error| error.to_string()));
            }
            context.request_repaint();
        });
        rx
    }

    pub fn share_png(&self, filename: &str, png: &[u8]) -> Result<(), String> {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("PNG", &["png"])
            .set_file_name(filename)
            .save_file()
        {
            std::fs::write(path, png).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn save_pgn(&self, pgn: &[u8]) -> Result<(), String> {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("PGN", &["pgn"])
            .set_file_name("ChessAsh review.pgn")
            .save_file()
        {
            std::fs::write(path, pgn).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn vertical_insets(&self) -> (f32, f32) {
        (0.0, 0.0)
    }
}

#[cfg(target_os = "android")]
type Picker = (mpsc::Sender<Result<Vec<u8>, String>>, eframe::egui::Context);

#[cfg(target_os = "android")]
static PICKER: std::sync::Mutex<Option<Picker>> = std::sync::Mutex::new(None);

#[cfg(target_os = "android")]
impl Platform {
    pub fn new(android: winit::platform::android::activity::AndroidApp) -> Self {
        let data = android.internal_data_path().unwrap_or_default();
        let mut platform = Self {
            data: data.clone(),
            engines: data,
            android,
        };
        if let Ok(path) = platform.activity(|env, activity| -> jni::errors::Result<String> {
            let path = env
                .call_method(activity, "engineDirectory", "()Ljava/lang/String;", &[])?
                .l()?;
            let path = jni::objects::JString::from(path);
            Ok(env.get_string(&path)?.into())
        }) {
            platform.engines = PathBuf::from(path);
        }
        platform
    }

    fn activity<T>(
        &self,
        callback: impl FnOnce(&mut jni::JNIEnv, jni::objects::JObject) -> jni::errors::Result<T>,
    ) -> Result<T, String> {
        let vm = unsafe { jni::JavaVM::from_raw(self.android.vm_as_ptr().cast()) };
        vm.and_then(|vm| {
            let mut env = vm.attach_current_thread()?;
            let activity =
                unsafe { jni::objects::JObject::from_raw(self.android.activity_as_ptr().cast()) };
            let result = callback(&mut env, activity);
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            result
        })
        .map_err(|error| error.to_string())
    }

    pub fn open(
        &self,
        context: eframe::egui::Context,
        extension: &str,
    ) -> Receiver<Result<Vec<u8>, String>> {
        let (tx, rx) = mpsc::channel();
        let Ok(mut picker) = PICKER.lock() else {
            return rx;
        };
        *picker = Some((tx, context));
        drop(picker);
        let result = self.activity(|env, activity| {
            let mime = env.new_string(if extension == "json" {
                "application/json"
            } else {
                "*/*"
            })?;
            env.call_method(
                activity,
                "pickFile",
                "(Ljava/lang/String;)V",
                &[(&mime).into()],
            )?;
            Ok(())
        });
        if let Err(error) = result {
            complete_picker(Some(Err(error)));
        }
        rx
    }

    pub fn share_png(&self, filename: &str, png: &[u8]) -> Result<(), String> {
        self.activity(|env, activity| {
            let filename = env.new_string(filename)?;
            let bytes = env.byte_array_from_slice(png)?;
            env.call_method(
                activity,
                "sharePng",
                "(Ljava/lang/String;[B)V",
                &[(&filename).into(), (&bytes).into()],
            )?;
            Ok(())
        })
    }

    pub fn save_pgn(&self, pgn: &[u8]) -> Result<(), String> {
        self.activity(|env, activity| {
            let bytes = env.byte_array_from_slice(pgn)?;
            env.call_method(activity, "savePgn", "([B)V", &[(&bytes).into()])?;
            Ok(())
        })
    }

    pub fn play_tap(&self, samples: &[f32]) {
        let pcm: Vec<u8> = samples
            .iter()
            .flat_map(|sample| ((*sample * 32767.0) as i16).to_le_bytes())
            .collect();
        let _ = self.activity(|env, activity| {
            let bytes = env.byte_array_from_slice(&pcm)?;
            env.call_method(activity, "playTap", "([B)V", &[(&bytes).into()])?;
            Ok(())
        });
    }

    pub fn vertical_insets(&self) -> (f32, f32) {
        self.activity(|env, activity| {
            let packed = env
                .call_method(activity, "verticalInsets", "()J", &[])?
                .j()?;
            Ok(((packed >> 32) as f32, (packed as u32) as f32))
        })
        .unwrap_or_default()
    }

    pub fn legacy_migration_pending(&self) -> bool {
        self.activity(|env, activity| {
            env.call_method(activity, "legacyMigrationPending", "()Z", &[])?
                .z()
        })
        .unwrap_or(false)
    }
}

#[cfg(target_os = "android")]
fn complete_picker(result: Option<Result<Vec<u8>, String>>) {
    if let Some((tx, context)) = PICKER.lock().ok().and_then(|mut pending| pending.take()) {
        if let Some(result) = result {
            let _ = tx.send(result);
        }
        context.request_repaint();
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_flamedev_chessash_MainActivity_onFile(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    bytes: jni::objects::JByteArray,
    error: jni::objects::JString,
) {
    let result = if !error.is_null() {
        Some(Err(env
            .get_string(&error)
            .map(|error| error.into())
            .unwrap_or_else(|error| error.to_string())))
    } else if !bytes.is_null() {
        Some(
            env.convert_byte_array(bytes)
                .map_err(|error| error.to_string()),
        )
    } else {
        None
    };
    complete_picker(result);
}

pub fn executable(directory: &Path, name: &str) -> PathBuf {
    #[cfg(target_os = "android")]
    return directory.join(format!("lib{name}.so"));
    #[cfg(not(target_os = "android"))]
    directory.join(format!("{name}.exe"))
}
