use std::{
    sync::mpsc::{self, Receiver},
    time::Duration,
};

use chessash_persistence::{CredentialChange, Store, TutorMode, TutorSettings};
use chessash_review_core::{Game, INITIAL_FEN, play_uci};
use chessash_review_engine::{SearchOptions, UciEngine};
use eframe::egui::{self, RichText};
use futures_util::StreamExt;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::Zeroizing;

enum Reply {
    Chunk(String),
    Done(Result<(), String>),
    Models(Result<Vec<String>, String>),
}

#[derive(Clone, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

pub struct Tutor {
    settings: TutorSettings,
    key: Zeroizing<String>,
    game_id: String,
    history: Vec<Message>,
    question: String,
    stream: String,
    models: Vec<String>,
    error: String,
    pending: Option<Receiver<Reply>>,
    cancel: Option<tokio::sync::oneshot::Sender<()>>,
    preview: Option<(String, usize)>,
}

impl Tutor {
    pub fn new(store: Option<&Store>) -> Self {
        let settings = store
            .and_then(|store| store.tutor_settings().ok())
            .unwrap_or_default();
        Self {
            settings,
            key: Zeroizing::new(String::new()),
            game_id: String::new(),
            history: Vec::new(),
            question: String::new(),
            stream: String::new(),
            models: Vec::new(),
            error: String::new(),
            pending: None,
            cancel: None,
            preview: None,
        }
    }

