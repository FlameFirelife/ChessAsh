use eframe::egui::{self, Color32, FontFamily, FontId, Pos2, RichText, Stroke, Vec2};

pub const ACCENT: Color32 = Color32::from_rgb(166, 214, 110);
pub const INK: Color32 = Color32::from_rgb(244, 247, 237);
pub const COACH: Color32 = Color32::from_rgb(243, 247, 233);
pub const COACH_INK: Color32 = Color32::from_rgb(48, 60, 37);
pub const BLUE: Color32 = Color32::from_rgb(116, 199, 236);
pub const FONT: &[u8] = include_bytes!("../assets/host-grotesk.ttf");

pub struct Art {
    pub coach: egui::TextureHandle,
    pub icons: [egui::TextureHandle; 18],
}

impl Art {
    pub fn new(ctx: &egui::Context) -> Self {
        Self {
            coach: load(
                ctx,
                "coach",
                include_bytes!("../../public/coach/super-king.svg"),
                128,
            ),
            icons: ICON_ART.map(|(name, source)| load(ctx, name, source, 64)),
        }
    }
}

#[derive(Clone, Copy)]
pub enum Icon {
    Flame,
    Share,
    Download,
    Settings,
    Sliders,
    Book,
    Library,
    Search,
    Message,
    Play,
    Rotate,
    Retry,
    Check,
    Next,
    Previous,
    Last,
    First,
    Plus,
}

impl Art {
    pub fn icon(&self, ui: &mut egui::Ui, icon: Icon, size: f32, color: Color32) {
        ui.add(egui::Image::new((self.icons[icon as usize].id(), Vec2::splat(size))).tint(color));
    }

    pub fn icon_button(
        &self,
        ui: &mut egui::Ui,
        icon: Icon,
        text: &str,
        size: Vec2,
    ) -> egui::Response {
        ui.add(
            egui::Button::image(
                egui::Image::new((self.icons[icon as usize].id(), Vec2::splat(18.0)))
                    .tint(ui.visuals().text_color()),
            )
            .min_size(size)
            .frame(false),
        )
        .on_hover_text(text)
    }
}

const ICON_ART: [(&str, &[u8]); 18] = [
    ("flame", include_bytes!("../assets/icons/flame.svg")),
    ("share-2", include_bytes!("../assets/icons/share-2.svg")),
    (
        "arrow-down-to-line",
        include_bytes!("../assets/icons/arrow-down-to-line.svg"),
    ),
    ("settings", include_bytes!("../assets/icons/settings.svg")),
    (
        "sliders-horizontal",
        include_bytes!("../assets/icons/sliders-horizontal.svg"),
    ),
    ("book-open", include_bytes!("../assets/icons/book-open.svg")),
    ("library", include_bytes!("../assets/icons/library.svg")),
    ("search", include_bytes!("../assets/icons/search.svg")),
    (
        "message-square",
        include_bytes!("../assets/icons/message-square.svg"),
    ),
    ("play", include_bytes!("../assets/icons/play.svg")),
    ("rotate-cw", include_bytes!("../assets/icons/rotate-cw.svg")),
    (
        "rotate-ccw",
        include_bytes!("../assets/icons/rotate-ccw.svg"),
    ),
    ("check", include_bytes!("../assets/icons/check.svg")),
    (
        "chevron-right",
        include_bytes!("../assets/icons/chevron-right.svg"),
    ),
    (
        "chevron-left",
        include_bytes!("../assets/icons/chevron-left.svg"),
    ),
    (
        "chevrons-right",
        include_bytes!("../assets/icons/chevrons-right.svg"),
    ),
    (
        "chevrons-left",
        include_bytes!("../assets/icons/chevrons-left.svg"),
    ),
    ("plus", include_bytes!("../assets/icons/plus.svg")),
];

fn load(ctx: &egui::Context, id: &str, source: &[u8], size: u32) -> egui::TextureHandle {
    let image = (if size == 0 {
        resvg::tiny_skia::Pixmap::decode_png(source).ok()
    } else {
        crate::board::rasterize(source, size)
    })
    .map(|p| {
        egui::ColorImage::from_rgba_premultiplied(
            [p.width() as usize, p.height() as usize],
            p.data(),
        )
    })
    .unwrap_or_else(|| egui::ColorImage::filled([1, 1], Color32::TRANSPARENT));
    ctx.load_texture(id, image, Default::default())
}

