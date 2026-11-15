use eframe::egui::{self, Color32, Pos2, Rect, TextureHandle, Vec2};
use shakmaty::{CastlingMode, Position, uci::UciMove};
use std::collections::HashMap;

const ART: [(char, &[u8]); 12] = [
    ('P', include_bytes!("../../public/pieces/wP.svg")),
    ('N', include_bytes!("../../public/pieces/wN.svg")),
    ('B', include_bytes!("../../public/pieces/wB.svg")),
    ('R', include_bytes!("../../public/pieces/wR.svg")),
    ('Q', include_bytes!("../../public/pieces/wQ.svg")),
    ('K', include_bytes!("../../public/pieces/wK.svg")),
    ('p', include_bytes!("../../public/pieces/bP.svg")),
    ('n', include_bytes!("../../public/pieces/bN.svg")),
    ('b', include_bytes!("../../public/pieces/bB.svg")),
    ('r', include_bytes!("../../public/pieces/bR.svg")),
    ('q', include_bytes!("../../public/pieces/bQ.svg")),
    ('k', include_bytes!("../../public/pieces/bK.svg")),
];

pub const LIGHT: Color32 = Color32::from_rgb(231, 237, 218);
pub const DARK: Color32 = Color32::from_rgb(127, 156, 104);
const LABEL_INK: Color32 = Color32::from_rgb(39, 51, 33);
const BOARD_INK: Color32 = Color32::from_rgb(52, 71, 45);
const COMPARISON: Color32 = Color32::from_rgb(37, 130, 173);
const THREAT: Color32 = Color32::from_rgb(206, 73, 61);

pub struct Board {
    pieces: HashMap<char, TextureHandle>,
}

pub struct Transition<'a> {
    pub uci: &'a str,
    pub progress: f32,
    pub reverse: bool,
    pub fast: bool,
}

pub struct BoardView<'a> {
    pub fen: &'a str,
    pub size: f32,
    pub flipped: bool,
    pub last: &'a str,
    pub best: &'a str,
    pub selected: Option<usize>,
    pub quality: Option<(&'a str, Color32)>,
    pub transition: Option<Transition<'a>>,
    pub check: bool,
    pub mate: bool,
}

impl Board {
    pub fn new(context: &egui::Context) -> Self {
        let pieces = ART
            .iter()
            .filter_map(|&(piece, svg)| {
                let art = rasterize(svg, 180)?;
                let image = egui::ColorImage::from_rgba_premultiplied([180, 180], art.data());
                Some((
                    piece,
                    context.load_texture(piece.to_string(), image, Default::default()),
                ))
            })
            .collect();
        Self { pieces }
    }

    pub fn show(&self, ui: &mut egui::Ui, view: BoardView<'_>) -> Option<usize> {
        self.show_with_effects(ui, view, |_, _| {})
    }

    pub fn show_with_effects(
        &self,
        ui: &mut egui::Ui,
        view: BoardView<'_>,
        effects: impl FnOnce(&mut egui::Ui, Rect),
    ) -> Option<usize> {
        self.show_with_layers(ui, view, |_, _| {}, effects)
    }