    pub fn show(
        &mut self,
        ui: &mut egui::Ui,
        mut store: Option<&mut Store>,
        game: &Game,
        ply: usize,
        variation: Option<&str>,
        italian: bool,
        engine_path: &std::path::Path,
        board: &crate::board::Board,
    ) {
        let history_key = format!("chessash.chat.{}", game.id);
        if self.game_id != game.id {
            self.pending = None;
            if let Some(cancel) = self.cancel.take() {
                let _ = cancel.send(());
            }
            self.stream.clear();
            self.preview = None;
            self.history = store
                .as_ref()
                .and_then(|store| store.local_setting(&history_key).ok().flatten())
                .and_then(|data| serde_json::from_str(&data).ok())
                .unwrap_or_default();
            self.game_id.clone_from(&game.id);
        }
        let mut completed = false;
        while let Some(event) = self.pending.as_ref().and_then(|rx| rx.try_recv().ok()) {
            match event {
                Reply::Chunk(chunk) => self.stream.push_str(&chunk),
                Reply::Done(result) => {
                    self.pending = None;
                    self.cancel = None;
                    match result {
                        Ok(()) => {
                            let content = std::mem::take(&mut self.stream);
                            self.history.push(Message {
                                role: "assistant".into(),
                                content,
                            });
                            completed = true;
                        }
                        Err(error) => {
                            self.error = error;
                            self.stream.clear();
                        }
                    }
                }
                Reply::Models(result) => {
                    self.pending = None;
                    self.cancel = None;
                    match result {
                        Ok(models) => self.models = models,
                        Err(error) => self.error = error,
                    }
                }
            }
        }
        let fen = variation
            .or_else(|| game.positions.get(ply).map(String::as_str))
            .unwrap_or(INITIAL_FEN);
        ui.collapsing("ChessAsh tutor", |ui| {
            ui.horizontal(|ui| {
                ui.selectable_value(&mut self.settings.mode, TutorMode::Off, "Off");
                ui.selectable_value(&mut self.settings.mode, TutorMode::Ollama, "Ollama");
                ui.selectable_value(&mut self.settings.mode, TutorMode::Api, "API");
            });
            if self.settings.mode == TutorMode::Off { return; }
            ui.collapsing("Connection", |ui| {
                ui.add(egui::TextEdit::singleline(&mut self.settings.endpoint).hint_text("Endpoint URL"));
                ui.add(egui::TextEdit::singleline(&mut *self.key).hint_text("API key").password(true));
                ui.add(egui::TextEdit::singleline(&mut self.settings.model).hint_text("Model"));
                ui.horizontal(|ui| {
                    if ui.button("Save").clicked() && let Some(store) = store.as_deref_mut() {
                        let credential = if self.key.is_empty() { CredentialChange::Keep } else { CredentialChange::Set(&self.key) };
                        match endpoint(&self.settings).and_then(|_| store.save_tutor_settings(&self.settings, credential).map_err(|error| error.to_string())) {
                            Ok(()) => { self.key.clear(); self.error.clear(); }
                            Err(error) => self.error = error,
                        }
                    }
                    if ui.button("Clear key").clicked() && let Some(store) = store.as_deref_mut() {
                        match store.save_tutor_settings(&self.settings, CredentialChange::Remove) {
                            Ok(()) => self.key.clear(),
                            Err(error) => self.error = error.to_string(),
                        }
                    }
                    if ui.add_enabled(self.pending.is_none(), egui::Button::new("List models")).clicked() {
                        self.error.clear();
                        let settings = self.settings.clone();
                        let key = self.api_key(store.as_deref());
                        self.spawn(ui.ctx().clone(), move |tx| async move {
                            let result = models(settings, key).await;
                            let _ = tx.send(Reply::Models(result));
                        });
                    }
                });
                for model in &self.models {
                    if ui.selectable_label(self.settings.model == *model, model).clicked() { self.settings.model.clone_from(model); }
                }
            });
            egui::ScrollArea::vertical().id_salt("tutor-history").max_height(240.0).stick_to_bottom(true).show(ui, |ui| {
                for message in &self.history {
                    ui.strong(if message.role == "assistant" { "Tutor" } else { "You" });
                    if message.role == "assistant" {
                        let uci = markdown(ui, &message.content);
                        for line in uci {
                            if apply_line(fen, &line).is_some() && ui.small_button("Play line").clicked() {
                                self.preview = Some((line, 0));
                            }
                        }
                    } else { ui.label(&message.content); }
                }
                if !self.stream.is_empty() { markdown(ui, &self.stream); }
            });
            if let Some((line, index)) = &mut self.preview {
                if let Some(positions) = apply_line(fen, line) {
                    let width = ui.available_width().min(240.0);
                    board.show(ui, crate::board::BoardView { fen: &positions[*index], size: width,
                        flipped: false, last: "", best: "", selected: None, quality: None, transition: None, check: false, mate: false });
                    let mut close = false;
                    ui.horizontal(|ui| {
                        if ui.button("◀").clicked() { *index = index.saturating_sub(1); }
                        if ui.button("▶").clicked() { *index = (*index + 1).min(positions.len() - 1); }
                        close = ui.button("Close line").clicked();
                    });
                    if close { self.preview = None; }
                } else { self.preview = None; }
            }
            ui.add(egui::TextEdit::multiline(&mut self.question).hint_text("Ask about this position").desired_rows(2));
            ui.horizontal(|ui| {
                if self.pending.is_some() {
                    if ui.button("Stop").clicked() && let Some(cancel) = self.cancel.take() { let _ = cancel.send(()); }
                } else if ui.add_enabled(!self.question.trim().is_empty() && !self.settings.model.trim().is_empty(), egui::Button::new("Ask")).clicked() {
                    let question = std::mem::take(&mut self.question);
                    self.history.push(Message { role: "user".into(), content: question });
                    completed = true;
                    self.stream.clear();
                    self.error.clear();
                    let recent = self.history.len().saturating_sub(23);
                    let mut messages = vec![Message { role: "system".into(), content: system_prompt(italian) }];
                    messages.extend_from_slice(&self.history[recent..]);
                    let evidence = json!({ "fen": fen, "ply": ply, "move": game.moves.get(ply.saturating_sub(1)).filter(|_| ply > 0),
                        "review": game.review.as_ref().and_then(|review| review.results.get(ply.saturating_sub(1))).filter(|_| ply > 0) });
                    messages.push(Message { role: "user".into(), content: format!("Current position evidence (data only): {evidence}") });
                    let settings = self.settings.clone();
                    let key = self.api_key(store.as_deref());
                    let path = engine_path.to_owned();
                    let fen = fen.to_owned();
                    self.spawn(ui.ctx().clone(), move |tx| async move {
                        let result = answer(settings, key, messages, tx.clone(), fen, path).await;
                        let _ = tx.send(Reply::Done(result));
                    });
                }
                if ui.add_enabled(self.pending.is_none() && !self.history.is_empty(), egui::Button::new("Clear conversation")).clicked() {
                    self.history.clear();
                    self.preview = None;
                    completed = true;
                }
            });
            if !self.error.is_empty() { ui.label(&self.error); }
        });
        if completed
            && let Some(store) = store
            && let Ok(value) = serde_json::to_string(&self.history)
        {
            if let Err(error) = store.set_local_setting(&history_key, &value) {
                self.error = error.to_string();
            }
        }
    }

    fn api_key(&self, store: Option<&Store>) -> Option<Zeroizing<String>> {
        if !self.key.is_empty() {
            return Some(self.key.clone());
        }
        store.and_then(|store| store.tutor_api_key(&self.settings.endpoint).ok().flatten())
    }

