use crate::insight::{
    AlternativeHelp, AlternativeKind, InsightKind, MoveInsight, alternative_help, capture_square,
    defenders, destination, find_insights, released_pin, valuable_attack,
};
use crate::sacrifice::material_gained;
use chessash_review_core::{
    Color, Game, Label, MoveReview, SacrificeOutcome, legal_uci, parse_fen,
};
use shakmaty::{
    Bitboard, CastlingMode, CastlingSide, Chess, File, Move, Position, Rank, Role, Square, attacks,
    uci::UciMove,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CoachingLanguage {
    #[default]
    English,
    Italian,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CoachingOptions {
    pub language: CoachingLanguage,
    pub player_color: Option<Color>,
}

#[derive(Clone, Debug, Default)]
pub struct Coaching {
    pub text: String,
    pub best: String,
    pub detail: String,
    pub hint: Option<String>,
    pub threat: Option<String>,
    pub targets: Vec<String>,
    pub played: String,
    pub alternative_reason: String,
    pub alternative_help: Option<AlternativeHelp>,
    pub insight: Option<MoveInsight>,
}

impl Coaching {
    pub fn annotation(&self) -> String {
        std::iter::once(self.text.as_str())
            .chain(self.detail.lines())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        format!("{}{rest}", first.to_uppercase(), rest = chars.as_str())
    })
}

fn piece_name(role: Role, italian: bool) -> &'static str {
    match (role, italian) {
        (Role::Pawn, false) => "pawn",
        (Role::Knight, false) => "knight",
        (Role::Bishop, false) => "bishop",
        (Role::Rook, false) => "rook",
        (Role::Queen, false) => "queen",
        (Role::King, false) => "king",
        (Role::Pawn, true) => "pedone",
        (Role::Knight, true) => "cavallo",
        (Role::Bishop, true) => "alfiere",
        (Role::Rook, true) => "torre",
        (Role::Queen, true) => "donna",
        (Role::King, true) => "re",
    }
}

fn actor(color: Color, options: CoachingOptions) -> &'static str {
    match (options.language, options.player_color) {
        (CoachingLanguage::English, Some(player)) if player == color => "You",
        (CoachingLanguage::English, Some(_)) => "Your opponent",
        (CoachingLanguage::English, None) if color == Color::White => "White",
        (CoachingLanguage::English, None) => "Black",
        (CoachingLanguage::Italian, Some(player)) if player == color => "Tu",
        (CoachingLanguage::Italian, Some(_)) => "Il tuo avversario",
        (CoachingLanguage::Italian, None) if color == Color::White => "Il Bianco",
        (CoachingLanguage::Italian, None) => "Il Nero",
    }
}

fn piece_at(role: Role, color: Color, square: Square, options: CoachingOptions) -> String {
    let own_piece = options.player_color == Some(color);
    let name = piece_name(role, options.language == CoachingLanguage::Italian);
    if options.language == CoachingLanguage::English {
        let owner = if own_piece {
            "your"
        } else if options.player_color.is_some() {
            "your opponent’s"
        } else if color == Color::White {
            "White’s"
        } else {
            "Black’s"
        };
        return format!("{owner} {name} on {square}");
    }
    let feminine = matches!(role, Role::Queen | Role::Rook);
    let article = if feminine { "la" } else { "il" };
    if own_piece {
        let possessive = if feminine { "tua" } else { "tuo" };
        return format!("{article} {possessive} {name} in {square}");
    }
    let noun = if role == Role::Bishop {
        format!("l’{name}")
    } else {
        format!("{article} {name}")
    };
    let owner = if options.player_color.is_some() {
        "del tuo avversario"
    } else {
        match (color, feminine) {
            (Color::White, true) => "bianca",
            (Color::White, false) => "bianco",
            (Color::Black, true) => "nera",
            (Color::Black, false) => "nero",
        }
    };
    format!("{noun} {owner} in {square}")
}

fn move_label(moved: Move, italian: bool) -> String {
    if let Some(side) = moved.castling_side() {
        return match (side.is_king_side(), italian) {
            (true, true) => "arrocco corto",
            (false, true) => "arrocco lungo",
            (true, false) => "castle kingside",
            (false, false) => "castle queenside",
        }
        .to_owned();
    }
    let role = piece_name(moved.role(), italian);
    let from = moved.from().expect("standard chess always has a source");
    let to = destination(moved);
    let promotion = moved.promotion().map_or_else(String::new, |piece| {
        format!(" = {}", piece_name(piece, italian))
    });
    format!("{role} {from} → {to}{promotion}")
}

fn brief_alternative(help: AlternativeHelp, italian: bool) -> String {
    match (help.kind, italian) {
        (AlternativeKind::PreservesDefense, true) => {
            return format!("Mantiene difeso il pezzo in {}.", help.square);
        }
        (AlternativeKind::PreservesDefense, false) => {
            return format!(
                "Keeps the {} on {} defended.",
                piece_name(help.role, false),
                help.square
            );
        }
        (AlternativeKind::Mate, false) => "Checkmate.",
        (AlternativeKind::Mate, true) => "Scacco matto.",
        (AlternativeKind::Stalemate, false) => "Draw by stalemate.",
        (AlternativeKind::Stalemate, true) => "Patta per stallo.",
        (AlternativeKind::RemovesAttacker, false) => "Removes the attacker.",
        (AlternativeKind::RemovesAttacker, true) => "Elimina il pezzo attaccante.",
        (AlternativeKind::EscapesCapture, false) => "Avoids an immediate capture.",
        (AlternativeKind::EscapesCapture, true) => "Evita una presa immediata.",
        (AlternativeKind::KeepsLineClosed, false) => "Keeps the line blocked.",
        (AlternativeKind::KeepsLineClosed, true) => "Mantiene la linea chiusa.",
        (AlternativeKind::AvoidsFork, false) => "Steps out of the fork.",
        (AlternativeKind::AvoidsFork, true) => "Esce dalla forchetta.",
        (AlternativeKind::AvoidsPin, false) => "Steps out of the pin.",
        (AlternativeKind::AvoidsPin, true) => "Esce dall’inchiodatura.",
        (AlternativeKind::AnswersCheck, false) => "Blocks the check.",
        (AlternativeKind::AnswersCheck, true) => "Blocca lo scacco.",
        (AlternativeKind::GivesCheck, false) => "Gives check.",
        (AlternativeKind::GivesCheck, true) => "Dà scacco.",
        (AlternativeKind::UnrecapturedCapture, false) => "No immediate recapture.",
        (AlternativeKind::UnrecapturedCapture, true) => "Nessuna ripresa immediata.",
    }
    .to_owned()
}