    pub fn show_with_layers(
        &self,
        ui: &mut egui::Ui,
        view: BoardView<'_>,
        before_pieces: impl FnOnce(&mut egui::Ui, Rect),
        effects: impl FnOnce(&mut egui::Ui, Rect),
    ) -> Option<usize> {
        let (rect, response) = ui.allocate_exact_size(Vec2::splat(view.size), egui::Sense::click());
        let painter = ui.painter_at(rect);
        let cell = view.size / 8.0;
        let last = squares(view.last);
        let board = placement(view.fen);
        let comparison = squares(view.best);
        let label = view.quality.map(|(symbol, _)| symbol);
        let targets = view
            .selected
            .map_or(0_u64, |from| legal_targets(view.fen, from));
        let coord_size = (ui.ctx().content_rect().width() * 0.0085).clamp(8.0, 12.0);
        let tint = Color32::from_rgb(172, 203, 118);
        for (index, piece) in board.iter().copied().enumerate() {
            let area = square_rect(rect, cell, index, view.flipped);
            let mut color = if view.selected == Some(index) {
                Color32::from_rgb(197, 219, 117)
            } else if last.is_some_and(|pair| pair.0 == index || pair.1 == index) {
                tint
            } else if (index / 8 + index % 8) % 2 == 0 {
                LIGHT
            } else {
                DARK
            };
            if let Some(symbol) = label
                && last.is_some_and(|(_, to)| index == to)
            {
                color = soft_light(color, feedback_color(symbol));
            }
            let display = if view.flipped { 63 - index } else { index };
            let rounding = match display {
                0 => egui::CornerRadius {
                    nw: 8,
                    ..Default::default()
                },
                7 => egui::CornerRadius {
                    ne: 8,
                    ..Default::default()
                },
                56 => egui::CornerRadius {
                    sw: 8,
                    ..Default::default()
                },
                63 => egui::CornerRadius {
                    se: 8,
                    ..Default::default()
                },
                _ => Default::default(),
            };
            painter.rect_filled(area, rounding, color);
            if comparison.is_some_and(|(from, to)| from == index || to == index) {
                painter.rect_stroke(
                    area.shrink(0.5),
                    rounding,
                    egui::Stroke::new(1.0_f32, COMPARISON.gamma_multiply(0.65)),
                    egui::StrokeKind::Inside,
                );
            }
            if cell >= 24.0 && index % 8 == if view.flipped { 7 } else { 0 } {
                painter.text(
                    area.left_top() + Vec2::new(4.0, 3.0),
                    egui::Align2::LEFT_TOP,
                    (8 - index / 8).to_string(),
                    egui::FontId::proportional(coord_size),
                    BOARD_INK,
                );
            }
            if cell >= 24.0 && index / 8 == if view.flipped { 0 } else { 7 } {
                painter.text(
                    area.right_bottom() - Vec2::new(4.0, 2.0),
                    egui::Align2::RIGHT_BOTTOM,
                    ((b'a' + (index % 8) as u8) as char).to_string(),
                    egui::FontId::proportional(coord_size),
                    BOARD_INK,
                );
            }
            if targets & (1 << index) != 0 {
                if piece.is_some() {
                    painter.circle_stroke(
                        area.center(),
                        (cell / 2.0 - 6.5).max(1.0),
                        egui::Stroke::new(5.0_f32, BOARD_INK.gamma_multiply(0.35)),
                    );
                } else {
                    painter.circle_filled(
                        area.center(),
                        cell * 0.13,
                        BOARD_INK.gamma_multiply(0.30),
                    );
                }
            }
        }
        if let Some((from, _)) = comparison {
            painter.circle_stroke(
                square_rect(rect, cell, from, view.flipped).center(),
                view.size * 0.018,
                egui::Stroke::new(2.0_f32, COMPARISON),
            );
        }
        before_pieces(ui, rect);
        let turn = view.fen.split_whitespace().nth(1);
        let checked_side = if turn == Some("b") { 'k' } else { 'K' };
        for (index, piece) in board.iter().copied().enumerate() {
            if let Some(piece) = piece {
                let area = square_rect(rect, cell, index, view.flipped);
                if view.check && piece == checked_side {
                    let color = position_color(if view.mate { "Checkmate" } else { "Check" });
                    radial(
                        &painter,
                        area.center(),
                        cell * 0.58,
                        &[
                            (0.0, Color32::TRANSPARENT),
                            (0.30, Color32::TRANSPARENT),
                            (1.0, color.gamma_multiply(0.30)),
                        ],
                    );
                    painter.rect_stroke(
                        area.shrink(1.0),
                        (cell * 0.22) as u8,
                        egui::Stroke::new(2.0_f32, color),
                        egui::StrokeKind::Inside,
                    );
                }
                if motion_from(&view.transition, index, piece, &board).is_none() {
                    let selected = view.selected == Some(index);
                    if selected {
                        self.piece(
                            &painter,
                            piece,
                            area.translate(Vec2::new(0.0, 2.0)),
                            Color32::from_rgba_premultiplied(0, 0, 0, 65),
                        );
                    }
                    self.piece(
                        &painter,
                        piece,
                        if selected {
                            area.expand(cell * 0.03)
                        } else {
                            area
                        },
                        Color32::WHITE,
                    );
                }
            }
        }
        if let Some(transition) = &view.transition {
            for (index, piece) in board.into_iter().enumerate() {
                let Some(piece) = piece else { continue };
                let Some(source) = motion_from(&view.transition, index, piece, &board) else {
                    continue;
                };
                let from = square_rect(rect, cell, source, view.flipped);
                let to = square_rect(rect, cell, index, view.flipped);
                let t = motion_ease(transition.progress);
                let swell = (std::f32::consts::PI * t).sin() * cell * 0.0175;
                let shifted = to.translate((from.min - to.min) * (1.0 - t)).expand(swell);
                if transition.fast {
                    for (offset, opacity) in [(0.14, 0.115), (0.075, 0.16)] {
                        let shadow =
                            to.translate((from.min - to.min) * (1.0 - (t - offset).max(0.0)));
                        self.piece(
                            &painter,
                            piece,
                            shadow.expand(cell * 0.0125),
                            Color32::from_white_alpha(
                                (255.0 * opacity * (1.0 - transition.progress)) as u8,
                            ),
                        );
                    }
                }
                self.piece(&painter, piece, shifted, Color32::WHITE);
            }
            if transition.progress < 1.0 {
                ui.ctx().request_repaint();
            }
        }
        if let Some((from, to)) = comparison {
            arrow(&painter, rect, view.flipped, from, to, false);
        }
        effects(ui, rect);
        if let (Some((_, to)), Some(symbol)) = (last, label) {
            let color = feedback_color(symbol);
            let area = square_rect(rect, cell, to, view.flipped);
            let progress = view
                .transition
                .as_ref()
                .map_or(1.0, |motion| motion.progress);
            let entry = ((progress - 0.45) / 0.55).clamp(0.0, 1.0);
            let pop = 0.45 + 0.55 * entry + 0.28 * (std::f32::consts::PI * entry).sin();
            let diameter = if ui.ctx().content_rect().width() <= 780.0 {
                24.0
            } else {
                28.0
            };
            let center = area.right_top()
                + Vec2::new(-diameter * 0.38, diameter * 0.58 + 4.0 * (1.0 - entry));
            let opacity = (entry * 2.0).min(1.0);
            let radius = diameter * 0.5 * pop;
            painter.circle_filled(
                center + Vec2::new(0.0, 1.5),
                radius,
                Color32::from_black_alpha((80.0 * opacity) as u8),
            );
            painter.circle_filled(center, radius, color.gamma_multiply(opacity));
            paint_quality_icon(
                &painter,
                center,
                radius * 1.16,
                symbol,
                LABEL_INK.gamma_multiply(opacity),
            );
        }
        response
            .interact_pointer_pos()
            .filter(|_| response.clicked())
            .map(|point| {
                let relative = (point - rect.min) / cell;
                let index =
                    relative.y.clamp(0.0, 7.99) as usize * 8 + relative.x.clamp(0.0, 7.99) as usize;
                if view.flipped { 63 - index } else { index }
            })
    }