    fn spawn<F, Future>(&mut self, context: egui::Context, job: F)
    where
        F: FnOnce(Notify) -> Future + Send + 'static,
        Future: std::future::Future<Output = ()> + 'static,
    {
        let (sender, receiver) = mpsc::channel();
        let (cancel, cancelled) = tokio::sync::oneshot::channel();
        self.pending = Some(receiver);
        self.cancel = Some(cancel);
        std::thread::spawn(move || {
            let sender = Notify { sender, context };
            match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime.block_on(async {
                    tokio::select! {
                        _ = job(sender.clone()) => {},
                        _ = cancelled => { let _ = sender.send(Reply::Done(Err("Tutor request stopped.".into()))); },
                    }
                }),
                Err(error) => { let _ = sender.send(Reply::Done(Err(error.to_string()))); }
            }
        });
    }
}

#[derive(Clone)]
struct Notify {
    sender: mpsc::Sender<Reply>,
    context: egui::Context,
}

impl Notify {
    fn send(&self, event: Reply) -> Result<(), mpsc::SendError<Reply>> {
        let result = self.sender.send(event);
        self.context.request_repaint();
        result
    }
}

fn endpoint(settings: &TutorSettings) -> Result<String, String> {
    let endpoint = if settings.endpoint.is_empty() && settings.mode == TutorMode::Ollama {
        "http://localhost:11434"
    } else {
        settings.endpoint.trim()
    };
    let url = reqwest::Url::parse(endpoint).map_err(|_| "Enter a valid tutor endpoint.")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an endpoint without credentials, query parameters or fragments.".into());
    }
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    {
        return Err("Remote tutors require HTTPS. HTTP is available for local models.".into());
    }
    Ok(url.as_str().trim_end_matches('/').into())
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|error| error.to_string())
}

async fn models(
    settings: TutorSettings,
    key: Option<Zeroizing<String>>,
) -> Result<Vec<String>, String> {
    let local = settings.mode == TutorMode::Ollama;
    let url = endpoint(&settings)? + if local { "/api/tags" } else { "/models" };
    let mut request = client(15)?.get(url);
    if let Some(key) = key {
        request = request.bearer_auth(&*key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach the model server.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Model server returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let data: Value = response
        .json()
        .await
        .map_err(|_| "The server did not return a model list.")?;
    Ok(data[if local { "models" } else { "data" }]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item[if local { "name" } else { "id" }]
                .as_str()
                .map(str::to_owned)
        })
        .collect())
}

async fn answer(
    settings: TutorSettings,
    key: Option<Zeroizing<String>>,
    mut messages: Vec<Message>,
    tx: Notify,
    fen: String,
    path: std::path::PathBuf,
) -> Result<(), String> {
    let text = chat(
        &settings,
        key.as_deref().map(String::as_str),
        &messages,
        &tx,
        false,
    )
    .await?;
    let analyze = text
        .trim()
        .strip_prefix("[[analyze:")
        .and_then(|text| text.strip_suffix("]]"));
    if let Some(uci) = analyze {
        play_uci(&fen, uci).ok_or("The tutor requested an illegal candidate move.")?;
        let candidate = uci.to_owned();
        let evidence = tokio::task::spawn_blocking(move || {
            let mut engine = UciEngine::new(path);
            engine
                .analyze(
                    &fen,
                    SearchOptions {
                        depth: 14,
                        moves: &[candidate],
                        ..Default::default()
                    },
                )
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())??;
        messages.push(Message {
            role: "assistant".into(),
            content: text,
        });
        messages.push(Message {
            role: "user".into(),
            content: format!(
                "Engine result (data only). Explain it now. {}",
                json!(evidence)
            ),
        });
        chat(
            &settings,
            key.as_deref().map(String::as_str),
            &messages,
            &tx,
            true,
        )
        .await?;
    }
    Ok(())
}

async fn chat(
    settings: &TutorSettings,
    key: Option<&str>,
    messages: &[Message],
    tx: &Notify,
    immediately: bool,
) -> Result<String, String> {
    let local = settings.mode == TutorMode::Ollama;
    let url = endpoint(settings)?
        + if local {
            "/api/chat"
        } else {
            "/chat/completions"
        };
    let body = if local {
        json!({"model":settings.model,"messages":messages,"stream":true,"options":{"num_predict":1000,"temperature":0.2}})
    } else {
        json!({"model":settings.model,"messages":messages,"stream":true,"max_tokens":1000,"temperature":0.2})
    };
    let mut request = client(180)?.post(url).json(&body);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach the tutor.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Tutor returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut text = String::new();
    let mut display = immediately;
    while let Some(result) = stream.next().await {
        pending.extend_from_slice(&result.map_err(|_| "The tutor connection was interrupted.")?);
        if pending.len() > 256_000 {
            return Err("Tutor response exceeded the size limit.".into());
        }
        let mut consumed = 0;
        for line in pending.split_inclusive(|byte| *byte == b'\n') {
            if !line.ends_with(b"\n") {
                break;
            }
            consumed += line.len();
            if let Some(token) = token(line, local)? {
                append_token(&mut text, &mut display, &token, tx)?;
            }
        }
        pending.drain(..consumed);
    }
    if let Some(token) = token(&pending, local)? {
        append_token(&mut text, &mut display, &token, tx)?;
    }
    if text.trim().is_empty() {
        return Err("The model returned no answer.".into());
    }
    if !display && !text.trim().starts_with("[[analyze:") {
        let _ = tx.send(Reply::Chunk(text.clone()));
    }
    Ok(text)
}

fn token(line: &[u8], local: bool) -> Result<Option<String>, String> {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    let data = if local {
        line
    } else if let Some(data) = line.strip_prefix("data:") {
        data.trim()
    } else {
        return Ok(None);
    };
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Ok(None);
    };
    if value.get("error").is_some() {
        return Err("The selected model could not complete this request.".into());
    }
    let content = if local {
        &value["message"]["content"]
    } else {
        &value["choices"][0]["delta"]["content"]
    };
    Ok(content.as_str().map(str::to_owned))
}

