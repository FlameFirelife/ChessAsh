use crate::board;
use chessash_review_core::{Game, MoveReview, QualityNames, play_uci};
use chessash_review_engine::{CoachingOptions, review_coaching};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Kind {
    #[default]
    Best,
    Mistake,
    Improvement,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Best => "Best move",
            Self::Mistake => "Biggest mistake",
            Self::Improvement => "Better move",
        }
    }
}

pub fn image(
    game: &Game,
    row: &MoveReview,
    kind: Kind,
    names: QualityNames,
    show_players: bool,
) -> Result<Vec<u8>, String> {
    use resvg::tiny_skia::{Pixmap, Transform};
    let index = row.ply.checked_sub(1).ok_or("No reviewed move selected.")?;
    let played = kind != Kind::Improvement;
    let (fen, san, uci) = if played {
        (
            game.positions
                .get(row.ply)
                .ok_or("Position unavailable.")?
                .clone(),
            row.san
                .clone()
                .unwrap_or_else(|| game.moves.get(index).cloned().unwrap_or_default()),
            row.r#move.as_str(),
        )
    } else {
        let played = play_uci(
            game.positions.get(index).ok_or("Position unavailable.")?,
            &row.best,
        )
        .ok_or("The analysed alternative is unavailable.")?;
        (played.fen, played.san, row.best.as_str())
    };
    let mut canvas = Pixmap::new(1080, 1350).ok_or("Could not allocate the card.")?;
    let mut svg = String::from(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#2b2e28"/><rect x="30" y="30" width="1020" height="1290" rx="34" fill="#3a4035"/>"##,
    );
    let name = if played {
        row.label.name(names)
    } else {
        "Analysed alternative"
    };
    let player = |key| game.headers.get(key).map(String::as_str).unwrap_or(key);
    let players = if show_players {
        format!("{} vs {}", player("White"), player("Black"))
    } else {
        "A position from my game".into()
    };
    let move_number = game.positions[index]
        .split_whitespace()
        .nth(5)
        .unwrap_or("1");
    let dots = if row.color == chessash_review_core::Color::White {
        "."
    } else {
        "…"
    };
    let mv = format!("{move_number}{dots} {san}");
    for (text, x, y, size, fill) in [
        ("ChessAsh", 64, 88, 23, "#bfcbb4"),
        (kind.label(), 64, 157, 48, "#f4f7ed"),
        (mv.as_str(), 64, 224, 42, "#b3db7b"),
        (name, 540, 222, 28, "#dce4d2"),
        (&players, 64, 268, 24, "#bfcbb4"),
        ("Reviewed with ChessAsh", 64, 1297, 20, "#bfcbb4"),
        (
            "github.com/FlameFirelife/ChessAsh",
            439,
            1297,
            20,
            "#bfcbb4",
        ),
    ] {
        svg_text(&mut svg, text, x, y, size, fill);
    }
    let coaching = review_coaching(game, row, CoachingOptions::default());
    let detail = if played {
        &coaching.text
    } else {
        &coaching.alternative_reason
    };
    for (index, line) in wrap(detail, 72).take(2).enumerate() {
        svg_text(&mut svg, &line, 64, 1230 + index * 31, 23, "#f4f7ed");
    }
    let flipped = row.color == chessash_review_core::Color::Black;
    let highlight = board::squares(uci);
    let pieces = board::placement(&fen);
    for index in 0..64 {
        let original = if flipped { 63 - index } else { index };
        let x = 104 + index % 8 * 109;
        let y = 300 + index / 8 * 109;
        let fill = if highlight.is_some_and(|(from, to)| original == from || original == to) {
            "#c7d174"
        } else if (index / 8 + index % 8) % 2 == 0 {
            "#e8edd5"
        } else {
            "#86a36b"
        };
        svg.push_str(&format!(
            r#"<rect x="{x}" y="{y}" width="109" height="109" fill="{fill}"/>"#
        ));
    }
    for index in 0..8 {
        let file = (if flipped {
            b'h' - index as u8
        } else {
            b'a' + index as u8
        }) as char;
        let rank = if flipped { index + 1 } else { 8 - index };
        svg_text(
            &mut svg,
            &file.to_string(),
            152 + index * 109,
            1197,
            19,
            "#bfcbb4",
        );
        svg_text(
            &mut svg,
            &rank.to_string(),
            77,
            364 + index * 109,
            19,
            "#bfcbb4",
        );
    }
    svg.push_str("</svg>");
    let mut options = resvg::usvg::Options::default();
    let fonts = options.fontdb_mut();
    fonts.load_font_data(crate::appearance::FONT.to_vec());
    let family = fonts
        .faces()
        .next()
        .and_then(|face| face.families.first().map(|(name, _)| name.clone()))
        .ok_or("The card font is unavailable.")?;
    fonts.set_sans_serif_family(family);
    let tree = resvg::usvg::Tree::from_str(&svg, &options).map_err(|error| error.to_string())?;
    resvg::render(&tree, Transform::identity(), &mut canvas.as_mut());
    for (original, piece) in pieces.into_iter().enumerate() {
        let Some(art) = piece
            .and_then(board::piece_art)
            .and_then(|svg| board::rasterize(svg, 97))
        else {
            continue;
        };
        let index = if flipped { 63 - original } else { original };
        canvas.draw_pixmap(
            110 + index as i32 % 8 * 109,
            306 + index as i32 / 8 * 109,
            art.as_ref(),
            &Default::default(),
            Transform::identity(),
            None,
        );
    }
    canvas.encode_png().map_err(|error| error.to_string())
}

fn svg_text(svg: &mut String, text: &str, x: usize, y: usize, size: usize, fill: &str) {
    let text = text
        .chars()
        .take(82)
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    svg.push_str(&format!(r#"<text x="{x}" y="{y}" font-family="sans-serif" font-size="{size}" fill="{fill}">{text}</text>"#));
}

fn wrap(text: &str, width: usize) -> impl Iterator<Item = String> {
    let mut lines = vec![String::new()];
    for word in text.split_whitespace() {
        let line = lines.last_mut().expect("starts with a line");
        if !line.is_empty() && line.chars().count() + word.chars().count() >= width {
            lines.push(word.into());
        } else {
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
    }
    lines.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chessash_review_core::{Color, Label, parse_pgn};

    #[test]
    fn card_renders_the_attribution_and_repository_link() {
        let game = parse_pgn("1. e4 *", "PGN").unwrap();
        let row = MoveReview {
            ply: 1,
            r#move: "e2e4".into(),
            san: Some("e4".into()),
            color: Color::White,
            before: 26,
            after: 26,
            loss: 0,
            label: Label::Best,
            best: "e2e4".into(),
            pv: vec!["e2e4".into()],
            depth: 12,
            explanation: "The pawn takes space in the centre.".into(),
            hints: vec![],
            key: false,
            facts: None,
            mate: None,
            consequence_of: None,
            reply_pv: None,
            sacrifice_evidence: None,
        };
        let bytes = image(&game, &row, Kind::Best, QualityNames::ChessAsh, false).unwrap();
        let png = resvg::tiny_skia::Pixmap::decode_png(&bytes).unwrap();
        assert_eq!((png.width(), png.height()), (1080, 1350));
        for xrange in [64..340, 439..790] {
            let text_pixels = (1280..1300)
                .flat_map(|y| xrange.clone().map(move |x| (x, y)))
                .filter(|&(x, y)| png.pixel(x, y).is_some_and(|pixel| pixel.green() > 120))
                .count();
            assert!(text_pixels > 30, "missing footer text");
        }
    }
}