    pub fn capture(
        &self,
        ui: &egui::Ui,
        rect: Rect,
        piece: char,
        square: usize,
        flipped: bool,
        elapsed: f32,
    ) {
        let phase = ((elapsed - 0.06) / 0.23).clamp(0.0, 1.0);
        if phase >= 1.0 {
            return;
        }
        let cell = rect.width() / 8.0;
        let phase = cubic_ease(phase, [0.2, 0.75, 0.25, 1.0]);
        let scale = interpolate(phase, &[(0.0, 1.0), (0.35, 0.94), (1.0, 0.65)]);
        let opacity = interpolate(phase, &[(0.0, 0.80), (0.35, 0.60), (1.0, 0.0)]);
        let area = square_rect(rect, cell, square, flipped)
            .shrink(cell * 0.5 * (1.0 - scale))
            .translate(Vec2::new(0.0, 5.0 * ((phase - 0.35) / 0.65).max(0.0)));
        self.piece(
            &ui.painter_at(rect),
            piece,
            area,
            Color32::from_white_alpha((255.0 * opacity) as u8),
        );
        ui.ctx().request_repaint();
    }

    fn piece(&self, painter: &egui::Painter, piece: char, area: Rect, tint: Color32) {
        if let Some(texture) = self.pieces.get(&piece) {
            painter.image(
                texture.id(),
                area.shrink(4.0_f32.min(area.width() * 0.20)),
                Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
                tint,
            );
        }
    }
}

fn motion_ease(time: f32) -> f32 {
    cubic_ease(time, [0.22, 0.70, 0.20, 1.0])
}

fn cubic_ease(time: f32, control: [f32; 4]) -> f32 {
    let bezier = |t: f32, first: f32, second: f32| {
        let u = 1.0 - t;
        3.0 * u * u * t * first + 3.0 * u * t * t * second + t * t * t
    };
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..12 {
        let midpoint = (low + high) / 2.0;
        if bezier(midpoint, control[0], control[2]) < time {
            low = midpoint;
        } else {
            high = midpoint;
        }
    }
    bezier((low + high) / 2.0, control[1], control[3])
}

fn feedback_color(symbol: &str) -> Color32 {
    match symbol {
        "!" | "!!" => Color32::from_rgb(149, 212, 236),
        "?!" | "×" => Color32::from_rgb(240, 202, 119),
        "?" | "??" => Color32::from_rgb(242, 160, 139),
        _ => Color32::from_rgb(179, 219, 123),
    }
}

fn soft_light(base: Color32, overlay: Color32) -> Color32 {
    fn channel(base: u8, overlay: u8) -> u8 {
        let base = base as f32 / 255.0;
        let overlay = overlay as f32 / 255.0;
        let contrast = if base <= 0.25 {
            ((16.0 * base - 12.0) * base + 4.0) * base
        } else {
            base.sqrt()
        };
        let value = if overlay <= 0.5 {
            base - (1.0 - 2.0 * overlay) * base * (1.0 - base)
        } else {
            base + (2.0 * overlay - 1.0) * (contrast - base)
        };
        (value * 255.0).round() as u8
    }
    Color32::from_rgb(
        channel(base.r(), overlay.r()),
        channel(base.g(), overlay.g()),
        channel(base.b(), overlay.b()),
    )
}

fn legal_targets(fen: &str, from: usize) -> u64 {
    let Ok(position) = chessash_review_core::parse_fen(fen) else {
        return 0;
    };
    let mut targets = 0;
    for played in position.legal_moves() {
        let uci = UciMove::from_move(played, CastlingMode::Standard).to_string();
        if let Some((source, to)) = squares(&uci)
            && source == from
        {
            targets |= 1 << to;
        }
    }
    targets
}

pub fn review_highlights(ui: &egui::Ui, rect: Rect, flipped: bool, targets: &[String]) {
    let cell = rect.width() / 8.0;
    let painter = ui.painter_at(rect);
    for target in targets {
        let Some(index) = target.as_bytes().get(..2).and_then(square) else {
            continue;
        };
        let target = square_rect(rect, cell, index, flipped).shrink(cell * 0.05);
        painter.rect_stroke(
            target,
            (cell * 0.12) as u8,
            egui::Stroke::new(3.0_f32, COMPARISON),
            egui::StrokeKind::Inside,
        );
    }
}