fn describing_play(fen: &Chess, moved: Move, italian: bool) -> String {
    let mut detail = move_label(moved, italian);
    if let Some(capture) = moved.capture() {
        let victim = piece_name(capture, italian);
        let square = capture_square(moved);
        if italian {
            detail.push_str(&format!(", con presa in {square} ({victim})"));
        } else {
            detail.push_str(&format!(", capturing the {victim} on {square}"));
        }
        if moved.is_en_passant() {
            detail.push_str(" en passant");
        }
    }
    if let Ok(after) = fen.clone().play(moved) {
        if after.is_checkmate() {
            detail.push_str(if italian {
                ", scacco matto"
            } else {
                ", delivering checkmate"
            });
        } else if after.is_check() {
            detail.push_str(if italian {
                ", scacco"
            } else {
                ", giving check"
            });
        }
    }
    detail
}

struct LineOutcome {
    material: i32,
    mate: Option<shakmaty::Color>,
    first_follow_up: Option<Move>,
    promotion: Option<Square>,
    captures: [Vec<Move>; 2],
}

fn line_outcome(before: &Chess, moved: Move, replies: &[String]) -> Option<LineOutcome> {
    let mut position = before.clone();
    let side = position.turn();
    let mut material = 0;
    let mut ply = 0;
    let mut next = Some(moved);
    let mut replies = replies.iter().take(16);
    let mut first_follow_up = None;
    let mut promotion = None;
    let mut captures = [Vec::new(), Vec::new()];
    while let Some(played) = next {
        if played.is_capture() {
            captures[usize::from(position.turn() != side)].push(played);
        }
        if position.turn() == side {
            if ply == 2 {
                first_follow_up = Some(played);
            }
            if played.promotion().is_some() && promotion.is_none() {
                promotion = Some(destination(played));
            }
        }
        material += material_gained(played) * if position.turn() == side { 1 } else { -1 };
        ply += 1;
        position.play_unchecked(played);
        next = match replies.next() {
            Some(uci) => Some(legal_uci(&position, uci)?),
            None => None,
        };
        if next.is_none()
            && (position.is_check() && !position.is_checkmate()
                || position
                    .capture_moves()
                    .iter()
                    .any(|capture| capture.to() == destination(played)))
        {
            material = 0;
        }
    }
    Some(LineOutcome {
        material,
        mate: position.is_checkmate().then(|| !position.turn()),
        first_follow_up,
        promotion,
        captures,
    })
}

fn capture_reason(
    moved: Move,
    color: shakmaty::Color,
    conditional: bool,
    options: CoachingOptions,
) -> Option<String> {
    let victim = piece_at(
        moved.capture()?,
        (!color).into(),
        capture_square(moved),
        options,
    );
    let from = moved.from()?;
    let italian = options.language == CoachingLanguage::Italian;
    let piece = piece_name(moved.role(), italian);
    let who = actor(color.into(), options);
    let personal = options.player_color == Some(color.into());
    if italian {
        let subject = match who {
            "Tu" => "",
            "Il Bianco" if conditional => "il Bianco ",
            "Il Nero" if conditional => "il Nero ",
            "Il tuo avversario" if conditional => "il tuo avversario ",
            "Il Bianco" => "Il Bianco ",
            "Il Nero" => "Il Nero ",
            _ => "Il tuo avversario ",
        };
        let intro = if conditional { "Nella variante, " } else { "" };
        let verb = if personal && !conditional {
            "Prendi"
        } else if personal {
            "prendi"
        } else {
            "prende"
        };
        let article = if matches!(moved.role(), Role::Rook | Role::Queen) {
            "la "
        } else if moved.role() == Role::Bishop {
            "l’"
        } else {
            "il "
        };
        return Some(format!(
            "{intro}{subject}{verb} {victim} con {article}{piece} da {from}."
        ));
    }
    let intro = if conditional {
        "In the checked line, "
    } else {
        ""
    };
    let subject = match (conditional, who) {
        (true, "You") => "you",
        (true, "Your opponent") => "your opponent",
        _ => who,
    };
    let verb = if personal { "take" } else { "takes" };
    Some(format!(
        "{intro}{subject} {verb} {victim} with the {piece} from {from}."
    ))
}

fn line_capture(
    line: Option<&LineOutcome>,
    gain: i32,
    color: shakmaty::Color,
    options: CoachingOptions,
) -> Option<String> {
    let captures = &line?.captures;
    let winning = usize::from(gain < 0);
    let capture = captures[winning]
        .iter()
        .copied()
        .filter(|candidate| {
            let victim = candidate.capture();
            let count = |side: usize| {
                captures[side]
                    .iter()
                    .filter(|played| played.capture() == victim)
                    .count()
            };
            count(winning) > count(1 - winning)
        })
        .max_by_key(|played| material_gained(*played))?;
    capture_reason(
        capture,
        if gain > 0 { color } else { !color },
        true,
        options,
    )
}

fn profitable_capture(after: &Chess, moved: Move, options: CoachingOptions) -> Option<String> {
    let taken = moved.capture()?;
    let to = destination(moved);
    let recapture = after
        .capture_moves()
        .into_iter()
        .find(|reply| capture_square(*reply) == to);
    if recapture.is_some_and(|reply| material_gained(reply) >= material_gained(moved)) {
        return None;
    }
    let mut text = capture_reason(moved, !after.turn(), false, options)?;
    if recapture.is_some() {
        let italian = options.language == CoachingLanguage::Italian;
        let victim = piece_name(taken, italian);
        let piece = piece_name(moved.promotion().unwrap_or(moved.role()), italian);
        let trade = if italian {
            format!(
                " Anche con una ripresa in {to}, lo scambio di {piece} per {victim} conviene a chi ha mosso."
            )
        } else {
            format!(" A recapture on {to} still trades the {victim} for the {piece}.")
        };
        text.push_str(&trade);
    }
    Some(text)
}