pub fn style(ctx: &egui::Context, light: bool, size: f32) {
    let mut fonts = egui::FontDefinitions::default();
    let bold = FontFamily::Name("ChessAsh bold".into());
    for (name, data, family) in [
        ("Host Grotesk", FONT, FontFamily::Proportional),
        (
            "Host Grotesk bold",
            include_bytes!("../assets/host-grotesk-bold.ttf").as_slice(),
            bold.clone(),
        ),
        (
            "Atkinson Mono",
            include_bytes!("../assets/atkinson-mono.ttf").as_slice(),
            FontFamily::Monospace,
        ),
    ] {
        fonts
            .font_data
            .insert(name.into(), egui::FontData::from_static(data).into());
        let fallback = fonts
            .families
            .get(&FontFamily::Proportional)
            .cloned()
            .unwrap_or_default();
        let stack = fonts.families.entry(family).or_insert(fallback);
        stack.insert(0, name.into());
    }
    fonts
        .families
        .entry(FontFamily::Proportional)
        .or_default()
        .push("Hack".into());
    ctx.set_fonts(fonts);
    let mut style = (*ctx.global_style()).clone();
    style.text_styles.insert(
        egui::TextStyle::Body,
        FontId::proportional(size.clamp(12.0, 24.0)),
    );
    style.text_styles.insert(
        egui::TextStyle::Button,
        FontId::proportional(size.clamp(12.0, 24.0) - 2.0),
    );
    style
        .text_styles
        .insert(egui::TextStyle::Heading, FontId::new(17.0, bold));
    style.spacing.item_spacing = Vec2::new(8.0, 6.0);
    style.spacing.interact_size.y = 30.0;
    style.visuals = visuals(light);
    ctx.set_global_style(style);
}

pub fn visuals(light: bool) -> egui::Visuals {
    let mut v = if light {
        egui::Visuals::light()
    } else {
        egui::Visuals::dark()
    };
    v.panel_fill = if light {
        Color32::from_rgb(233, 239, 223)
    } else {
        Color32::from_rgb(43, 46, 40)
    };
    v.window_fill = if light {
        Color32::from_rgb(248, 250, 239)
    } else {
        Color32::from_rgb(58, 64, 53)
    };
    v.extreme_bg_color = if light {
        Color32::from_rgb(220, 231, 207)
    } else {
        Color32::from_rgb(48, 54, 43)
    };
    v.override_text_color = Some(if light {
        Color32::from_rgb(41, 59, 32)
    } else {
        INK
    });
    v.selection.bg_fill = Color32::from_rgb(83, 109, 57);
    v.selection.stroke = Stroke::new(1.0_f32, INK);
    v.window_corner_radius = egui::CornerRadius::same(16);
    v.widgets.noninteractive.bg_fill = v.window_fill;
    for (widget, color) in [
        (
            &mut v.widgets.inactive,
            if light {
                Color32::from_rgb(227, 237, 214)
            } else {
                Color32::from_rgb(69, 77, 63)
            },
        ),
        (
            &mut v.widgets.hovered,
            if light {
                Color32::from_rgb(215, 229, 198)
            } else {
                Color32::from_rgb(80, 91, 70)
            },
        ),
        (&mut v.widgets.active, Color32::from_rgb(78, 111, 48)),
    ] {
        widget.bg_fill = color;
        widget.weak_bg_fill = color;
        widget.bg_stroke = Stroke::NONE;
        widget.corner_radius = egui::CornerRadius::same(9);
    }
    v
}

pub fn panel(ui: &egui::Ui) -> egui::Frame {
    egui::Frame::new()
        .fill(ui.visuals().window_fill)
        .corner_radius(18)
        .inner_margin(12)
        .shadow(egui::Shadow {
            offset: [0, 5],
            blur: 14,
            spread: 0,
            color: Color32::from_black_alpha(if ui.visuals().dark_mode { 44 } else { 16 }),
        })
}

pub fn panel_for_modal(style: &egui::Style) -> egui::Frame {
    egui::Frame::new()
        .fill(style.visuals.window_fill)
        .corner_radius(18)
        .inner_margin(16)
}