pub fn review_threat(ui: &egui::Ui, rect: Rect, flipped: bool, uci: &str) {
    if let Some((from, to)) = squares(uci) {
        arrow(&ui.painter_at(rect), rect, flipped, from, to, true);
    }
}

fn arrow(painter: &egui::Painter, rect: Rect, flipped: bool, from: usize, to: usize, threat: bool) {
    let cell = rect.width() / 8.0;
    let start = square_rect(rect, cell, from, flipped).center();
    let end = square_rect(rect, cell, to, flipped).center();
    let direction = (end - start).normalized();
    let base = end - direction * cell * 0.27;
    let side = Vec2::new(-direction.y, direction.x) * cell * 0.16;
    let color = if threat {
        THREAT
    } else {
        COMPARISON.gamma_multiply(0.78)
    };
    let stroke = egui::Stroke::new(cell * 0.09, color);
    if threat {
        painter.extend(egui::Shape::dashed_line(
            &[start, base],
            stroke,
            cell * 0.23,
            cell * 0.11,
        ));
    } else {
        painter.line_segment([start, base], stroke);
    }
    painter.add(egui::Shape::convex_polygon(
        vec![end, base + side, base - side],
        color,
        egui::Stroke::NONE,
    ));
}

fn position_color(title: &str) -> Color32 {
    match title {
        "Checkmate" | "Scacco matto" => Color32::from_rgb(245, 213, 140),
        "Stalemate" | "Stallo" => Color32::from_rgb(217, 233, 243),
        _ => Color32::from_rgb(244, 177, 144),
    }
}

fn interpolate(phase: f32, frames: &[(f32, f32)]) -> f32 {
    let phase = phase.clamp(0.0, 1.0);
    for pair in frames.windows(2) {
        let [(start, from), (end, to)] = pair else {
            continue;
        };
        if phase <= *end {
            return egui::lerp(*from..=*to, (phase - start).max(0.0) / (end - start));
        }
    }
    frames.last().map_or(0.0, |(_, value)| *value)
}

fn radial(painter: &egui::Painter, center: Pos2, radius: f32, stops: &[(f32, Color32)]) {
    let mut mesh = egui::Mesh::default();
    let segments = 48;
    let uv = egui::epaint::WHITE_UV;
    for (ring, &(fraction, color)) in stops.iter().enumerate() {
        for index in 0..segments {
            let direction = Vec2::angled(std::f32::consts::TAU * index as f32 / segments as f32);
            mesh.vertices.push(egui::epaint::Vertex {
                pos: center + direction * radius * fraction,
                uv,
                color,
            });
            if ring > 0 {
                let next = (index + 1) % segments;
                let inner = ((ring - 1) * segments) as u32;
                let outer = (ring * segments) as u32;
                let index = index as u32;
                let next = next as u32;
                mesh.indices.extend([
                    inner + index,
                    outer + index,
                    outer + next,
                    inner + index,
                    outer + next,
                    inner + next,
                ]);
            }
        }
    }
    painter.add(egui::Shape::mesh(mesh));
}

pub fn paint_quality_icon(
    painter: &egui::Painter,
    center: Pos2,
    size: f32,
    symbol: &str,
    color: Color32,
) {
    let stroke = egui::Stroke::new(size * 0.13, color);
    let at = |x, y| center + Vec2::new(x, y) * size;
    match symbol {
        "book" => book_icon(painter, center, size * 0.86, color),
        "✓" => {
            painter.add(egui::Shape::line(
                vec![at(-0.38, 0.0), at(-0.10, 0.27), at(0.40, -0.30)],
                stroke,
            ));
        }
        "×" => {
            painter.line_segment([at(-0.29, -0.29), at(0.29, 0.29)], stroke);
            painter.line_segment([at(-0.29, 0.29), at(0.29, -0.29)], stroke);
        }
        _ => {
            painter.text(
                center,
                egui::Align2::CENTER_CENTER,
                symbol,
                egui::FontId::proportional(size),
                color,
            );
        }
    }
}

fn book_icon(painter: &egui::Painter, center: Pos2, size: f32, color: Color32) {
    for side in [-1.0, 1.0] {
        let corner = center + Vec2::new(size * side * 0.68, -size * 0.49);
        painter.add(egui::Shape::line(
            vec![
                center + Vec2::new(0.0, size * 0.48),
                corner + Vec2::new(0.0, size * 0.8),
                corner,
                center - Vec2::new(0.0, size * 0.3),
                center + Vec2::new(0.0, size * 0.48),
            ],
            egui::Stroke::new(1.25_f32, color),
        ));
    }
}