fn capture_threat(
    position: &Chess,
    reply: Move,
    line: Option<&LineOutcome>,
    options: CoachingOptions,
) -> Option<(String, String)> {
    let from = reply.from()?;
    let to = destination(reply);
    let enemy = !position.turn();
    let taken = piece_at(
        reply.capture()?,
        position.turn().into(),
        capture_square(reply),
        options,
    );
    profitable_capture(position, reply, options)?;
    let target = valuable_attack(position, to, enemy)?;
    let threatened = piece_at(
        target.piece.role,
        target.piece.color.into(),
        target.square,
        options,
    );
    let italian = options.language == CoachingLanguage::Italian;
    let piece = piece_name(reply.role(), italian);
    let who = actor(enemy.into(), options);
    let text = match (italian, who) {
        (false, _) => {
            format!("{who} can take {taken} with the {piece} from {from}, attacking {threatened}.")
        }
        (true, "Tu") => format!("Da {from} puoi prendere {taken} e attaccare {threatened}."),
        (true, _) => format!("{who} può prendere {taken} da {from} e attaccare {threatened}."),
    };
    let eventual_capture = line.is_some_and(|line| {
        line.captures[1].iter().any(|capture| {
            capture.from() == Some(to)
                && capture_square(*capture) == target.square
                && capture.role() == reply.role()
        })
    });
    let square = target.square;
    let detail = match (italian, eventual_capture) {
        (false, true) => {
            format!("In the analysed line, the {piece} goes on to take {threatened} from {to}.")
        }
        (true, true) => {
            format!("Nella variante, il pezzo da {to} finisce per prendere {threatened}.")
        }
        (false, false) => {
            format!("From {to}, the {piece} can take on {square} if the piece stays there.")
        }
        (true, false) => format!("Da {to}, il pezzo minaccia una presa in {square}."),
    };
    Some((text, detail))
}

fn blocks_capture(
    played_board: &Chess,
    best_board: &Chess,
    best: Move,
    reply: Move,
    italian: bool,
) -> Option<(String, String)> {
    let from = reply.from()?;
    let victim = capture_square(reply);
    let blocker = destination(best);
    if !reply.is_capture()
        || !matches!(reply.role(), Role::Bishop | Role::Rook | Role::Queen)
        || !attacks::between(from, victim).contains(blocker)
        || played_board.board().piece_at(from) != best_board.board().piece_at(from)
        || played_board.board().piece_at(victim) != best_board.board().piece_at(victim)
    {
        return None;
    }
    let role = piece_name(reply.role(), italian);
    Some(if italian {
        (
            format!("Chiude la linea verso {victim}."),
            format!(
                "In {blocker}, il pezzo blocca la linea da {from} verso {victim} e impedisce quella presa."
            ),
        )
    } else {
        (
            format!("Blocks the {role}’s route to {victim}."),
            format!(
                "On {blocker}, the piece cuts off the {role} on {from} from {victim}, preventing that capture."
            ),
        )
    })
}

fn pawn_challenge_detail(board: &Chess, moved: Move, italian: bool) -> Option<String> {
    if moved.role() != Role::Pawn {
        return None;
    }
    let to = destination(moved);
    let from = board.capture_moves().into_iter().find_map(|reply| {
        let from = reply.from()?;
        (reply.role() == Role::Pawn
            && capture_square(reply) == to
            && Bitboard::CENTER.contains(from))
        .then_some(from)
    })?;
    Some(if italian {
        format!("Se l’altro pedone prende in {to}, deve lasciare la casa centrale {from}.")
    } else {
        format!("To take on {to}, the other pawn would have to leave its central square on {from}.")
    })
}

fn unpin_reason(
    before: &Chess,
    after: &Chess,
    moved: Move,
    options: CoachingOptions,
) -> Option<(String, String)> {
    let (attacker, freed) = released_pin(before, after, moved)?;
    let king = before.board().king_of(before.turn())?;
    let from = attacker.square;
    let square = freed.square;
    let to = destination(moved);
    let blocker = piece_at(moved.role(), before.turn().into(), to, options);
    let italian = options.language == CoachingLanguage::Italian;
    let role = piece_name(freed.piece.role, italian);
    let rescued = piece_at(freed.piece.role, freed.piece.color.into(), square, options);
    let defenses = moved.role() != Role::King && defenders(after.board(), square).contains(to);
    let text = match (italian, defenses) {
        (false, true) => format!(
            "{} breaks the pin and defends the {role} on {square}.",
            capitalized(&blocker)
        ),
        (false, false) => format!("{} frees {rescued} from the pin.", capitalized(&blocker)),
        (true, true) => format!(
            "{} libera {rescued} dall’inchiodatura e lo difende.",
            capitalized(&blocker)
        ),
        (true, false) => format!(
            "{} libera {rescued} dall’inchiodatura.",
            capitalized(&blocker)
        ),
    };
    let detail = if italian {
        format!(
            "Prima della mossa, spostare il pezzo da {square} avrebbe esposto il re in {king} all’attacco da {from}."
        )
    } else {
        format!(
            "Before the move, leaving {square} would expose the king on {king} to the attack from {from}."
        )
    };
    Some((text, detail))
}

fn remaining_move_effect(
    before: &Chess,
    after: &Chess,
    moved: Move,
    options: CoachingOptions,
    loses_chances: bool,
) -> String {
    if let Some(reason) = capture_reason(moved, before.turn(), false, options) {
        return reason;
    }
    let italian = options.language == CoachingLanguage::Italian;
    let side = before.turn();
    let to = destination(moved);
    let mover = piece_at(moved.role(), side.into(), to, options);
    if let Some(checker) = after.checkers().first()
        && let Some(piece) = after.board().piece_at(checker)
    {
        let attacker = piece_at(piece.role, side.into(), checker, options);
        return if italian {
            format!(
                "{} dà scacco e costringe a rispondere.",
                capitalized(&attacker)
            )
        } else {
            format!(
                "{} gives check, so the other side has to respond.",
                capitalized(&attacker)
            )
        };
    }
    let attacks = after.board().attacks_from(to);
    let controlled = attacks & !after.board().by_color(side);
    let from = moved
        .from()
        .map(|square| before.board().attacks_from(square))
        .unwrap_or_default();
    if loses_chances && let Some(square) = (from & !attacks & Bitboard::CENTER).first() {
        return if italian {
            format!("Da {to}, il pezzo non controlla più la casa centrale {square}.")
        } else {
            format!(
                "{} no longer covers the central square {square}.",
                capitalized(&mover)
            )
        };
    }
    let vacated = moved.from().map_or(Bitboard::EMPTY, Bitboard::from_square);
    let gained = controlled & !from & !vacated;
    let target = (gained & Bitboard::CENTER)
        .first()
        .or_else(|| (gained & after.board().by_color(!side)).first())
        .or_else(|| gained.first())
        .or_else(|| controlled.first());
    if let Some(square) = target {
        if let Some(piece) = after.board().piece_at(square) {
            let target = piece_at(piece.role, piece.color.into(), square, options);
            return if italian {
                format!("{} attacca {target}.", capitalized(&mover))
            } else {
                format!("{} puts pressure on {target}.", capitalized(&mover))
            };
        }
        return if italian {
            format!("{} ora controlla {square}.", capitalized(&mover))
        } else {
            format!("{} now covers {square}.", capitalized(&mover))
        };
    }
    let played = move_label(moved, italian);
    if italian {
        format!("Mossa giocata: {played}.")
    } else {
        format!("Played {played}.")
    }
}