pub fn field_style(ui: &mut egui::Ui) {
    let dark = ui.visuals().dark_mode;
    let border = if dark {
        Color32::from_rgb(123, 141, 109)
    } else {
        Color32::from_rgb(141, 165, 120)
    };
    let fill = ui.visuals().extreme_bg_color;
    let style = ui.style_mut();
    style.spacing.button_padding = Vec2::new(14.0, 8.0);
    style.spacing.interact_size.y = 44.0;
    for widget in [
        &mut style.visuals.widgets.inactive,
        &mut style.visuals.widgets.hovered,
        &mut style.visuals.widgets.active,
    ] {
        widget.bg_fill = fill;
        widget.weak_bg_fill = fill;
        widget.bg_stroke = Stroke::new(1.0_f32, border);
        widget.corner_radius = egui::CornerRadius::same(8);
    }
}

pub fn field_combo(id: &str, width: f32, selected: impl Into<egui::WidgetText>) -> egui::ComboBox {
    egui::ComboBox::from_id_salt(id)
        .width(width)
        .selected_text(selected)
        .icon(|ui, rect, visual, open| {
            let center = rect.center();
            let direction = if open { -1.0 } else { 1.0 };
            ui.painter().add(egui::Shape::line(
                vec![
                    center + Vec2::new(-4.0, -direction * 2.0),
                    center + Vec2::new(0.0, direction * 2.0),
                    center + Vec2::new(4.0, -direction * 2.0),
                ],
                Stroke::new(1.25_f32, visual.fg_stroke.color),
            ));
        })
}

pub fn checkbox(ui: &mut egui::Ui, checked: &mut bool, text: &str) {
    let response = ui.add_sized(
        [ui.available_width(), 32.0],
        egui::Button::new("").frame(false),
    );
    if response.clicked() {
        *checked = !*checked;
    }
    response.widget_info(|| {
        egui::WidgetInfo::selected(egui::WidgetType::Checkbox, ui.is_enabled(), *checked, text)
    });
    let center = response.rect.left_center() + Vec2::new(13.0, 0.0);
    let rect = egui::Rect::from_center_size(center, Vec2::splat(16.0));
    let fill = if *checked { ACCENT } else { Color32::WHITE };
    let painter = ui.painter();
    painter.rect_filled(rect, 2.0, fill);
    painter.rect_stroke(
        rect,
        2.0,
        Stroke::new(1.0_f32, Color32::from_rgb(123, 141, 109)),
        egui::StrokeKind::Inside,
    );
    if *checked {
        painter.add(egui::Shape::line(
            vec![
                center + Vec2::new(-4.0, 0.0),
                center + Vec2::new(-1.0, 3.0),
                center + Vec2::new(5.0, -4.0),
            ],
            Stroke::new(2.0_f32, COACH_INK),
        ));
    }
    painter.text(
        center + Vec2::new(23.0, 0.0),
        egui::Align2::LEFT_CENTER,
        text,
        FontId::proportional(14.0),
        ui.visuals().text_color(),
    );
}

pub fn primary(text: &str) -> egui::Button<'_> {
    egui::Button::new(RichText::new(text).color(INK).strong())
        .fill(Color32::from_rgb(78, 117, 43))
        .corner_radius(10)
}

pub fn accuracy(ui: &mut egui::Ui, score: u32, player: &str, caption: &str) {
    ui.vertical_centered(|ui| {
        let (area, _) = ui.allocate_exact_size(Vec2::splat(91.0), egui::Sense::hover());
        let center = area.center();
        let p = ui.painter_at(area);
        let color = if score >= 85 {
            ACCENT
        } else if score >= 65 {
            Color32::from_rgb(225, 192, 108)
        } else {
            Color32::from_rgb(239, 161, 139)
        };
        p.circle_stroke(
            center,
            39.0,
            Stroke::new(5.0_f32, Color32::from_rgb(64, 75, 56)),
        );
        let points = (0..=80)
            .map(|step| {
                let angle = std::f32::consts::TAU * step as f32 / 80.0 * score as f32 / 100.0
                    - std::f32::consts::FRAC_PI_2;
                center + Vec2::angled(angle) * 39.0
            })
            .collect::<Vec<Pos2>>();
        p.add(egui::Shape::line(points, Stroke::new(5.0_f32, color)));
        p.text(
            center,
            egui::Align2::CENTER_CENTER,
            format!("{score}%"),
            FontId::new(27.0, FontFamily::Name("ChessAsh bold".into())),
            ui.visuals().text_color(),
        );
        ui.strong(player);
        ui.small(caption);
    });
}