pub fn effects(
    ui: &mut egui::Ui,
    rect: Rect,
    time: f32,
    last: &str,
    flipped: bool,
    quality: Option<(&str, Color32)>,
    brilliant: Option<&str>,
    situation: Option<(&str, Color32, usize)>,
) {
    if !(0.0..1.75).contains(&time) {
        return;
    }
    let cell = rect.width() / 8.0;
    let paint = ui.painter_at(rect);
    if let Some((_, to)) = squares(last) {
        let center = square_rect(rect, cell, to, flipped).center();
        if time < 0.40 {
            let phase = cubic_ease(time / 0.40, [0.0, 0.0, 0.58, 1.0]);
            let glow = Color32::from_rgb(230, 249, 194)
                .gamma_multiply(0.32 * interpolate(phase, &[(0.2, 0.0), (0.55, 1.0), (1.0, 0.0)]));
            let scale = interpolate(phase, &[(0.2, 0.7), (0.55, 1.0), (1.0, 1.2)]);
            radial(
                &paint,
                center,
                cell * 0.5 * scale,
                &[(0.0, glow), (0.68, Color32::TRANSPARENT)],
            );
        }
        if let Some((symbol, _)) = quality {
            quality_landing(&paint, center, cell, time, symbol);
        }
    }
    if let Some((title, color, king)) = situation
        && time < 1.34
    {
        let center = square_rect(rect, cell, king, flipped).center();
        let stalemate = matches!(title, "Stalemate" | "Stallo");
        for (index, delay) in [0.16, 0.27].into_iter().enumerate() {
            let phase = (time - delay) / 0.80;
            if !(0.0..1.0).contains(&phase) {
                continue;
            }
            let phase = cubic_ease(phase, [0.16, 0.8, 0.24, 1.0]);
            let radius = cell
                * 0.5
                * if stalemate {
                    egui::lerp(1.60..=0.95, phase)
                } else {
                    egui::lerp(0.90..=1.55, phase)
                };
            let alpha = if stalemate {
                interpolate(phase, &[(0.0, 0.0), (0.3, 0.8), (1.0, 0.0)])
            } else {
                0.85 * (1.0 - phase)
            };
            let stroke = egui::Stroke::new(2.0 - index as f32, color.gamma_multiply(alpha));
            if stalemate {
                dashed_ring(&paint, center, radius, 12, (1.0 - phase) * -0.61, stroke);
            } else {
                paint.rect_stroke(
                    Rect::from_center_size(center, Vec2::splat(radius * 2.0)),
                    10.0,
                    stroke,
                    egui::StrokeKind::Middle,
                );
            }
        }
        if brilliant.is_none() {
            position_notice(ui, rect, title, color, Some(time));
        }
    }
    if let Some(title) = brilliant {
        sacrifice_sequence(ui, &paint, rect, time, title);
    }
    if brilliant.is_some() || time < if situation.is_some() { 1.34 } else { 0.91 } {
        ui.ctx().request_repaint();
    }
}

