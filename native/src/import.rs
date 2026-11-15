use chessash_review_core::{Game, lichess_game_id, parse_pgn};
use serde::Deserialize;
use std::io::Read;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Default)]
pub enum Provider {
    #[default]
    ChessCom,
    Lichess,
}

pub fn online(
    provider: Provider,
    username: &str,
    link: &str,
    months: usize,
) -> Result<Vec<Game>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!(
            "ChessAsh/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/FlameFirelife/ChessAsh)"
        ))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    let username = username.trim().to_ascii_lowercase();
    if (provider == Provider::ChessCom || link.trim().is_empty())
        && !(2..=30).contains(&username.len())
    {
        return Err("Enter a public username.".into());
    }
    if !username
        .bytes()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_')
    {
        return Err("Use letters, numbers, underscores or hyphens in the username.".into());
    }
    let mut games = match provider {
        Provider::ChessCom => chess_com(&client, &username, months)?,
        Provider::Lichess => lichess(&client, &username, link.trim(), months)?,
    };
    if provider == Provider::ChessCom && !link.trim().is_empty() {
        let id = chess_com_game_id(link).ok_or("Enter a valid Chess.com game link.")?;
        if let Some(index) = games.iter().position(|game| {
            game.url.as_deref().and_then(chess_com_game_id).as_deref() == Some(id.as_str())
        }) {
            games.swap(0, index);
        } else {
            return Err(
                "That game was not found in the selected archives. Try a wider date range.".into(),
            );
        }
    }
    if games.is_empty() {
        return Err("No completed standard chess games were found.".into());
    }
    Ok(games)
}

fn chess_com_game_id(link: &str) -> Option<String> {
    let url = reqwest::Url::parse(link.trim()).ok()?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("chess.com" | "www.chess.com"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    let id = match parts.as_slice() {
        ["", "game", "live" | "daily", id] | ["", "live" | "daily", "game", id] => *id,
        _ => return None,
    };
    (!id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit())).then(|| id.to_owned())
}

fn get(client: &reqwest::blocking::Client, url: &str, accept: &str) -> Result<String, String> {
    let result = client
        .get(url)
        .header(reqwest::header::ACCEPT, accept)
        .send()
        .map_err(|error| error.to_string())?;
    if !result.status().is_success() {
        return Err(match result.status().as_u16() {
            404 => "The provider could not find this username or game.",
            429 => "The provider is limiting requests. Try again in a few minutes.",
            _ => {
                return Err(format!(
                    "The provider returned HTTP {}.",
                    result.status().as_u16()
                ));
            }
        }
        .into());
    }
    let mut bytes = Vec::new();
    result
        .take(8_000_001)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 8_000_000 {
        return Err("The provider response is too large. Choose a smaller range.".into());
    }
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct Archives {
    archives: Vec<String>,
}
#[derive(Deserialize)]
struct Monthly {
    games: Vec<ChessComRecord>,
}
#[derive(Deserialize)]
struct ChessComRecord {
    pgn: Option<String>,
    url: Option<String>,
    end_time: Option<u64>,
    rules: Option<String>,
    time_class: Option<String>,
}

fn chess_com(
    client: &reqwest::blocking::Client,
    username: &str,
    months: usize,
) -> Result<Vec<Game>, String> {
    let prefix = format!("https://api.chess.com/pub/player/{username}/games/");
    let response = get(client, &format!("{prefix}archives"), "application/json")?;
    let archives: Archives = serde_json::from_str(&response).map_err(|error| error.to_string())?;
    let mut games = Vec::new();
    for url in archives.archives.iter().rev().take(months.clamp(1, 240)) {
        let Some(date) = url.strip_prefix(&prefix) else {
            continue;
        };
        let Some((year, month)) = date.split_once('/') else {
            continue;
        };
        if year.len() != 4
            || month.len() != 2
            || !year
                .bytes()
                .chain(month.bytes())
                .all(|b| b.is_ascii_digit())
        {
            continue;
        }
        let data = get(client, url, "application/json")?;
        let data: Monthly = serde_json::from_str(&data).map_err(|error| error.to_string())?;
        for record in data.games {
            if record.end_time.is_none()
                || record.rules.as_deref().is_some_and(|rule| rule != "chess")
            {
                continue;
            }
            if let Some(mut game) = record.pgn.and_then(|pgn| parse_pgn(&pgn, "Chess.com").ok()) {
                game.url = record.url;
                game.time_class = record.time_class;
                games.push(game);
            }
        }
    }
    Ok(games)
}

#[derive(Deserialize)]
struct LichessRecord {
    id: Option<String>,
    pgn: Option<String>,
    variant: Option<String>,
    status: Option<String>,
    speed: Option<String>,
}

fn lichess(
    client: &reqwest::blocking::Client,
    username: &str,
    link: &str,
    months: usize,
) -> Result<Vec<Game>, String> {
    let records: Vec<LichessRecord> = if link.is_empty() {
        let since = chrono::Utc::now()
            .checked_sub_months(chrono::Months::new(months.clamp(1, 24) as u32))
            .map(|date| date.timestamp_millis())
            .unwrap_or(0);
        let url = format!(
            "https://lichess.org/api/games/user/{username}?max=300&since={since}&ongoing=false&finished=true&pgnInJson=true&moves=true&evals=false&clocks=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence"
        );
        let response = get(client, &url, "application/x-ndjson")?;
        response
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(300)
            .map(serde_json::from_str)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    } else {
        let id = lichess_game_id(link).ok_or("Enter a valid Lichess game link.")?;
        let response = get(
            client,
            &format!(
                "https://lichess.org/game/export/{id}?pgnInJson=true&moves=true&evals=false&clocks=false"
            ),
            "application/json",
        )?;
        vec![serde_json::from_str(&response).map_err(|error| error.to_string())?]
    };
    Ok(records
        .into_iter()
        .filter_map(|record| {
            if record
                .variant
                .as_deref()
                .is_some_and(|variant| variant != "standard")
                || matches!(
                    record.status.as_deref(),
                    Some("created" | "started" | "aborted" | "noStart")
                )
            {
                return None;
            }
            let mut game = parse_pgn(&record.pgn?, "Lichess").ok()?;
            if !matches!(
                game.headers.get("Result")?.as_str(),
                "1-0" | "0-1" | "1/2-1/2"
            ) {
                return None;
            }
            let id = lichess_game_id(
                game.headers
                    .get("Site")
                    .or_else(|| game.headers.get("Link"))?,
            )?;
            if record
                .id
                .as_deref()
                .is_some_and(|record_id| record_id != id)
            {
                return None;
            }
            game.id = format!("lichess:{id}");
            game.url = Some(format!("https://lichess.org/{id}"));
            game.time_class = record.speed;
            Some(game)
        })
        .collect())
}
