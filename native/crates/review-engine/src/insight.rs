use chessash_review_core::legal_uci;
use shakmaty::{
    Bitboard, Board, CastlingMode, Chess, Color, Move, Piece, Position, Rank, Role, Square, attacks,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum InsightKind {
    AbandonedDefender,
    OpenedLine,
    BackRank,
    Fork,
    Pin,
    LoosePiece,
    MateLine,
}

#[derive(Clone, Copy, Debug)]
pub struct InsightTarget {
    pub square: Square,
    pub piece: Piece,
}

#[derive(Clone, Debug)]
pub struct MoveInsight {
    pub kind: InsightKind,
    pub reply: String,
    pub targets: Vec<InsightTarget>,
    pub line: Vec<String>,
    pub ply: usize,
    pub(super) reply_move: Move,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlternativeKind {
    Mate,
    Stalemate,
    RemovesAttacker,
    PreservesDefense,
    EscapesCapture,
    KeepsLineClosed,
    AvoidsFork,
    AvoidsPin,
    AnswersCheck,
    GivesCheck,
    UnrecapturedCapture,
}

#[derive(Clone, Copy, Debug)]
pub struct AlternativeHelp {
    pub kind: AlternativeKind,
    pub square: Square,
    pub role: Role,
}

fn slider(role: Role) -> bool {
    matches!(role, Role::Rook | Role::Bishop | Role::Queen)
}

fn tactical_value(role: Role) -> i32 {
    match role {
        Role::King => 100,
        Role::Queen => 9,
        Role::Rook => 5,
        Role::Bishop | Role::Knight => 3,
        Role::Pawn => 1,
    }
}

pub fn destination(moved: Move) -> Square {
    moved.castling_side().map_or(moved.to(), |castle| {
        Square::from_coords(castle.king_to_file(), moved.to().rank())
    })
}

pub fn capture_square(moved: Move) -> Square {
    if let Move::EnPassant { from, to } = moved {
        Square::from_coords(to.file(), from.rank())
    } else {
        moved.to()
    }
}

fn target(board: &Board, square: Square) -> Option<InsightTarget> {
    Some(InsightTarget {
        square,
        piece: board.piece_at(square)?,
    })
}

fn legal_relocation(board: &Board, color: Color, from: Square, to: Square) -> bool {
    let Some(piece) = board.piece_at(from) else {
        return false;
    };
    let mut test = board.clone();
    test.discard_piece_at(from);
    test.set_piece_at(to, piece);
    test.king_of(color)
        .is_some_and(|king| test.attacks_to(king, !color, test.occupied()).is_empty())
}

pub(super) fn defenders(board: &Board, square: Square) -> Bitboard {
    let Some(piece) = board.piece_at(square) else {
        return Bitboard::EMPTY;
    };
    if piece.role == Role::King {
        return Bitboard::EMPTY;
    }
    let mut legal = Bitboard::EMPTY;
    for from in board.attacks_to(square, piece.color, board.occupied()) {
        if legal_relocation(board, piece.color, from, square) {
            legal.add(from);
        }
    }
    legal
}

fn fork_targets(position: &Chess, attacker: Square, color: Color) -> Vec<InsightTarget> {
    let board = position.board();
    let targets = board.attacks_from(attacker) & board.by_color(!color) & !board.pawns();
    let mut legal: Vec<_> = targets
        .into_iter()
        .filter_map(|square| target(board, square))
        .filter(|target| {
            target.piece.role == Role::King
                || legal_relocation(board, color, attacker, target.square)
        })
        .collect();
    legal.sort_by_key(|target| std::cmp::Reverse(tactical_value(target.piece.role)));
    legal
}

pub(super) fn valuable_attack(
    position: &Chess,
    from: Square,
    color: Color,
) -> Option<InsightTarget> {
    fork_targets(position, from, color)
        .into_iter()
        .find(|target| matches!(target.piece.role, Role::Queen | Role::Rook))
}

pub(super) fn released_pin(
    before: &Chess,
    after: &Chess,
    moved: Move,
) -> Option<(InsightTarget, InsightTarget)> {
    let board = before.board();
    let side = before.turn();
    let king = board.king_of(side)?;
    let to = destination(moved);
    (!board.by_color(side) & board.occupied())
        .into_iter()
        .filter_map(|from| {
            let attacker = target(board, from)?;
            if after.board().piece_at(from) != Some(attacker.piece) {
                return None;
            }
            let ray = pinning_ray(attacker.piece.role, from, king);
            if moved.role() != Role::King && !ray.contains(to) {
                return None;
            }
            let square = (ray & board.occupied()).single_square()?;
            let piece = target(board, square)?;
            (piece.piece.color == side
                && after.board().piece_at(square) == Some(piece.piece)
                && !pinned(after.board(), piece))
            .then_some((attacker, piece))
        })
        .next()
}

fn pinning_ray(role: Role, from: Square, king: Square) -> Bitboard {
    let valid = match role {
        Role::Rook => from.rank() == king.rank() || from.file() == king.file(),
        Role::Bishop => from.rank().distance(king.rank()) == from.file().distance(king.file()),
        Role::Queen => true,
        _ => false,
    };
    if valid {
        attacks::between(from, king)
    } else {
        Bitboard::EMPTY
    }
}

pub fn find_insights(before: &Chess, moved: Move, reply_pv: &[String]) -> Vec<MoveInsight> {
    let Ok(after) = before.clone().play(moved) else {
        return Vec::new();
    };
    let color = before.turn();
    let mut position = after.clone();
    let mut steps = Vec::new();
    let mut line = Vec::new();
    for uci in reply_pv.iter().take(8) {
        let Some(reply) = legal_uci(&position, uci) else {
            return Vec::new();
        };
        let san = shakmaty::san::SanPlus::from_move(position.clone(), reply);
        line.push(san.to_string());
        let prior = position.clone();
        position.play_unchecked(reply);
        steps.push((prior, reply, position.clone()));
    }
    let mut insights = Vec::new();
    let Some(vacated) = moved.from() else {
        return insights;
    };
    for (index, (prior, reply, current)) in steps.iter().enumerate() {
        if prior.turn() == color {
            continue;
        }
        let Some(origin) = reply.from() else { continue };
        let square = destination(*reply);
        let board = current.board();
        let Some(king) = board
            .king_of(color)
            .and_then(|square| target(board, square))
        else {
            continue;
        };
        let direct = reply
            .capture()
            .filter(|_| !reply.is_en_passant())
            .and_then(|_| target(prior.board(), square));
        let direct_check = current.is_check() && current.checkers().contains(square);
        let mut add = |kind, targets| {
            insights.push(MoveInsight {
                kind,
                targets,
                line: line.clone(),
                reply: line[index].clone(),
                ply: index + 1,
                reply_move: *reply,
            })
        };
        if let Some(ray_target) = if direct_check { Some(king) } else { direct }
            && slider(reply.role())
            && !(direct_check && moved.role() == Role::King)
        {
            let ray = attacks::between(
                if direct_check { square } else { origin },
                ray_target.square,
            );
            if ray.contains(vacated) && (ray & after.board().occupied()).is_empty() {
                add(InsightKind::OpenedLine, vec![ray_target]);
            }
        }
        if let Some(victim) = direct.filter(|victim| victim.piece.role != Role::Pawn) {
            let guards = defenders(before.board(), square);
            let abandoned = before.board().piece_at(square) == Some(victim.piece)
                && after.board().piece_at(square) == Some(victim.piece)
                && steps[..index].iter().all(|(_, earlier, _)| {
                    earlier.from() != Some(square) && destination(*earlier) != square
                })
                && guards == Bitboard::from_square(vacated)
                && defenders(after.board(), square).is_empty();
            if abandoned {
                add(InsightKind::AbandonedDefender, vec![victim]);
            } else if index == 0 && defenders(prior.board(), square).is_empty() {
                add(InsightKind::LoosePiece, vec![victim]);
            }
        }
        if matches!(reply.role(), Role::Knight | Role::Pawn) {
            let mut targets = fork_targets(current, square, !color);
            if targets.len() >= 2 {
                targets.truncate(2);
                add(InsightKind::Fork, targets);
            }
        }
        let blockers = pinning_ray(reply.role(), square, king.square) & board.occupied();
        if let Some(pin) = blockers
            .single_square()
            .and_then(|square| target(board, square))
            && pin.piece.color == color
        {
            add(InsightKind::Pin, vec![pin, king]);
        }
        if current.is_checkmate() {
            let home = if color == Color::White {
                Rank::First
            } else {
                Rank::Eighth
            };
            let shield = if color == Color::White {
                Rank::Second
            } else {
                Rank::Seventh
            };
            let shield_count =
                (board.pawns() & board.by_color(color) & Bitboard::from_rank(shield))
                    .into_iter()
                    .filter(|pawn| pawn.file().distance(king.square.file()) <= 1)
                    .count();
            let kind = if matches!(reply.role(), Role::Queen | Role::Rook)
                && square.rank() == home
                && king.square.rank() == home
                && shield_count >= 2
            {
                InsightKind::BackRank
            } else {
                InsightKind::MateLine
            };
            add(kind, vec![king]);
        }
    }
    insights.sort_by_key(|insight| (insight.kind, insight.ply));
    insights.dedup_by_key(|insight| insight.kind);
    insights.truncate(3);
    insights
}

fn pinned(board: &Board, victim: InsightTarget) -> bool {
    let color = victim.piece.color;
    let Some(king) = board.king_of(color) else {
        return false;
    };
    for attacker in board.by_color(!color) {
        let role = board.role_at(attacker).expect("occupied square");
        if pinning_ray(role, attacker, king) & board.occupied()
            == Bitboard::from_square(victim.square)
        {
            return true;
        }
    }
    false
}

pub fn alternative_help(
    before: &Chess,
    played: Move,
    best: Move,
    insight: Option<&MoveInsight>,
) -> Option<AlternativeHelp> {
    if played == best {
        return None;
    }
    let after = before.clone().play(best).ok()?;
    let from = best.from()?;
    let to = destination(best);
    let cap = capture_square(best);
    let captured = best.capture().and_then(|_| target(before.board(), cap));
    let board = after.board();
    let color = before.turn();
    let help = |kind, square, role| Some(AlternativeHelp { kind, square, role });
    let reason = |kind| help(kind, to, best.role());
    if after.is_checkmate() {
        return reason(AlternativeKind::Mate);
    }
    if after.is_stalemate() {
        return reason(AlternativeKind::Stalemate);
    }
    let recaptured = || {
        after
            .capture_moves()
            .iter()
            .any(|reply| capture_square(*reply) == to)
    };
    if let Some(insight) = insight {
        let victim = insight.targets[0];
        if insight.ply == 1
            && let Some(taken) = captured
            && insight.reply_move.from() == Some(cap)
            && insight.reply_move.role() == taken.piece.role
        {
            return help(AlternativeKind::RemovesAttacker, cap, taken.piece.role);
        }
        if insight.kind == InsightKind::AbandonedDefender
            && board.piece_at(victim.square) == Some(victim.piece)
            && !defenders(board, victim.square).is_empty()
        {
            return help(
                AlternativeKind::PreservesDefense,
                victim.square,
                victim.piece.role,
            );
        }
        if insight.ply == 1 {
            if insight.kind == InsightKind::OpenedLine
                && let Some(blocker) = played.from()
                && board.piece_at(blocker) == before.board().piece_at(blocker)
                && board.piece_at(victim.square) == Some(victim.piece)
            {
                let origin = if victim.piece.role == Role::King {
                    destination(insight.reply_move)
                } else {
                    insight.reply_move.from()?
                };
                if attacks::between(origin, victim.square).contains(blocker) {
                    return help(AlternativeKind::KeepsLineClosed, blocker, played.role());
                }
            }
            let moves_target = insight.targets.iter().any(|target| {
                target.square == from && before.board().piece_at(from) == Some(target.piece)
            });
            if moves_target
                && matches!(
                    insight.kind,
                    InsightKind::AbandonedDefender
                        | InsightKind::OpenedLine
                        | InsightKind::LoosePiece
                )
                && best.role() != Role::King
                && !recaptured()
            {
                return reason(AlternativeKind::EscapesCapture);
            }
            let reply = insight
                .reply_move
                .to_uci(CastlingMode::Standard)
                .to_string();
            if let Some(reply) = legal_uci(&after, &reply)
                && let Ok(replayed) = after.clone().play(reply)
            {
                let reply_to = destination(reply);
                if moves_target
                    && insight.kind == InsightKind::Fork
                    && fork_targets(&replayed, reply_to, !color).len() < 2
                    && !replayed.board().attacks_from(reply_to).contains(to)
                {
                    return reason(AlternativeKind::AvoidsFork);
                }
                if insight.kind == InsightKind::Pin
                    && best.role() == Role::King
                    && replayed.board().piece_at(victim.square) == Some(victim.piece)
                    && !pinned(replayed.board(), victim)
                {
                    return reason(AlternativeKind::AvoidsPin);
                }
            }
        }
    }
    if before.is_check() {
        let king = before.board().king_of(color)?;
        let checkers = before.checkers();
        if let Some(taken) = captured
            && checkers.contains(cap)
        {
            return help(AlternativeKind::RemovesAttacker, cap, taken.piece.role);
        }
        if let Some(checker) = checkers.single_square()
            && best.role() != Role::King
            && attacks::between(checker, king).contains(to)
        {
            return reason(AlternativeKind::AnswersCheck);
        }
    }
    if after.is_check() {
        return reason(AlternativeKind::GivesCheck);
    }
    if let Some(taken) = captured
        && defenders(before.board(), cap).is_empty()
        && !recaptured()
    {
        return help(AlternativeKind::UnrecapturedCapture, cap, taken.piece.role);
    }
    None
}