fn quiet_reason(
    before: &Chess,
    after: &Chess,
    moved: Move,
    options: CoachingOptions,
    brief: bool,
) -> Option<String> {
    if moved.is_capture() {
        return None;
    }
    let side = before.turn();
    let player = options.player_color == Some(side.into());
    let who = actor(side.into(), options);
    let italian = options.language == CoachingLanguage::Italian;
    let from = moved.from()?;
    let to = destination(moved);
    let new_control =
        after.board().attacks_from(to) & !before.board().attacks_from(from) & Bitboard::CENTER;
    let own_pawns = after.board().by_piece(side.pawn());
    let enemy_pawns = after.board().by_piece((!side).pawn());
    if moved.role() == Role::Pawn {
        if Bitboard::CENTER.contains(to)
            && let Some(blocked) = to
                .rank()
                .offset(if side.is_white() { 1 } else { -1 })
                .map(|rank| Square::from_coords(to.file(), rank))
            && enemy_pawns.contains(blocked)
        {
            let pawn = piece_at(Role::Pawn, (!side).into(), blocked, options);
            return Some(match (italian, player) {
                (false, true) => {
                    format!("You contest the center with {to}, stopping {pawn} from advancing.")
                }
                (false, false) => {
                    format!("{who} contests the center with {to}, stopping {pawn} from advancing.")
                }
                (true, true) => {
                    format!("Contesti il centro con {to} e blocchi l’avanzata de{pawn}.")
                }
                (true, false) => {
                    format!("{who} contesta il centro con {to} e blocca l’avanzata de{pawn}.")
                }
            });
        }
        let bishop = (before.board().by_piece(side.bishop())
            & Bitboard::from_rank(side.relative_rank(Rank::First)))
        .into_iter()
        .find(|&bishop| {
            (after.board().attacks_from(bishop)
                & !before.board().attacks_from(bishop)
                & !after.board().occupied())
            .into_iter()
            .any(|square| attacks::between(bishop, square).contains(from))
        });
        let support = (new_control & own_pawns).first();
        if let Some(square) = support {
            let pawn = piece_at(Role::Pawn, side.into(), square, options);
            let mut text = match (italian, player) {
                (false, true) => format!("You reinforce {pawn}"),
                (false, false) => format!("{who} reinforces {pawn}"),
                (true, true) => format!("Sostieni {pawn}"),
                (true, false) => format!("{who} sostiene {pawn}"),
            };
            if let Some(bishop) = bishop {
                let bishop = piece_at(Role::Bishop, side.into(), bishop, options);
                text.push_str(&match (italian, player) {
                    (false, true) => format!(" and open a diagonal for {bishop}"),
                    (false, false) => format!(" and opens a diagonal for {bishop}"),
                    (true, true) => format!(" e apri una diagonale per {bishop}"),
                    (true, false) => format!(" e apre una diagonale per {bishop}"),
                });
            }
            text.push('.');
            return Some(text);
        }
        if let Some(bishop) = bishop {
            let bishop = piece_at(Role::Bishop, side.into(), bishop, options);
            return Some(match (italian, player) {
                (false, true) => format!("You open a diagonal for {bishop}."),
                (false, false) => format!("{who} opens a diagonal for {bishop}."),
                (true, true) => format!("Apri una diagonale per {bishop}."),
                (true, false) => format!("{who} apre una diagonale per {bishop}."),
            });
        }
    }
    if !matches!(moved.role(), Role::Knight | Role::Bishop)
        || side.relative_rank(from.rank()) != Rank::First
        || side.relative_rank(to.rank()) == Rank::First
    {
        return None;
    }
    let role = piece_name(moved.role(), italian);
    if matches!(from.file(), File::F | File::G) && after.castles().has(side, CastlingSide::KingSide)
    {
        if brief {
            return Some(if italian {
                format!("Libera {from} per l’arrocco.")
            } else {
                format!("Clears {from} for castling.")
            });
        }
        let article = if moved.role() == Role::Bishop {
            "l’"
        } else {
            "il "
        };
        return Some(match (italian, player) {
            (false, true) => format!("You develop the {role} and clear {from} for castling."),
            (false, false) => format!("{who} develops the {role} and clears {from} for castling."),
            (true, true) => format!("Sviluppi {article}{role} e liberi {from} per l’arrocco."),
            (true, false) => {
                format!("{who} sviluppa {article}{role} e libera {from} per l’arrocco.")
            }
        });
    }
    let square = new_control.first()?;
    let piece = piece_at(moved.role(), side.into(), to, options);
    Some(match (italian, player) {
        (false, true) => format!("You develop {piece} and gain control of {square} in the center."),
        (false, false) => {
            format!("{who} develops {piece} and gains control of {square} in the center.")
        }
        (true, true) => format!("Sviluppi {piece} e controlli la casa centrale {square}."),
        (true, false) => format!("{who} sviluppa {piece} e controlla la casa centrale {square}."),
    })
}

fn queen_tempo(
    after: &Chess,
    moved: Move,
    reply: Move,
    options: CoachingOptions,
) -> Option<String> {
    let side = after.turn();
    let from = reply.from()?;
    let to = destination(reply);
    let target = destination(moved);
    if moved.role() != Role::Queen
        || reply.is_capture()
        || !matches!(reply.role(), Role::Knight | Role::Bishop)
        || side.relative_rank(from.rank()) != Rank::First
        || side.relative_rank(to.rank()) == Rank::First
    {
        return None;
    }
    let next = after.clone().play(reply).ok()?;
    if !next.board().attacks_from(to).contains(target) {
        return None;
    }
    let piece = piece_name(reply.role(), options.language == CoachingLanguage::Italian);
    let queen = piece_at(Role::Queen, (!side).into(), target, options);
    let who = actor(side.into(), options);
    Some(match (options.language, who) {
        (CoachingLanguage::English, _) => {
            format!("{who} can develop the {piece} to {to} and attack {queen} in the same move.")
        }
        (CoachingLanguage::Italian, "Tu") => format!(
            "Puoi sviluppare il pezzo da {from} a {to} e attaccare {queen} con la stessa mossa."
        ),
        (CoachingLanguage::Italian, _) => format!(
            "{who} può sviluppare il pezzo da {from} a {to} e attaccare {queen} con la stessa mossa."
        ),
    })
}