fn sacrifice_sequence(ui: &egui::Ui, paint: &egui::Painter, rect: Rect, elapsed: f32, title: &str) {
    let time = elapsed / 1.75;
    let phase = cubic_ease(time, [0.25, 0.1, 0.25, 1.0]);
    let light = interpolate(phase, &[(0.0, 0.0), (0.18, 1.0), (0.64, 1.0), (1.0, 0.0)]);
    let center = rect.center();
    let diameter = rect.width();
    radial(
        paint,
        center,
        rect.center().distance(rect.left_top()) * 1.002,
        &[
            (
                0.0,
                Color32::from_rgb(10, 46, 45).gamma_multiply(light * 0.12),
            ),
            (
                0.12,
                Color32::from_rgb(10, 46, 45).gamma_multiply(light * 0.12),
            ),
            (
                1.0,
                Color32::from_rgb(6, 20, 24).gamma_multiply(light * 0.72),
            ),
        ],
    );

    for (index, delay) in [0.16, 0.24].into_iter().enumerate() {
        let orbit = (elapsed - delay) / 1.30;
        if !(0.0..1.0).contains(&orbit) {
            continue;
        }
        let orbit = cubic_ease(orbit, [0.16, 0.8, 0.24, 1.0]);
        let alpha = interpolate(orbit, &[(0.0, 0.0), (0.20, 1.0), (1.0, 0.0)]);
        let radius = diameter * 0.215 * egui::lerp(0.5..=1.7, orbit);
        if index == 0 {
            let glow = Color32::from_rgb(88, 244, 204);
            for edge in 1..=6 {
                let width = edge as f32 * 3.0;
                paint.circle_stroke(
                    center,
                    radius,
                    egui::Stroke::new(
                        width,
                        glow.gamma_multiply(alpha * 0.04 * (1.0 - width / 24.0)),
                    ),
                );
            }
            paint.circle_stroke(
                center,
                radius,
                egui::Stroke::new(
                    1.0_f32,
                    Color32::from_rgb(167, 255, 231).gamma_multiply(alpha * 0.58),
                ),
            );
        } else {
            dashed_ring(
                paint,
                center,
                radius * 0.76,
                40,
                egui::lerp(-0.436..=0.262, orbit),
                egui::Stroke::new(
                    1.0_f32,
                    Color32::from_rgb(193, 255, 242).gamma_multiply(alpha * 0.32),
                ),
            );
        }
    }
    for index in 0..12 {
        let phase = elapsed - 0.22 - (index % 3) as f32 * 0.025;
        if !(0.0..1.0).contains(&phase) {
            continue;
        }
        let phase = cubic_ease(phase, [0.16, 0.8, 0.24, 1.0]);
        let direction =
            Vec2::angled(std::f32::consts::TAU * index as f32 / 12.0 - std::f32::consts::FRAC_PI_2);
        let distance = egui::lerp(
            36.0..=(ui.ctx().content_rect().width() * 0.23).clamp(90.0, 160.0),
            phase,
        );
        let half_length = egui::lerp(2.4..=1.8, phase);
        let alpha = interpolate(phase, &[(0.0, 0.0), (0.20, 0.90), (1.0, 0.0)]);
        paint.line_segment(
            [
                center + direction * (distance - half_length),
                center + direction * (distance + half_length),
            ],
            egui::Stroke::new(
                3.0_f32,
                Color32::from_rgb(217, 255, 246).gamma_multiply(alpha),
            ),
        );
    }

    let alpha = css_keyframes(time, &[(0.08, 0.0), (0.27, 1.0), (0.70, 1.0), (1.0, 0.0)]);
    let scale = css_keyframes(
        time,
        &[
            (0.08, 0.78),
            (0.27, 1.035),
            (0.38, 1.0),
            (0.70, 1.0),
            (1.0, 1.025),
        ],
    );
    let shift = css_keyframes(time, &[(0.08, 8.0), (0.27, 0.0), (0.70, 0.0), (1.0, -5.0)]);
    let width = ui.ctx().content_rect().width();
    let size = (diameter * 0.17).clamp(64.0, 110.0) * scale;
    let font = (width * 0.03).clamp(17.0, 29.0) * scale;
    let label_color = Color32::from_rgb(239, 255, 249);
    let title = paint.layout_no_wrap(
        title.to_owned(),
        egui::FontId::proportional(font),
        label_color.gamma_multiply(alpha),
    );
    let spacing = 12.0 * scale;
    let center = center + Vec2::new(0.0, shift - (title.size().y + spacing * 2.0 + 2.0) * 0.5);
    let emblem = Rect::from_center_size(center, Vec2::splat(size));
    if let Some(texture) = sacrifice_emblem(ui.ctx()) {
        paint.image(
            texture.id(),
            emblem.expand(size * 0.18),
            Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
            Color32::WHITE.gamma_multiply(alpha),
        );
    }
    let symbol_font = egui::FontId::proportional((width * 0.07).clamp(32.0, 62.0) * scale);
    paint.text(
        center + Vec2::new(0.0, 2.0),
        egui::Align2::CENTER_CENTER,
        "!!",
        symbol_font.clone(),
        Color32::from_rgb(16, 45, 43).gamma_multiply(alpha),
    );
    paint.text(
        center,
        egui::Align2::CENTER_CENTER,
        "!!",
        symbol_font,
        Color32::from_rgb(236, 255, 249).gamma_multiply(alpha),
    );
    let text_origin = egui::pos2(center.x - title.size().x / 2.0, emblem.bottom() + spacing);
    let rule_y = text_origin.y + title.size().y + spacing;
    paint.galley(text_origin, title, label_color.gamma_multiply(alpha));
    for offset in 0..24 {
        let from = Pos2::new(center.x + offset as f32 * scale, rule_y);
        let to = Pos2::new(from.x + scale, rule_y);
        let color =
            Color32::from_rgb(180, 255, 232).gamma_multiply(alpha * (1.0 - offset as f32 / 24.0));
        paint.line_segment([from, to], egui::Stroke::new(2.0_f32, color));
        paint.line_segment(
            [
                Pos2::new(2.0 * center.x - from.x, rule_y),
                Pos2::new(2.0 * center.x - to.x, rule_y),
            ],
            egui::Stroke::new(2.0_f32, color),
        );
    }
}

fn css_keyframes(time: f32, stops: &[(f32, f32)]) -> f32 {
    let mut previous = stops[0];
    if time <= previous.0 {
        return previous.1;
    }
    for &next in &stops[1..] {
        if time <= next.0 {
            if time == next.0 {
                return next.1;
            }
            let progress = ((time - previous.0) / (next.0 - previous.0)).clamp(0.0, 1.0);
            return egui::lerp(
                previous.1..=next.1,
                cubic_ease(progress, [0.16, 0.8, 0.24, 1.0]),
            );
        }
        previous = next;
    }
    previous.1
}

#[cfg(test)]
mod animation_tests {
    use super::css_keyframes;

    #[test]
    fn spotlight_holds_until_seventy_percent_of_its_runtime() {
        let opacity = [(0.08, 0.0), (0.27, 1.0), (0.70, 1.0), (1.0, 0.0)];
        assert_eq!(css_keyframes(0.05, &opacity), 0.0);
        assert!((css_keyframes(0.68 / 1.75, &opacity) - 1.0).abs() < 0.0001);
        assert!((css_keyframes(0.70, &opacity) - 1.0).abs() < 0.0001);
        assert!(css_keyframes(0.90, &opacity) < 0.85);
    }
}