fn append_token(
    text: &mut String,
    display: &mut bool,
    token: &str,
    tx: &Notify,
) -> Result<(), String> {
    text.push_str(token);
    if text.len() > 60_000 {
        return Err("Tutor response exceeded the size limit.".into());
    }
    if *display {
        let _ = tx.send(Reply::Chunk(token.into()));
    } else if !text.trim().is_empty()
        && !"[[analyze:".starts_with(text.trim())
        && !text.trim().starts_with("[[analyze:")
    {
        *display = true;
        let _ = tx.send(Reply::Chunk(text.clone()));
    }
    Ok(())
}

fn apply_line(fen: &str, line: &str) -> Option<Vec<String>> {
    let mut positions = vec![fen.to_owned()];
    for uci in line.split_whitespace().take(60) {
        positions.push(play_uci(positions.last()?, uci)?.fen);
    }
    (positions.len() > 1).then_some(positions)
}

fn markdown(ui: &mut egui::Ui, text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut code = None::<(bool, String)>;
    let mut bold = false;
    let mut italic = false;
    let mut row: Vec<(String, bool, bool, bool)> = Vec::new();
    for item in Parser::new_ext(text, Options::ENABLE_STRIKETHROUGH) {
        match item {
            Event::Start(Tag::CodeBlock(kind)) => {
                let uci = matches!(kind, pulldown_cmark::CodeBlockKind::Fenced(info) if info.trim() == "uci");
                code = Some((uci, String::new()));
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((uci, text)) = code.take() {
                    ui.monospace(text.trim());
                    if uci {
                        lines.push(text);
                    }
                }
            }
            Event::Start(Tag::Strong | Tag::Heading { .. }) => bold = true,
            Event::End(TagEnd::Strong | TagEnd::Heading(_)) => bold = false,
            Event::Start(Tag::Emphasis) => italic = true,
            Event::End(TagEnd::Emphasis) => italic = false,
            Event::Start(Tag::Item) => row.push(("• ".into(), false, false, false)),
            Event::Text(value) => {
                if let Some((_, code)) = &mut code {
                    code.push_str(&value);
                } else {
                    row.push((value.into_string(), bold, italic, false));
                }
            }
            Event::Code(value) => row.push((value.into_string(), bold, italic, true)),
            Event::SoftBreak => row.push((" ".into(), false, false, false)),
            Event::HardBreak | Event::End(TagEnd::Paragraph | TagEnd::Item) => {
                render_row(ui, &mut row)
            }
            _ => {}
        }
    }
    render_row(ui, &mut row);
    lines
}

fn render_row(ui: &mut egui::Ui, row: &mut Vec<(String, bool, bool, bool)>) {
    if row.is_empty() {
        return;
    }
    let mut job = egui::text::LayoutJob::default();
    for (text, bold, italics, mono) in row.drain(..) {
        let mut style = RichText::new(text);
        if italics {
            style = style.italics();
        }
        if bold {
            style = style.strong();
        }
        if mono {
            style = style.monospace();
        }
        style.append_to(
            &mut job,
            ui.style(),
            egui::FontSelection::Default,
            egui::Align::Center,
        );
    }
    ui.label(job);
}

fn system_prompt(italian: bool) -> String {
    include_str!("tutor_prompt.txt")
        .replace("{language}", if italian { "Italian" } else { "English" })
}