fn central_pawn_reason(
    after: &Chess,
    moved: Move,
    options: CoachingOptions,
    brief: bool,
) -> Option<(Square, String)> {
    let to = destination(moved);
    if moved.role() != Role::Pawn || moved.is_capture() {
        return None;
    }
    let victim = (after.board().attacks_from(to)
        & Bitboard::CENTER
        & after.board().pawns()
        & after.board().by_color(after.turn()))
    .first()?;
    let target = piece_at(Role::Pawn, Color::from(after.turn()), victim, options);
    if brief {
        let text = if options.language == CoachingLanguage::Italian {
            format!("Attacca {target}.")
        } else {
            format!("Challenges {target}.")
        };
        return Some((victim, text));
    }
    let mover = actor(Color::from(!after.turn()), options);
    let text = match options.language {
        CoachingLanguage::English if mover == "You" => {
            format!("You challenge {target} by putting a pawn on {to}.")
        }
        CoachingLanguage::English => {
            format!("{mover} challenges {target} by putting a pawn on {to}.")
        }
        CoachingLanguage::Italian if mover == "Tu" => {
            format!("Contesti il centro da {to}, attaccando {target}.")
        }
        CoachingLanguage::Italian => {
            format!("{mover} contesta il centro da {to}, attaccando {target}.")
        }
    };
    Some((victim, text))
}

fn supports_pawn_push(
    before: &Chess,
    after: &Chess,
    moved: Move,
    line: &LineOutcome,
    options: CoachingOptions,
) -> Option<(Square, String)> {
    let push = line
        .first_follow_up
        .filter(|push| push.role() == Role::Pawn && !push.is_capture())?;
    let from = push.from()?;
    let advance = destination(push);
    let anchor = destination(moved);
    let old_anchor = moved.from()?;
    if !after.board().attacks_from(anchor).contains(advance)
        || before.board().attacks_from(old_anchor).contains(advance)
        || before.board().piece_at(from) != Some(before.turn().pawn())
    {
        return None;
    }
    let prospective_piece = after.board().piece_at(anchor)?;
    let guard = piece_at(
        prospective_piece.role,
        before.turn().into(),
        anchor,
        options,
    );
    let pawn = piece_at(Role::Pawn, before.turn().into(), from, options);
    let mut text = match options.language {
        CoachingLanguage::English => {
            format!("{guard} covers {advance}, supporting the advance of {pawn}.")
        }
        CoachingLanguage::Italian => {
            format!("{guard} controlla {advance} e sostiene l’avanzata di {pawn}.")
        }
    };
    if let Some(square) = line
        .promotion
        .filter(|square| square.file() == advance.file())
    {
        let promotion = match options.language {
            CoachingLanguage::English => {
                format!(" In the engine’s line, the pawn promotes on {square}.")
            }
            CoachingLanguage::Italian => {
                format!(" Nella variante del motore, il pedone promuove in {square}.")
            }
        };
        text.push_str(&promotion);
    }
    if let Some(first) = text.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    Some((advance, text))
}

fn only_legal_move(
    game: &Game,
    result: &MoveReview,
    before: &Chess,
    options: CoachingOptions,
) -> String {
    let italian = options.language == CoachingLanguage::Italian;
    if let Some(cause) = result.consequence_of.filter(|&ply| ply < result.ply)
        && let Some(index) = cause.checked_sub(1)
        && let Some(san) = game.moves.get(index)
        && let Some(fen) = game.positions.get(index)
    {
        let mut fields = fen.split_whitespace();
        let side = fields.nth(1).unwrap_or("w");
        let number = fields.nth(3).unwrap_or("1");
        let dots = if side == "b" { "…" } else { "." };
        return if italian {
            format!(
                "Questa è l’unica mossa legale. La variante di matto forzato è iniziata con {number}{dots} {san}."
            )
        } else {
            format!(
                "This is the only legal move. The forced mate started with {number}{dots} {san}."
            )
        };
    }
    if let Some(square) = before.checkers().single_square()
        && let Some(checker) = before.board().piece_at(square)
    {
        let attacker = piece_at(checker.role, checker.color.into(), square, options);
        return if italian {
            format!("È l’unica risposta legale allo scacco da {square}.")
        } else {
            format!("This is the only legal answer to the check from {attacker}.")
        };
    }
    if italian {
        "Questa era l’unica mossa legale."
    } else {
        "This was the only legal move."
    }
    .to_owned()
}