fn sacrifice_emblem(ctx: &egui::Context) -> Option<TextureHandle> {
    let id = egui::Id::new("chessash-sacrifice-emblem");
    if let Some(texture) = ctx.data(|data| data.get_temp::<TextureHandle>(id)) {
        return Some(texture);
    }
    let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 136">
      <defs>
        <linearGradient id="body" x2="80%" y2="100%"><stop stop-color="#75dcc1"/><stop offset="1" stop-color="#1b706a"/></linearGradient>
        <radialGradient id="light"><stop stop-color="#72f4d3" stop-opacity=".8"/><stop offset="1" stop-color="#72f4d3" stop-opacity="0"/></radialGradient>
      </defs>
      <rect x="15" y="23" width="106" height="106" rx="31" fill="#061418" opacity=".22"/>
      <rect x="13" y="13" width="110" height="110" rx="33" fill="#acffe6" opacity=".09"/>
      <rect x="18" y="18" width="100" height="100" rx="28" fill="url(#body)" stroke="#d8fff5" stroke-opacity=".8"/>
      <circle cx="116" cy="23" r="19" fill="url(#light)"/>
      <path d="M116 8c2 0 2 10 5 12s9 2 9 4-7 2-9 4-3 11-5 11-2-10-5-12-9-1-9-4 7-2 9-4 3-11 5-11Z" fill="none" stroke="#effff9" stroke-width="3" stroke-linejoin="round"/>
      <path d="M101 29v7m-3.5-3.5h7" stroke="#effff9" stroke-width="2.3" stroke-linecap="round"/>
    </svg>"##;
    let pixmap = rasterize(svg, 272)?;
    let image = egui::ColorImage::from_rgba_premultiplied([272, 272], pixmap.data());
    let texture = ctx.load_texture("chessash-sacrifice-emblem", image, Default::default());
    ctx.data_mut(|data| data.insert_temp(id, texture.clone()));
    Some(texture)
}

fn quality_landing(paint: &egui::Painter, center: Pos2, cell: f32, time: f32, symbol: &str) {
    let inward = matches!(symbol, "?" | "??");
    let diamond = matches!(symbol, "★" | "!");
    let dashed = matches!(symbol, "?!" | "×");
    let color = if symbol == "!!" {
        Color32::from_rgb(179, 255, 240)
    } else {
        feedback_color(symbol)
    };
    let duration = if symbol == "!!" { 1.1 } else { 0.66 };
    for (index, delay) in [0.18, 0.25].into_iter().enumerate() {
        if index != 0 && symbol == "book" {
            break;
        }
        let phase = (time - delay) / duration;
        if !(0.0..1.0).contains(&phase) {
            continue;
        }
        let phase = cubic_ease(phase, [0.16, 0.8, 0.24, 1.0]);
        let (rise, peak, scale) = if inward {
            (0.25, 0.75, egui::lerp(1.20..=0.85, phase))
        } else {
            (0.20, 0.8, egui::lerp(0.65..=1.40, phase))
        };
        let alpha = interpolate(phase, &[(0.0, 0.0), (rise, peak), (1.0, 0.0)]);
        let radius = cell * 0.42 * scale;
        let stroke = egui::Stroke::new(2.0 - index as f32, color.gamma_multiply(alpha));
        if dashed {
            dashed_ring(paint, center, radius, 12, 0.0, stroke);
        } else if diamond {
            let points = vec![
                center - Vec2::Y * radius,
                center + Vec2::X * radius,
                center + Vec2::Y * radius,
                center - Vec2::X * radius,
            ];
            paint.add(egui::Shape::closed_line(points, stroke));
        } else {
            let corner = if inward { 0.12 } else { 0.30 };
            paint.rect_stroke(
                Rect::from_center_size(center, Vec2::splat(radius * 2.0)),
                (radius * 2.0 * corner) as u8,
                stroke,
                egui::StrokeKind::Middle,
            );
        }
    }
}

fn dashed_ring(
    paint: &egui::Painter,
    center: Pos2,
    radius: f32,
    pieces: usize,
    rotation: f32,
    stroke: egui::Stroke,
) {
    let interval = std::f32::consts::TAU / pieces as f32;
    for index in 0..pieces {
        let angle = index as f32 * interval + rotation;
        let points = (0..=4)
            .map(|sample| center + Vec2::angled(angle + sample as f32 * interval * 0.15) * radius)
            .collect();
        paint.add(egui::Shape::line(points, stroke));
    }
}