pub fn review_coaching(game: &Game, result: &MoveReview, options: CoachingOptions) -> Coaching {
    let Some(before) = result
        .ply
        .checked_sub(1)
        .and_then(|index| game.positions.get(index))
        .and_then(|fen| parse_fen(fen).ok())
    else {
        return Coaching::default();
    };
    let Some(moved) = legal_uci(&before, &result.r#move) else {
        return Coaching::default();
    };
    let Ok(after) = before.clone().play(moved) else {
        return Coaching::default();
    };
    let italian = options.language == CoachingLanguage::Italian;
    let local = |en: &str, it: &str| {
        if italian {
            it.to_owned()
        } else {
            en.to_owned()
        }
    };
    let best = legal_uci(&before, &result.best);
    let same = best == Some(moved);
    let central_pawn = central_pawn_reason(&after, moved, options, false);
    let quiet = quiet_reason(&before, &after, moved, options, false);
    let forced = before.legal_moves().len() == 1;
    let loses_chances = !same
        && !forced
        && (result.loss >= 45
            || matches!(
                result.label,
                Label::Inaccuracy | Label::Mistake | Label::Blunder | Label::Miss
            ));
    let replies = result.reply_pv.as_deref().unwrap_or_default();
    let response = replies.first().and_then(|uci| legal_uci(&after, uci));
    let response_board = response.and_then(|reply| after.clone().play(reply).ok());
    let tempo = loses_chances
        .then(|| {
            let actual = game
                .uci_moves
                .get(result.ply)
                .and_then(|uci| legal_uci(&after, uci));
            [response, actual].into_iter().flatten().find_map(|reply| {
                queen_tempo(&after, moved, reply, options).map(|reason| (reply, reason))
            })
        })
        .flatten();
    let threat = replies
        .first()
        .filter(|_| {
            response.is_some_and(Move::is_capture)
                || response_board.as_ref().is_some_and(Position::is_check)
        })
        .cloned()
        .or_else(|| {
            tempo
                .as_ref()
                .map(|(reply, _)| UciMove::from_move(*reply, CastlingMode::Standard).to_string())
        });
    let insight = loses_chances
        .then(|| find_insights(&before, moved, replies))
        .and_then(|insights| insights.into_iter().next());
    let help = if loses_chances {
        best.and_then(|best| alternative_help(&before, moved, best, insight.as_ref()))
    } else {
        None
    };
    let played_line = line_outcome(&before, moved, replies);
    let reply_capture = loses_chances
        .then(|| {
            let reply = response?;
            capture_threat(
                response_board.as_ref()?,
                reply,
                played_line.as_ref(),
                options,
            )
        })
        .flatten();
    let unpin = (!loses_chances)
        .then(|| unpin_reason(&before, &after, moved, options))
        .flatten();
    let best_board = best.and_then(|candidate| before.clone().play(candidate).ok());
    let blocking_reply = reply_capture
        .as_ref()
        .and_then(|_| blocks_capture(&after, best_board.as_ref()?, best?, response?, italian));
    let best_line = best
        .filter(|_| result.pv.first() == Some(&result.best))
        .and_then(|played| line_outcome(&before, played, &result.pv[1..]));
    let played_gain = played_line.as_ref().map_or(0, |line| line.material);
    let best_gain = best_line.as_ref().map_or(0, |line| line.material);
    let best_mates = best_line
        .as_ref()
        .is_some_and(|line| line.mate == Some(before.turn()));
    let played_mates = played_line
        .as_ref()
        .is_some_and(|line| line.mate == Some(before.turn()));
    let pawn_push = played_line
        .as_ref()
        .and_then(|line| supports_pawn_push(&before, &after, moved, line, options));
    let played_capture = (!loses_chances)
        .then(|| profitable_capture(&after, moved, options))
        .flatten();
    let gained_capture = (played_gain != 0)
        .then(|| line_capture(played_line.as_ref(), played_gain, before.turn(), options))
        .flatten();
    let best_capture = (best_gain > 0 && best_gain > played_gain)
        .then(|| line_capture(best_line.as_ref(), best_gain, before.turn(), options))
        .flatten();
    let best_positional = best.filter(|_| !same).and_then(|best| {
        let position = before.clone().play(best).ok()?;
        central_pawn_reason(&position, best, options, true)
            .map(|(_, text)| text)
            .or_else(|| quiet_reason(&before, &position, best, options, true))
    });
    let alternative_reason = help.map_or_else(
        || {
            if !same && best_mates && !played_mates {
                local(
                    "The engine’s line leads to checkmate.",
                    "La variante del motore porta allo scacco matto.",
                )
            } else {
                best_positional
                    .clone()
                    .or_else(|| (!same).then(|| best_capture.clone()).flatten())
                    .unwrap_or_default()
            }
        },
        |help| match help.kind {
            AlternativeKind::Mate => local(
                "The alternative delivers checkmate.",
                "La mossa suggerita dà scacco matto.",
            ),
            AlternativeKind::Stalemate => local(
                "The alternative draws by stalemate.",
                "La mossa suggerita ottiene la patta per stallo.",
            ),
            AlternativeKind::RemovesAttacker => {
                let attacker = piece_at(help.role, (!before.turn()).into(), help.square, options);
                if italian { format!("La mossa suggerita cattura {attacker} e ferma la minaccia.") }
                else { format!("The alternative captures {attacker} before the threat lands.") }
            }
            AlternativeKind::PreservesDefense => {
                let defended = piece_at(help.role, before.turn().into(), help.square, options);
                if italian {
                    format!("La mossa suggerita continua a difendere {defended}.")
                } else {
                    format!("The alternative keeps {defended} defended.")
                }
            }
            AlternativeKind::EscapesCapture => {
                let rescued = piece_at(help.role, before.turn().into(), help.square, options);
                if italian { format!("L’avversario non può prendere subito {rescued}.") }
                else { format!("There is no immediate legal capture of {rescued}.") }
            }
            AlternativeKind::KeepsLineClosed => {
                let blocker = piece_at(help.role, before.turn().into(), help.square, options);
                let target = insight.as_ref().map(|insight| insight.targets[0]);
                if let Some(target) = target {
                    let victim = piece_at(target.piece.role, target.piece.color.into(), target.square, options);
                    if italian { format!("La mossa suggerita lascia {blocker} a bloccare l’attacco verso {victim}.") }
                    else { format!("The alternative leaves {blocker} blocking the line to {victim}.") }
                } else {
                    local("The piece stays on the line and blocks the attack.", "Il pezzo resta sulla linea e blocca l’attacco.")
                }
            }
            AlternativeKind::AvoidsFork => {
                let square = help.square;
                if let Some(insight) = &insight {
                    let reply = &insight.reply;
                    if italian { format!("In {square}, il pezzo sfugge alla forchetta di {reply}.") }
                    else { format!("On {square}, the piece is out of reach of the fork from {reply}.") }
                } else {
                    local("The piece steps out of the fork.", "Il pezzo esce dalla forchetta.")
                }
            }
            AlternativeKind::AvoidsPin => {
                let square = help.square;
                if let Some(insight) = &insight {
                    let target = insight.targets[0];
                    let victim = piece_at(target.piece.role, target.piece.color.into(), target.square, options);
                    if italian { format!("Con il re in {square}, {victim} non è più inchiodato.") }
                    else { format!("The king steps off the line to {square}, freeing {victim} from the pin.") }
                } else {
                    local("The king steps off the line of the pin.", "Il re esce dalla linea dell’inchiodatura.")
                }
            }
            AlternativeKind::AnswersCheck => local(
                "The alternative blocks the check.",
                "La mossa suggerita blocca lo scacco.",
            ),
            AlternativeKind::GivesCheck => local(
                "The alternative gives check, so the king’s side has to respond first.",
                "La mossa suggerita dà scacco e obbliga a rispondere subito.",
            ),
            AlternativeKind::UnrecapturedCapture => {
                let taken = piece_at(help.role, (!before.turn()).into(), help.square, options);
                if italian { format!("La mossa prende {taken} senza consentire una ripresa immediata.") }
                else { format!("The move captures {taken} without allowing an immediate recapture.") }
            }
        },
    );
    let mover = actor(result.color, options);
    let personal = options.player_color == Some(result.color);
    let played = describing_play(&before, moved, italian);
    let mut hints = None;
    let mut lesson = None;
    let text = if after.is_checkmate() {
        if italian && personal {
            "Hai dato scacco matto. Il re non ha vie di fuga.".to_owned()
        } else if italian {
            format!("{mover} ha dato scacco matto. Il re non ha vie di fuga.")
        } else {
            format!("{mover} delivered checkmate. The king has no escape.")
        }
    } else if after.is_stalemate() {
        local(
            "This is stalemate: the king is safe, but there are no legal moves. The game is a draw.",
            "È stallo: il re non è sotto scacco, ma non ci sono mosse legali. La partita è patta.",
        )
    } else if forced {
        only_legal_move(game, result, &before, options)
    } else if !same && best_board.as_ref().is_some_and(Position::is_checkmate) {
        if italian && personal {
            "Hai mancato uno scacco matto immediato.".to_owned()
        } else if italian {
            format!("{mover} ha mancato uno scacco matto immediato.")
        } else {
            format!("{mover} missed an immediate checkmate.")
        }
    } else if let Some((summary, detail)) = &reply_capture {
        lesson = Some(detail.clone());
        summary.clone()
    } else if let Some(insight) = &insight {
        let (summary, detail, hint) = explain_insight(insight, moved, options, result.ply % 3);
        hints = Some(hint);
        lesson = Some(detail);
        summary
    } else if played_line
        .as_ref()
        .is_some_and(|line| line.mate == Some(after.turn()))
    {
        match (italian, personal) {
            (true, true) => {
                "Con questa mossa permetti uno scacco matto nella variante analizzata.".to_owned()
            }
            (true, false) => {
                format!("{mover} permette uno scacco matto nella variante analizzata.")
            }
            (false, true) => "Your move allows checkmate in the engine’s line.".to_owned(),
            (false, false) => format!("{mover} allows checkmate in the engine’s line."),
        }
    } else if loses_chances
        && played_gain < 0
        && let Some(reason) = &gained_capture
    {
        reason.clone()
    } else if let Some((_, reason)) = &tempo {
        reason.clone()
    } else if loses_chances
        && let Some(reply) = response
        && response_board
            .as_ref()
            .is_some_and(|board| profitable_capture(board, reply, options).is_some())
        && let Some(reason) = capture_reason(reply, after.turn(), true, options)
    {
        reason
    } else if best_mates && loses_chances && !played_mates {
        if italian && personal {
            "Hai perso una continuazione che portava al matto.".to_owned()
        } else if italian {
            format!("{mover} ha perso una continuazione che portava al matto.")
        } else {
            format!("{mover} missed a line that leads to checkmate.")
        }
    } else if let Some(reason) = &played_capture {
        reason.clone()
    } else if result.label == Label::Sacrifice
        && let Some(evidence) = &result.sacrifice_evidence
        && evidence.outcome != SacrificeOutcome::Compensation
    {
        let square = &evidence.square;
        let stalemate = evidence.outcome == SacrificeOutcome::Stalemate;
        match (stalemate, italian) {
            (true, false) => format!(
                "Taking the piece on {square} leads to stalemate, so the sacrifice saves a draw."
            ),
            (true, true) => {
                format!("Prendere il pezzo in {square} porta allo stallo e salva la patta.")
            }
            (false, false) => {
                format!("Taking the piece on {square} leaves insufficient material to mate.")
            }
            (false, true) => format!(
                "Prendere il pezzo in {square} lascia materiale insufficiente per dare matto."
            ),
        }
    } else if let Some((_, reason)) = &pawn_push {
        reason.clone()
    } else if let Some((summary, detail)) = &unpin {
        lesson = Some(detail.clone());
        summary.clone()
    } else if !loses_chances && played_mates {
        if italian && personal {
            "Hai trovato una continuazione che porta allo scacco matto.".to_owned()
        } else if italian {
            format!("{mover} ha trovato una continuazione che porta allo scacco matto.")
        } else {
            format!("{mover} found a line that leads to checkmate.")
        }
    } else if !loses_chances && let Some((_, reason)) = &central_pawn {
        reason.clone()
    } else if !loses_chances && let Some(reason) = &quiet {
        reason.clone()
    } else if !loses_chances
        && played_gain > 0
        && let Some(reason) = &gained_capture
    {
        reason.clone()
    } else if !loses_chances && moved.is_castle() {
        match (italian, personal) {
            (true, true) => {
                "Con l’arrocco porti il re fuori dal centro e avvicini la torre al gioco."
                    .to_owned()
            }
            (true, false) => {
                format!("{mover} arrocca per spostare il re fuori dal centro e attivare la torre.")
            }
            (false, true) => {
                "You bring your king out of the center and put your rook into play.".to_owned()
            }
            (false, false) => {
                format!("{mover} brings the king out of the center and puts the rook into play.")
            }
        }
    } else {
        remaining_move_effect(&before, &after, moved, options, loses_chances)
    };
    let mut detail = Vec::new();
    if let Some(lesson) = lesson.filter(|lesson| !lesson.is_empty()) {
        detail.push(lesson);
    }
    if let Some(best) = best.filter(|_| !same) {
        if let Some((_, full)) = &blocking_reply {
            detail.push(full.clone());
        } else if !alternative_reason.is_empty() && (help.is_some() || best_positional.is_none()) {
            detail.push(alternative_reason.clone());
        } else if let Some(board) = &best_board
            && let Some(reason) = pawn_challenge_detail(board, best, italian)
        {
            detail.push(reason);
        } else if best.is_capture() && alternative_reason.is_empty() {
            let headline = if italian {
                "Mossa migliore"
            } else {
                "Best move"
            };
            let alternative = describing_play(&before, best, italian);
            detail.push(format!("{headline} {alternative}."));
        }
    }
    let best_text = best.filter(|_| !same).map_or_else(String::new, |best| {
        let title = if italian {
            "Mossa migliore"
        } else {
            "Best move"
        };
        let label = move_label(best, italian);
        let reason = if let Some((brief, _)) = &blocking_reply {
            format!(" {brief}")
        } else if let Some(help) = help {
            format!(" {}", brief_alternative(help, italian))
        } else if best_positional.as_ref() == Some(&alternative_reason)
            && alternative_reason.chars().count() <= 54
        {
            format!(" {alternative_reason}")
        } else {
            String::new()
        };
        format!("{title}: {label}.{reason}")
    });
    let targets = insight.as_ref().map_or_else(
        || {
            pawn_push
                .as_ref()
                .or(central_pawn.as_ref().filter(|_| !loses_chances))
                .map(|(square, _)| square.to_string())
                .into_iter()
                .collect()
        },
        |insight| {
            insight
                .targets
                .iter()
                .map(|target| target.square.to_string())
                .collect()
        },
    );
    Coaching {
        text,
        best: best_text,
        detail: detail.join("\n"),
        hint: hints,
        threat,
        targets,
        played,
        alternative_reason: blocking_reply.map_or(alternative_reason, |(_, detail)| detail),
        alternative_help: help,
        insight,
    }
}