pub fn position_notice(
    ui: &egui::Ui,
    rect: Rect,
    title: &str,
    color: Color32,
    elapsed: Option<f32>,
) {
    let (symbol, duration) = match title {
        "Checkmate" | "Scacco matto" => ("#", 1.10),
        "Stalemate" | "Stallo" => ("½", 1.10),
        _ => ("+", 0.85),
    };
    let (alpha, y, scale) = if let Some(elapsed) = elapsed {
        let phase = (elapsed - 0.24) / duration;
        if !(0.0..1.0).contains(&phase) {
            return;
        }
        let phase = cubic_ease(phase, [0.16, 0.8, 0.24, 1.0]);
        (
            interpolate(phase, &[(0.0, 0.0), (0.22, 1.0), (0.70, 1.0), (1.0, 0.0)]),
            interpolate(phase, &[(0.0, -6.0), (0.22, 0.0), (0.70, 0.0), (1.0, -3.0)]),
            interpolate(phase, &[(0.0, 0.94), (0.22, 1.0), (1.0, 1.0)]),
        )
    } else {
        (1.0, 0.0, 1.0)
    };
    let paint = ui.painter_at(rect);
    let font = egui::FontId::proportional((rect.width() * 0.0375).clamp(12.0, 16.0) * scale);
    let text = paint.layout_no_wrap(title.to_owned(), font, color.gamma_multiply(alpha));
    let size = Vec2::new(57.0 * scale + text.size().x, 39.0 * scale);
    let badge = Rect::from_center_size(
        rect.center_top() + Vec2::new(0.0, rect.width() * 0.03 + size.y * 0.5 + y),
        size,
    );
    paint.rect_filled(
        badge.translate(Vec2::new(0.0, 3.0)),
        20.0,
        Color32::BLACK.gamma_multiply(0.22 * alpha),
    );
    paint.rect_filled(
        badge,
        20.0,
        Color32::from_rgb(32, 43, 39).gamma_multiply(alpha),
    );
    paint.rect_stroke(
        badge,
        20.0,
        egui::Stroke::new(1.0_f32, color.gamma_multiply(0.48 * alpha)),
        egui::StrokeKind::Inside,
    );
    let center = badge.left_center() + Vec2::new(21.5 * scale, 0.0);
    paint.circle_filled(center, 12.5 * scale, color.gamma_multiply(0.15 * alpha));
    paint.text(
        center,
        egui::Align2::CENTER_CENTER,
        symbol,
        egui::FontId::proportional(20.0 * scale),
        color.gamma_multiply(alpha),
    );
    paint.galley(
        egui::pos2(
            badge.left() + 43.0 * scale,
            badge.center().y - text.size().y / 2.0,
        ),
        text,
        color.gamma_multiply(alpha),
    );
}

fn motion_from(
    transition: &Option<Transition<'_>>,
    index: usize,
    piece: char,
    board: &[Option<char>; 64],
) -> Option<usize> {
    let transition = transition.as_ref()?;
    let (mut from, mut to) = squares(transition.uci)?;
    if transition.reverse {
        std::mem::swap(&mut from, &mut to);
    }
    if index == to {
        return Some(from);
    }
    let (king_start, king_end) = if transition.reverse {
        (to, from)
    } else {
        (from, to)
    };
    if matches!(piece, 'r' | 'R')
        && matches!(board[to], Some('k' | 'K'))
        && king_start % 8 == 4
        && king_start.abs_diff(king_end) == 2
    {
        let row = king_start / 8 * 8;
        let (mut rook_from, mut rook_to) = if king_end % 8 == 6 {
            (row + 7, row + 5)
        } else {
            (row, row + 3)
        };
        if transition.reverse {
            std::mem::swap(&mut rook_from, &mut rook_to);
        }
        if index == rook_to {
            return Some(rook_from);
        }
    }
    None
}

fn square_rect(board: Rect, cell: f32, square: usize, flipped: bool) -> Rect {
    let index = if flipped { 63 - square } else { square };
    Rect::from_min_size(
        board.min + Vec2::new((index % 8) as f32 * cell, (index / 8) as f32 * cell),
        Vec2::splat(cell),
    )
}

pub fn placement(fen: &str) -> [Option<char>; 64] {
    let mut cells = [None; 64];
    for (row, rank) in fen
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('/')
        .take(8)
        .enumerate()
    {
        let mut column = 0;
        for value in rank.chars() {
            if column >= 8 {
                break;
            }
            if let Some(step) = value.to_digit(10) {
                column += step as usize;
            } else {
                cells[row * 8 + column] = Some(value);
                column += 1;
            }
        }
    }
    cells
}

pub fn squares(uci: &str) -> Option<(usize, usize)> {
    let bytes = uci.as_bytes();
    Some((square(bytes.get(..2)?)?, square(bytes.get(2..4)?)?))
}

fn square(bytes: &[u8]) -> Option<usize> {
    let file = bytes[0].checked_sub(b'a').filter(|i| *i < 8)?;
    let rank = b'8'.checked_sub(bytes[1]).filter(|i| *i < 8)?;
    Some((rank * 8 + file) as usize)
}

pub fn coordinate(index: usize) -> String {
    format!("{}{}", (b'a' + (index % 8) as u8) as char, 8 - index / 8)
}

pub fn captured_piece(fen: &str, uci: &str) -> Option<(char, usize)> {
    let (from, to) = squares(uci)?;
    let pieces = placement(fen);
    if let Some(piece) = pieces[to] {
        return Some((piece, to));
    }
    if from % 8 != to % 8 && matches!(pieces[from], Some('p' | 'P')) {
        let captured = from / 8 * 8 + to % 8;
        return pieces[captured].map(|piece| (piece, captured));
    }
    None
}

pub fn rasterize(svg: &[u8], size: u32) -> Option<resvg::tiny_skia::Pixmap> {
    let tree = resvg::usvg::Tree::from_data(svg, &Default::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size, size)?;
    let transform = resvg::tiny_skia::Transform::from_scale(
        size as f32 / tree.size().width(),
        size as f32 / tree.size().height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Some(pixmap)
}

pub fn piece_art(piece: char) -> Option<&'static [u8]> {
    ART.iter()
        .find(|(key, _)| *key == piece)
        .map(|(_, art)| *art)
}