fn explain_insight(
    insight: &MoveInsight,
    moved: Move,
    options: CoachingOptions,
    variant: usize,
) -> (String, String, String) {
    let target = insight.targets[0];
    let victim = piece_at(
        target.piece.role,
        target.piece.color.into(),
        target.square,
        options,
    );
    let square = target.square;
    let reply = &insight.reply;
    let from = moved.from().expect("standard chess move");
    let to = destination(moved);
    let reply_to = destination(insight.reply_move);
    let mover = piece_at(moved.role(), target.piece.color.into(), from, options);
    let italian = options.language == CoachingLanguage::Italian;
    let local = |en: String, it: String| if italian { it } else { en };
    let varied = |en: [String; 3], it: [String; 3]| {
        if italian { it } else { en }
            .into_iter()
            .nth(variant)
            .unwrap_or_default()
    };
    let (summary, lesson, hint) = match insight.kind {
        InsightKind::AbandonedDefender => (
            varied(
                [
                    format!("Moving {mover} to {to} leaves {victim} undefended."),
                    format!("{} loses its only defender.", capitalized(&victim)),
                    format!("{reply} can take {victim} once the defender leaves {from}."),
                ],
                [
                    format!("Spostare {mover} in {to} lascia {victim} senza difesa."),
                    format!("{} perde il suo unico difensore.", capitalized(&victim)),
                    format!("{reply} prende {victim} quando il difensore lascia {from}."),
                ],
            ),
            local(
                format!("{reply} takes the piece left behind on {square}."),
                format!("{reply} prende il pezzo rimasto senza difesa in {square}."),
            ),
            local(format!("What was {mover} defending?"), format!("Che cosa proteggeva {mover}?")),
        ),
        InsightKind::OpenedLine => (
            varied(
                [
                    format!("Moving {mover} opens a line to {victim}."),
                    format!("Leaving {from} lets {reply} reach {victim}."),
                    format!("{reply} works because {from} is now clear."),
                ],
                [
                    format!("Spostare {mover} apre una linea verso {victim}."),
                    format!("Lasciare {from} permette a {reply} di raggiungere {victim}."),
                    format!("{reply} funziona perché {from} ora è libera."),
                ],
            ),
            local(
                format!("The piece on {from} was blocking that line before the move."),
                format!("Prima della mossa, il pezzo in {from} bloccava quella linea."),
            ),
            local(format!("Which line opens when the piece leaves {from}?"), format!("Quale linea si apre quando il pezzo lascia {from}?")),
        ),
        InsightKind::Fork => {
            let second = insight.targets[1];
            let other = piece_at(second.piece.role, second.piece.color.into(), second.square, options);
            let second_square = second.square;
            let lesson = if insight.targets.iter().any(|target| target.piece.role == Role::King) {
                local(
                    "The fork comes with check, so saving the other piece has to answer the check too.".into(),
                    "La forchetta dà scacco. Per salvare l’altro pezzo bisogna anche parare lo scacco.".into(),
                )
            } else {
                local(
                    format!("Taking the forking piece on {reply_to} would answer both threats if the capture is available."),
                    format!("Se è possibile, catturare il pezzo in {reply_to} risponde a entrambe le minacce."),
                )
            };
            (
                varied(
                    [
                        format!("{reply} forks {victim} and {other}."),
                        format!("{reply} attacks {victim} and {other} at the same time."),
                        format!("From {reply_to}, the reply attacks {victim} and {other}."),
                    ],
                    [
                        format!("{reply} crea una forchetta contro {victim} e {other}."),
                        format!("{reply} attacca insieme {victim} e {other}."),
                        format!("Da {reply_to}, la risposta attacca {victim} e {other}."),
                    ],
                ),
                lesson,
                local(
                    format!("Which square lets one piece attack both {square} and {second_square}?"),
                    format!("Da quale casa si possono attaccare insieme {square} e {second_square}?"),
                ),
            )
        }
        InsightKind::Pin => {
            let king = insight.targets[1];
            let king = piece_at(Role::King, king.piece.color.into(), king.square, options);
            let attacker = piece_at(insight.reply_move.role(), (!target.piece.color).into(), reply_to, options);
            (
                local(
                    format!("{} pins {victim} to {king}.", capitalized(&attacker)),
                    format!("{} inchioda {victim} al re.", capitalized(&attacker)),
                ),
                local(
                    format!("The piece on {square} can only move if it keeps the king out of check. It may still have a legal move along the pin."),
                    format!("Il pezzo in {square} può muoversi solo se il re resta al sicuro. Potrebbe avere una mossa legale lungo la linea."),
                ),
                local(
                    format!("Which piece stands between {reply_to} and {king}?"),
                    format!("Quale pezzo si trova tra {reply_to} e il re?"),
                ),
            )
        }
        InsightKind::BackRank => (
            local(
                format!("{reply} delivers back-rank mate. The king has no escape from {square}."),
                format!("{reply} dà matto sull’ultima traversa. Il re in {square} non ha vie di fuga."),
            ),
            local(
                "Look for a pawn move that gives the king an escape square before the rook or queen arrives.".into(),
                "Cerca una spinta di pedone che dia al re una via di fuga prima che arrivi la torre o la donna.".into(),
            ),
            local(format!("Where could the king on {square} escape?"), format!("Quale casa di fuga può usare il re in {square}?")),
        ),
        InsightKind::LoosePiece => (
            local(
                format!("{reply} takes {victim}, which is undefended."),
                format!("{reply} prende {victim}, rimasto senza difesa."),
            ),
            String::new(),
            local(format!("Who defends the piece on {square}?"), format!("Chi difende il pezzo in {square}?")),
        ),
        InsightKind::MateLine => (
            local(
                format!("The analysed line ends with {reply} and checkmate."),
                format!("La variante analizzata termina con {reply} e scacco matto."),
            ),
            String::new(),
            local(format!("Which checks take away escape squares from the king on {square}?"), format!("Quali scacchi tolgono le case di fuga al re in {square}?")),
        ),
    };
    let summary = if insight.ply > 1
        && !matches!(insight.kind, InsightKind::BackRank | InsightKind::MateLine)
    {
        if italian {
            format!("Nella variante, {summary}")
        } else {
            format!("In the analysed line, {summary}")
        }
    } else {
        summary
    };
    (summary, lesson, hint)
}
