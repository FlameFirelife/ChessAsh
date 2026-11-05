import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import FoxashPanel from "./desktop/FoxashPanel";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Settings,
  Plus,
  ArrowDownToLine,
  RotateCw,
  Play,
  Square,
  Lightbulb,
  Undo2,
  X,
  Search,
  Check,
  Flame,
  Library,
  MessageSquare,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import Board from "./components/Board";
import Graph from "./components/Graph";
import AccuracyScore from "./components/AccuracyScore";
import ReviewMessage from "./components/ReviewMessage";
import AccountLibrary from "./components/AccountLibrary";
import { useAccounts } from "./accounts";
import TutorPanel from "./desktop/TutorPanel";
import {
  parsePgnCollection,
  parsePgn,
  loadGames,
  saveGames,
  mergeGames,
  importChessCom,
  analyzeGame,
  analyzePosition,
  accuracy,
  openingName,
  LABELS,
  LABEL_INFO,
  exportPgn,
  variationSan,
  phaseAt,
  deleteGame,
  ENGINE_VERSION,
} from "./core";
import type {
  Game,
  MoveReview,
  Label,
  EngineResult,
  ReviewFacts,
} from "./core";

const DEMO = `[Event "Opera game (sample)"]
[Site "Paris"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
type Prefs = {
  depth: number;
  theme: string;
  reduced: boolean;
  sound: boolean;
  font: number;
  arrows: boolean;
  graph: boolean;
  advanced: boolean;
};
const defaults: Prefs = {
  depth: 12,
  theme: "dark",
  reduced: false,
  sound: false,
  font: 16,
  arrows: true,
  graph: false,
  advanced: false,
};
function prefLoad(): Prefs {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem("chessash:prefs") || "{}"),
    };
  } catch {
    return defaults;
  }
}
const cp = (n: number) =>
  Math.abs(n) >= 29000
    ? (n > 0 ? "White" : "Black") + " mating"
    : (n > 0 ? "+" : "") + (n / 100).toFixed(2);
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const badge = (r: MoveReview) => (
  <span className={`badge label-${r.label}`} title={LABEL_INFO[r.label].name}>
    {LABEL_INFO[r.label].symbol}
  </span>
);
async function download(name: string, text: string) {
  if (Capacitor.isNativePlatform()) {
    const result = await registerPlugin<{
      saveText: (options: {
        filename: string;
        text: string;
      }) => Promise<{ saved: boolean }>;
    }>("ChessAshFiles").saveText({ filename: name, text });
    return result.saved;
  }
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/x-chess-pgn" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function briefExplanation(game: Game, r: MoveReview): string {
  const before = new Chess(game.positions[r.ply - 1]);
  const after = new Chess(game.positions[r.ply]);
  if (after.isCheckmate()) return "Checkmate. The king has no way out.";
  if (after.isStalemate())
    return "This ends the game in stalemate. The opponent has no legal move but is not in check.";
  let best = "";
  try {
    best = before.move({
      from: r.best.slice(0, 2),
      to: r.best.slice(2, 4),
      promotion: r.best[4],
    }).san;
  } catch {}
  if (r.label === "book") return "This follows a recognised opening sequence.";
  if (r.label === "best")
    return "You found the strongest move in this position.";
  if (r.label === "excellent")
    return "A strong move, very close to the best option.";
  if (r.label === "good")
    return best
      ? "A sound move. " + best + " was a stronger option."
      : "A sound move.";
  if (r.label === "great")
    return "You found a critical move. The alternatives were much weaker.";
  if (r.label === "sacrifice")
    return "A sound sacrifice. You give up material while keeping enough compensation.";
  const capture = r.explanation.match(
    /The reply [^.]+captures your [^.]+\./,
  )?.[0];
  if (capture) return capture + (best ? " Try " + best + " instead." : "");
  if (r.loss >= 10000)
    return "This allows a forced mate. Play through the line to see the threat.";
  if (r.label === "miss")
    return best
      ? "You had a stronger opportunity with " +
          best +
          ". Try finding the idea."
      : "There was a stronger opportunity here.";
  return best
    ? best + " gives you a stronger position. Try it and compare the replies."
    : "Compare the continuation to see what changed.";
}

export default function App() {
  const [games, setGames] = useState<Game[]>([]),
    [ready, setReady] = useState(false),
    [activeId, setActiveId] = useState(
      localStorage.getItem("chessash:active") || "",
    );
  const [ply, setPly] = useState(0),
    [view, setView] = useState<"review" | "analysis" | "tutor">("review"),
    [screen, setScreen] = useState<"board" | "library">("board");
  const [prefs, setPrefs] = useState<Prefs>(prefLoad),
    [dialog, setDialog] = useState<"import" | "settings" | null>(null),
    [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState([0, 0]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [resultFilter, setResultFilter] = useState("all"),
    [timeFilter, setTimeFilter] = useState("all");
  const [short, setShort] = useState(true),
    [hint, setHint] = useState(0),
    [showBest, setShowBest] = useState(false),
    [retry, setRetry] = useState(false),
    [retryText, setRetryText] = useState("");
  const [branch, setBranch] = useState<string[]>([]),
    [branchIndex, setBranchIndex] = useState(0),
    [branchOrigin, setBranchOrigin] = useState(""),
    [engineResult, setEngineResult] = useState<EngineResult | null>(null),
    [searching, setSearching] = useState(false);
  const [username, setUsername] = useState(
      localStorage.getItem("chessash:username") || "",
    ),
    [pgn, setPgn] = useState(""),
    [gameLink, setGameLink] = useState(""),
    [importing, setImporting] = useState(false),
    [importStatus, setImportStatus] = useState(""),
    [months, setMonths] = useState(3);
  const [deleted, setDeleted] = useState<Game | null>(null);
  const abort = useRef<AbortController | null>(null),
    positionAbort = useRef<AbortController | null>(null),
    gamesRef = useRef<Game[]>([]),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accounts = useAccounts({ games, setGames, ready, onNotice: setNotice });
  const [useAsMain, setUseAsMain] = useState(false);
  const selectionRef = useRef({ id: activeId, ply });
  selectionRef.current = { id: activeId, ply };
  useEffect(() => {
    if (dialog === "import") setUseAsMain(!accounts.mainUsername);
  }, [dialog, accounts.mainUsername]);
  const isDesktop = !!window.chessash;
  const game = games.find((g) => g.id === activeId) || games[0];
  const results = game?.review?.results || [];
  const current = results.find((r) => r.ply === ply);
  const initialFen = game?.positions[ply] || new Chess().fen();
  const effectiveFen =
    retry && current
      ? game!.positions[current.ply - 1]
      : branch.length && branchOrigin
        ? (() => {
            const c = new Chess(branchOrigin);
            for (const m of branch.slice(0, branchIndex)) {
              try {
                c.move({
                  from: m.slice(0, 2),
                  to: m.slice(2, 4),
                  promotion: m[4],
                });
              } catch {
                break;
              }
            }
            return c.fen();
          })()
        : initialFen;
  useEffect(() => {
    if (!ready || !game) return;
    const next = Math.max(0, Math.min(ply, game.moves.length));
    if (next !== ply) setPly(next);
    setGames((saved) => {
      const current = saved.find((item) => item.id === game.id);
      if (!current || current.lastPly === next) return saved;
      return saved.map((item) =>
        item.id === game.id ? { ...item, lastPly: next } : item,
      );
    });
  }, [game?.id, ply, ready]);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".modal");
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary",
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !importing) {
        event.preventDefault();
        setDialog(null);
      }
      if (event.key === "Tab") {
        const targets = focusable();
        const first = targets[0],
          last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [dialog, importing]);

  useEffect(() => {
    let live = true;
    loadGames()
      .then((list) => {
        if (!live) return;
        setGames(list);
        gamesRef.current = list;
        const g = list.find((g) => g.id === activeId) || list[0];
        if (g) {
          setActiveId(g.id);
          setPly(g.lastPly || 0);
        }
        setReady(true);
      })
      .catch((e) => {
        setError("Could not open your library: " + err(e));
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    gamesRef.current = games;
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveGames(gamesRef.current).catch((e) =>
        setError("Could not save: " + err(e)),
      );
    }, 400);
  }, [games, ready]);
  useEffect(() => {
    localStorage.setItem("chessash:prefs", JSON.stringify(prefs));
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.motion = prefs.reduced
      ? "reduced"
      : "normal";
    document.documentElement.style.fontSize = prefs.font + "px";
  }, [prefs]);
  useEffect(() => {
    setHint(0);
    setShowBest(false);
    setRetry(false);
    setRetryText("");
    setBranch([]);
    setBranchIndex(0);
    setEngineResult(null);
    positionAbort.current?.abort();
  }, [activeId, ply]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        dialog ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(ply - 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(ply + 1);
      }
      if (e.key === "Home") navigate(0);
      if (e.key === "End") navigate(game?.moves.length || 0);
      if (e.key === "Escape") {
        setBranch([]);
        setRetry(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ply, game, dialog, branch, branchIndex]);
  useEffect(() => {
    const stop = () => {
      if (document.hidden && Capacitor.isNativePlatform()) {
        abort.current?.abort();
        positionAbort.current?.abort();
        void saveGames(gamesRef.current).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", stop);
    return () => document.removeEventListener("visibilitychange", stop);
  }, []);
  useEffect(() => {
    return () => {
      abort.current?.abort();
      positionAbort.current?.abort();
    };
  }, []);

  function openImport() {
    setUseAsMain(!accounts.mainUsername);
    setError("");
    setDialog("import");
  }
  function updateGame(id: string, patch: Partial<Game>) {
    setGames((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }
  function openGame(g: Game) {
    abort.current?.abort();
    positionAbort.current?.abort();
    setActiveId(g.id);
    localStorage.setItem("chessash:active", g.id);
    setPly(g.lastPly || 0);
    setScreen("board");
    setFilter("all");
    setView("review");
  }
  function navigate(n: number) {
    if (branch.length) {
      setBranchIndex(
        Math.max(0, Math.min(branch.length, branchIndex + (n > ply ? 1 : -1))),
      );
      return;
    }
    if (!game) return;
    const p = Math.max(0, Math.min(game.moves.length, n));
    setPly(p);
    updateGame(game.id, { lastPly: p });
  }
  function sound() {
    if (!prefs.sound) return;
    try {
      const a = new AudioContext();
      const o = a.createOscillator(),
        v = a.createGain();
      o.connect(v);
      v.connect(a.destination);
      o.frequency.value = 440;
      v.gain.setValueAtTime(0.025, a.currentTime);
      v.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.07);
      o.start();
      o.stop(a.currentTime + 0.08);
      o.onended = () => void a.close();
    } catch {}
  }
  function addGames(list: Game[]) {
    const merged = mergeGames(gamesRef.current, list);
    setGames(merged);
    gamesRef.current = merged;
    if (list[0]) openGame(list[0]);
    setDialog(null);
    setPgn("");
    setNotice(`Imported ${list.length} game${list.length === 1 ? "" : "s"}.`);
  }
  async function importAccount() {
    setError("");
    setImporting(true);
    localStorage.setItem("chessash:username", username.trim());
    try {
      let list = await accounts.importAccount(
        username.trim(),
        months,
        setImportStatus,
      );
      if (gameLink.trim()) {
        const id = gameLink.match(/\/(\d+)(?:[/?#]|$)/)?.[1];
        list = list.filter((g) =>
          (g.url || g.headers.Link || "").includes("/" + id),
        );
        if (!list.length)
          throw new Error(
            "That game was not found in the fetched archives. Increase archive range or import its PGN.",
          );
      }
      if (useAsMain) accounts.setMainUsername(username.trim());
      addGames(list);
    } catch (e) {
      setError(err(e));
    } finally {
      setImporting(false);
      setImportStatus("");
    }
  }
  async function runReview() {
    if (!game || busy) return;
    positionAbort.current?.abort();
    const id = game.id;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setProgress([
      game.review?.depth === prefs.depth ? results.length : 0,
      game.moves.length,
    ]);
    let draft: MoveReview[] =
      game.review?.depth === prefs.depth ? [...results] : [];
    try {
      const review = await analyzeGame(game, {
        depth: prefs.depth,
        signal: controller.signal,
        existing: game.review,
        onProgress: (done, total) => setProgress([done, total]),
        onResult: (r) => {
          draft = [...draft.filter((x) => x.ply !== r.ply), r].sort(
            (a, b) => a.ply - b.ply,
          );
          updateGame(id, {
            review: {
              version: 1,
              engine: ENGINE_VERSION,
              depth: prefs.depth,
              results: [...draft],
              completed: false,
            },
          });
        },
        classify: isDesktop
          ? async (facts: ReviewFacts) => {
              const row = (await window.chessash!.reviewFacts([facts]))[0];
              if (!row || !LABELS.includes(row.label))
                throw new Error("Foxash returned an invalid review label.");
              return row;
            }
          : undefined,
      });
      updateGame(id, { review });
      if (
        review.completed &&
        selectionRef.current.id === id &&
        selectionRef.current.ply === 0
      ) {
        const moments = review.results
          .filter((r) => r.key)
          .sort((a, b) => b.loss - a.loss)
          .slice(0, 3)
          .sort((a, b) => a.ply - b.ply);
        setPly(moments[0]?.ply || 1);
      }
      setNotice(
        review.completed
          ? "Review complete. Select a key moment to begin."
          : "Analysis paused. Your progress is saved.",
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(err(e));
      else setNotice("Analysis paused. Your progress is saved.");
    } finally {
      setBusy(false);
    }
  }
  async function evaluate(fen = effectiveFen) {
    if (busy) {
      setNotice("Pause the game review before analysing a variation.");
      return;
    }
    positionAbort.current?.abort();
    const controller = new AbortController();
    positionAbort.current = controller;
    setSearching(true);
    setError("");
    try {
      const r = await analyzePosition(fen, {
        depth: prefs.depth,
        signal: controller.signal,
        multiPv: 3,
      });
      if (!controller.signal.aborted) setEngineResult(r);
    } catch (e) {
      if (!controller.signal.aborted) setError(err(e));
    } finally {
      if (positionAbort.current === controller) setSearching(false);
    }
  }
  async function move(from: string, to: string, promotion?: string) {
    if (!game) return;
    const uci = from + to + (promotion || "");
    if (retry && current) {
      if (uci === current.best) {
        setRetryText(
          "Found it. Play through the continuation to see the idea.",
        );
        setRetry(false);
        setShowBest(false);
        preview([current.best], game.positions[current.ply - 1]);
        setBranchIndex(1);
        sound();
        return;
      }
      if (busy) {
        setRetryText("Pause analysis to check an alternative.");
        return;
      }
      setRetryText("Checking your alternative…");
      try {
        const base = game.positions[current.ply - 1];
        const [best, alternative] = await Promise.all([
          analyzePosition(base, { depth: prefs.depth }),
          analyzePosition(base, { depth: prefs.depth, moves: [uci] }),
        ]);
        const sign = new Chess(base).turn() === "w" ? 1 : -1;
        const loss = Math.max(0, (best.score - alternative.score) * sign);
        if (loss <= 35) {
          setRetryText(
            "That works too. Your move preserves the position’s chances.",
          );
          setRetry(false);
          preview([uci], game.positions[current.ply - 1]);
          setBranchIndex(1);
          sound();
        } else {
          setRetryText(
            "There is a stronger move. Try a hint or reveal the continuation.",
          );
        }
      } catch (e) {
        setRetryText(err(e));
      }
      return;
    }
    try {
      const c = new Chess(effectiveFen);
      c.move({ from, to, promotion });
      const origin = branch.length ? branchOrigin : initialFen;
      const next = [...branch.slice(0, branchIndex), uci];
      setBranchOrigin(origin);
      setBranch(next);
      setBranchIndex(next.length);
      setView("analysis");
      setEngineResult(null);
      sound();
    } catch {}
  }
  function preview(
    moves: string[],
    origin = game?.positions[Math.max(0, ply - 1)] || initialFen,
  ) {
    setRetry(false);
    setRetryText("");
    setBranchOrigin(origin);
    setBranch(moves);
    setBranchIndex(0);
    setView("analysis");
  }
  function jumpKey(direction: number) {
    const keys = (
      short
        ? [...results]
            .filter((r) => r.key)
            .sort((a, b) => b.loss - a.loss)
            .slice(0, 3)
            .sort((a, b) => a.ply - b.ply)
        : results.filter((r) => r.key)
    ).filter((r) => filter === "all" || r.label === filter);
    const next =
      direction > 0
        ? keys.find((r) => r.ply > ply)
        : [...keys].reverse().find((r) => r.ply < ply);
    if (next) {
      setBranch([]);
      setPly(next.ply);
    } else setNotice("No more matching key moments.");
  }
  const keyResults = short
    ? [...results]
        .filter((r) => r.key)
        .sort((a, b) => b.loss - a.loss)
        .slice(0, 3)
        .sort((a, b) => a.ply - b.ply)
    : results.filter((r) => r.key);
  const activeScore = engineResult?.score ?? current?.after ?? 0;
  const lastMove = branchIndex ? branch[branchIndex - 1] : current?.move;
  const pawnName = game?.headers.White || "White",
    blackName = game?.headers.Black || "Black";

  return (
    <>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setScreen("board")}
          aria-label="ChessAsh board"
        >
          <span className="brand-mark">
            <Flame size={23} />
          </span>
          Chess<span>Ash</span>
          <small>1.0</small>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={screen === "board" ? "nav-active" : ""}
            onClick={() => setScreen("board")}
          >
            <BookOpen size={17} />
            Review
          </button>
          <button
            className={screen === "library" ? "nav-active" : ""}
            onClick={() => {
              setFilter("all");
              setScreen("library");
            }}
          >
            <Library size={17} />
            Library <span className="count">{games.length}</span>
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setDialog("settings")}
          >
            <Settings size={19} />
          </button>
          <button
            className="primary small"
            onClick={() => {
              setError("");
              openImport();
            }}
          >
            <Plus size={17} />
            Import game
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {!ready ? (
        <main className="empty-state">
          <Flame size={40} />
          <h1>Opening your library…</h1>
        </main>
      ) : !game && screen === "board" ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="section-label">A closer look at your chess</span>
            <h1>Review your games.</h1>
            <p>Import from Chess.com or open a PGN.</p>
            <div className="actions">
              <button className="primary" onClick={() => openImport()}>
                <Plus size={18} />
                Import your games
              </button>
              <button onClick={() => addGames([parsePgn(DEMO, "Sample")])}>
                Explore a sample
              </button>
            </div>
            <p className="quiet">Free reviews, saved on your device.</p>
          </div>
          <div className="welcome-board">
            <Board
              fen={new Chess().fen()}
              flipped={false}
              onMove={() => {}}
              disabled
            />
          </div>
        </main>
      ) : screen === "library" ? (
        <div className="library-screen">
          <AccountLibrary
            games={games}
            mainUsername={accounts.mainUsername}
            onMainUsernameChange={accounts.setMainUsername}
            onSync={accounts.syncMain}
            syncing={accounts.syncing}
            lastSynced={accounts.lastSynced}
            syncError={accounts.error}
            onOpen={openGame}
            onDelete={(g) => {
              setDeleted(g);
              setGames((gs) => gs.filter((x) => x.id !== g.id));
              void deleteGame(g.id).catch((e) => setError(err(e)));
            }}
            onImport={() => openImport()}
          />
          {deleted && (
            <div className="undo-bar">
              Game removed.
              <button
                onClick={() => {
                  setGames((gs) => mergeGames(gs, [deleted]));
                  setDeleted(null);
                }}
              >
                <Undo2 size={15} />
                Undo
              </button>
              <button
                aria-label="Dismiss undo"
                onClick={() => setDeleted(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      ) : (
        game && (
          <main className="workspace">
            <section className="board-column">
              <div className="game-heading">
                <div>
                  <span className="section-label">
                    {openingName(game.moves)}
                  </span>
                  <h1>{game.headers.Event || "Game review"}</h1>
                </div>
                <button
                  className="icon-button"
                  title="Export annotated PGN"
                  aria-label="Export annotated PGN"
                  onClick={() => {
                    void download(`ChessAsh-${game.id}.pgn`, exportPgn(game))
                      .then((saved) => {
                        if (saved) setNotice("PGN exported.");
                      })
                      .catch((e) => setError(err(e)));
                  }}
                >
                  <ArrowDownToLine size={19} />
                </button>
              </div>
              {view === "review" && (
                <ReviewMessage
                  result={current}
                  text={
                    current
                      ? briefExplanation(game, current)
                      : results.length
                        ? "Your review is ready. Let’s look at a turning point."
                        : "Let’s look at this game together. Start a review to find the moments worth practising."
                  }
                  detail={current?.explanation}
                  hint={
                    hint > 0
                      ? current?.hints[
                          Math.min(hint - 1, current.hints.length - 1)
                        ]
                      : undefined
                  }
                  retryText={retryText}
                  retry={retry}
                  busy={busy}
                  hasReview={results.length > 0}
                  onTry={() => {
                    setBranch([]);
                    setRetry(true);
                    setRetryText("Find a strong move on the board.");
                    setShowBest(false);
                  }}
                  onHint={() => {
                    if (!current) return;
                    setBranch([]);
                    setRetry(true);
                    setRetryText("");
                    setShowBest(false);
                    setHint((h) => Math.min(h + 1, current.hints.length));
                  }}
                  onLine={() => {
                    if (!current) return;
                    setShowBest(true);
                    setRetry(false);
                    preview(current.pv);
                  }}
                  onExit={() => {
                    setRetry(false);
                    setRetryText("");
                    setHint(0);
                  }}
                  onStart={() => {
                    setBranch([]);
                    setPly(keyResults[0]?.ply || 1);
                  }}
                />
              )}
              <div className="player-strip">
                <div className="player-avatar">{flipped ? "W" : "B"}</div>
                <strong>{flipped ? pawnName : blackName}</strong>
                <span>
                  {game.headers[flipped ? "WhiteElo" : "BlackElo"] || ""}
                </span>
                <span className="player-result">{game.headers.Result}</span>
              </div>
              <div className="board-with-eval">
                <div
                  className="eval-bar"
                  aria-label={`Evaluation ${cp(activeScore)}`}
                >
                  <div
                    className="eval-white"
                    style={{
                      transform: `scaleY(${1 / (1 + Math.exp(-activeScore / 350))})`,
                    }}
                  />
                  <span>
                    {Math.abs(activeScore) >= 29000
                      ? "M"
                      : Math.abs(activeScore / 100).toFixed(1)}
                  </span>
                </div>
                <Board
                  key={activeId}
                  fen={effectiveFen}
                  flipped={flipped}
                  onMove={(f, t, p) => void move(f, t, p)}
                  arrow={
                    prefs.arrows &&
                    current &&
                    effectiveFen === game.positions[current.ply - 1] &&
                    (showBest || (retry && hint >= current.hints.length))
                      ? current.best
                      : undefined
                  }
                  lastMove={lastMove}
                  quality={
                    current && !retry && !branch.length
                      ? {
                          square: current.move.slice(2, 4),
                          label: current.label,
                          name: LABEL_INFO[current.label].name,
                          key: game.id + ":" + ply + ":" + current.label,
                        }
                      : undefined
                  }
                />
              </div>
              <div className="player-strip">
                <div className="player-avatar white-avatar">
                  {flipped ? "B" : "W"}
                </div>
                <strong>{flipped ? blackName : pawnName}</strong>
                <span>
                  {game.headers[flipped ? "BlackElo" : "WhiteElo"] || ""}
                </span>
                <span className="source-tag">{game.source}</span>
              </div>
              <div className="board-controls">
                <button
                  className="icon-button"
                  title="Flip board"
                  aria-label="Flip board"
                  onClick={() => setFlipped((f) => !f)}
                >
                  <RotateCw size={18} />
                </button>
                <div className="move-controls">
                  <button
                    aria-label="First move"
                    onClick={() =>
                      branch.length ? setBranchIndex(0) : navigate(0)
                    }
                  >
                    <ChevronsLeft size={21} />
                  </button>
                  <button
                    aria-label="Previous move"
                    onClick={() => navigate(ply - 1)}
                  >
                    <ChevronLeft size={23} />
                  </button>
                  <span>
                    {branch.length
                      ? `${branchIndex}/${branch.length}`
                      : `${ply}/${game.moves.length}`}
                  </span>
                  <button
                    aria-label="Next move"
                    onClick={() => navigate(ply + 1)}
                  >
                    <ChevronRight size={23} />
                  </button>
                  <button
                    aria-label="Last move"
                    onClick={() =>
                      branch.length
                        ? setBranchIndex(branch.length)
                        : navigate(game.moves.length)
                    }
                  >
                    <ChevronsRight size={21} />
                  </button>
                </div>
                <button
                  className="icon-button"
                  aria-label="Analysis settings"
                  title="Analysis settings"
                  onClick={() => setDialog("settings")}
                >
                  <SlidersHorizontal size={18} />
                </button>
              </div>
              {branch.length > 0 && (
                <div className="variation-strip">
                  <span>
                    Exploring{" "}
                    {variationSan(branchOrigin, branch)
                      .slice(0, branchIndex)
                      .join(" ") || "starting position"}
                  </span>
                  <button
                    onClick={() => {
                      setBranch([]);
                      setEngineResult(null);
                    }}
                  >
                    <Undo2 size={15} />
                    Return to game
                  </button>
                </div>
              )}
              {results.length > 0 && (
                <details
                  className="advantage-disclosure"
                  open={prefs.graph ? true : undefined}
                  onToggle={(e) => {
                    const open = e.currentTarget.open;
                    if (open !== prefs.graph)
                      setPrefs((p) => ({ ...p, graph: open }));
                  }}
                >
                  <summary>
                    Game advantage<span>Who had the edge?</span>
                  </summary>
                  <p>
                    Above the middle favours White. Below favours Black. Select
                    a point to revisit that moment.
                  </p>
                  <Graph
                    results={results}
                    total={game.moves.length}
                    ply={ply}
                    onSelect={(n) => {
                      setBranch([]);
                      setPly(n);
                    }}
                  />
                </details>
              )}
              {prefs.advanced && (
                <div className="engine-footnote">
                  <span>
                    Stockfish 19 lite / depth{" "}
                    {game.review?.depth || prefs.depth}
                  </span>
                  <span>
                    {game.review?.completed
                      ? "Saved on this device"
                      : `${results.length}/${game.moves.length} moves analysed`}
                  </span>
                </div>
              )}
            </section>
            <section className="review-column">
              <div className="panel-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={view === "review"}
                  className={view === "review" ? "active" : ""}
                  onClick={() => setView("review")}
                >
                  <BookOpen size={16} />
                  Review
                </button>
                {(prefs.advanced ||
                  branch.length > 0 ||
                  view === "analysis") && (
                  <button
                    role="tab"
                    aria-selected={view === "analysis"}
                    className={view === "analysis" ? "active" : ""}
                    onClick={() => setView("analysis")}
                  >
                    <Search size={16} />
                    Explore
                  </button>
                )}
                {isDesktop && (
                  <button
                    role="tab"
                    aria-selected={view === "tutor"}
                    className={view === "tutor" ? "active" : ""}
                    onClick={() => setView("tutor")}
                  >
                    <MessageSquare size={16} />
                    Tutor
                  </button>
                )}
              </div>
              {view === "tutor" ? (
                <TutorPanel
                  game={game}
                  ply={ply}
                  result={current}
                  onPreview={(moves) => preview(moves, initialFen)}
                />
              ) : view === "analysis" ? (
                <div className="analysis-panel">
                  <div className="section-heading">
                    <h2>Explore the position</h2>
                    <span>
                      {new Chess(effectiveFen).turn() === "w"
                        ? "White"
                        : "Black"}{" "}
                      to move
                    </span>
                  </div>
                  <p>
                    Move pieces to explore an alternative. Ask the engine to
                    compare candidate lines.
                  </p>
                  <button
                    className="primary"
                    disabled={searching || busy}
                    onClick={() => void evaluate()}
                  >
                    {searching ? "Evaluating…" : "Evaluate position"}
                  </button>
                  {searching && (
                    <button onClick={() => positionAbort.current?.abort()}>
                      Stop
                    </button>
                  )}
                  {engineResult && (
                    <div className="engine-lines">
                      <div className="section-heading">
                        <strong>{cp(engineResult.score)}</strong>
                        <span>Depth {engineResult.depth}</span>
                      </div>
                      {engineResult.lines.map((l, i) => (
                        <button
                          key={i}
                          onClick={() => preview(l.pv, effectiveFen)}
                        >
                          <strong>{cp(l.score)}</strong>
                          <span>
                            {variationSan(effectiveFen, l.pv)
                              .slice(0, 10)
                              .join(" ")}
                          </span>
                          <Play size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="note-label">
                    Position notes
                    <textarea
                      placeholder="What did you notice?"
                      value={game.notes?.[ply] || ""}
                      onChange={(e) =>
                        updateGame(game.id, {
                          notes: { ...game.notes, [ply]: e.target.value },
                        })
                      }
                    />
                  </label>
                  <MoveList
                    game={game}
                    ply={ply}
                    onSelect={(n) => {
                      setBranch([]);
                      setPly(n);
                    }}
                    filter="all"
                  />
                </div>
              ) : (
                <>
                  <div className="review-overview">
                    <div className="section-heading">
                      <h2>
                        {game.review?.completed
                          ? "Your review"
                          : "Review this game"}
                      </h2>
                    </div>
                    {results.length > 0 && (
                      <div className="accuracy-row">
                        {(["w", "b"] as const).map((color) => (
                          <AccuracyScore
                            key={color}
                            value={accuracy(results, color)}
                            player={color === "w" ? pawnName : blackName}
                            provisional={!game.review?.completed}
                            reduced={prefs.reduced}
                          />
                        ))}
                      </div>
                    )}
                    {!results.length && (
                      <p className="review-intro">
                        Find the moments that mattered and try a better move.
                      </p>
                    )}
                    {!game.review?.completed || busy ? (
                      <>
                        <div className="analysis-action">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => void runReview()}
                          >
                            <Play size={16} />
                            {busy
                              ? "Analysing…"
                              : results.length
                                ? "Continue review"
                                : "Start review"}
                          </button>
                          {busy && (
                            <button
                              aria-label="Pause analysis"
                              onClick={() => abort.current?.abort()}
                            >
                              <Square size={14} />
                              Pause
                            </button>
                          )}
                          {prefs.advanced && <span>Depth {prefs.depth}</span>}
                        </div>
                        {busy && (
                          <div className="progress">
                            <span
                              style={{
                                transform: `scaleX(${progress[1] ? progress[0] / progress[1] : 0})`,
                              }}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="review-complete">
                        <Check size={15} />
                        Review saved
                        <button
                          onClick={() => void runReview()}
                          disabled={busy}
                        >
                          Reanalyse
                        </button>
                      </div>
                    )}
                    {results.length > 0 && (
                      <details className="quality-details">
                        <summary>
                          Move quality <span>Both players</span>
                        </summary>
                        <div className="classifications">
                          {LABELS.map((label) => (
                            <button
                              title={LABEL_INFO[label].description}
                              className={filter === label ? "chosen" : ""}
                              key={label}
                              onClick={() => {
                                setFilter(filter === label ? "all" : label);
                                const r = results.find(
                                  (r) => r.label === label,
                                );
                                if (r) {
                                  setBranch([]);
                                  setPly(r.ply);
                                }
                              }}
                            >
                              <span className={`badge label-${label}`}>
                                {LABEL_INFO[label].symbol}
                              </span>
                              <span>{LABEL_INFO[label].name}</span>
                              <b>
                                {
                                  results.filter(
                                    (r) => r.color === "w" && r.label === label,
                                  ).length
                                }
                              </b>
                              <b>
                                {
                                  results.filter(
                                    (r) => r.color === "b" && r.label === label,
                                  ).length
                                }
                              </b>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  {results.length > 0 && (
                    <div className="guided-review">
                      <div className="section-heading">
                        <h2>Turning points</h2>
                        <div className="segmented">
                          <button
                            className={short ? "active" : ""}
                            onClick={() => setShort(true)}
                          >
                            Short
                          </button>
                          <button
                            className={!short ? "active" : ""}
                            onClick={() => setShort(false)}
                          >
                            Full
                          </button>
                        </div>
                      </div>
                      <div className="key-moves">
                        {keyResults
                          .filter((r) => filter === "all" || r.label === filter)
                          .map((r) => (
                            <button
                              key={r.ply}
                              className={ply === r.ply ? "selected-key" : ""}
                              onClick={() => {
                                setBranch([]);
                                setPly(r.ply);
                              }}
                            >
                              {badge(r)}
                              <span>
                                {Math.ceil(r.ply / 2)}
                                {r.color === "b" ? "…" : "."} {r.san}
                              </span>
                            </button>
                          ))}
                        {!keyResults.length && (
                          <p className="quiet">
                            No major turning points found at this depth. Explore
                            the moves below.
                          </p>
                        )}
                      </div>
                      <div className="key-navigation">
                        <button onClick={() => jumpKey(-1)}>
                          <ChevronLeft size={16} />
                          Previous
                        </button>
                        <button onClick={() => jumpKey(1)}>
                          Next moment
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                  {game.review?.completed && prefs.advanced && (
                    <div className="phase-summary">
                      {["Opening", "Middlegame", "Endgame"].map((phase) => {
                        const rs = results.filter(
                          (r) =>
                            phaseAt(
                              game.moves,
                              r.ply,
                              game.positions[r.ply],
                            ) === phase,
                        );
                        return (
                          <div key={phase}>
                            <span>{phase}</span>
                            <strong>
                              {rs.length ? accuracy(rs) + "%" : "-"}
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <details
                    className="move-disclosure"
                    open={prefs.advanced ? true : undefined}
                  >
                    <summary>
                      All moves <span>{game.moves.length} moves</span>
                    </summary>
                    <MoveList
                      game={game}
                      ply={ply}
                      onSelect={(n) => {
                        setBranch([]);
                        setPly(n);
                      }}
                      filter={filter}
                    />
                  </details>
                </>
              )}
            </section>
          </main>
        )
      )}
      <footer className="app-footer">
        <span>ChessAsh by FlameDev</span>
        <span>Reviews saved on this device.</span>
      </footer>
      {dialog && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing) setDialog(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "import" ? "Import games" : "Settings"}
          >
            <div className="section-heading">
              <h2>
                {dialog === "import" ? "Bring your games" : "Make it yours"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                disabled={importing}
                onClick={() => setDialog(null)}
              >
                <X size={19} />
              </button>
            </div>
            {dialog === "import" ? (
              <>
                <p>Use your public Chess.com username. No password needed.</p>
                <label>
                  Chess.com username
                  <input
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Your username"
                    disabled={importing}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={useAsMain}
                    onChange={(e) => setUseAsMain(e.target.checked)}
                  />
                  This is my account. Keep it synced.
                </label>
                {accounts.mainUsername && !useAsMain && (
                  <p className="quiet">
                    These games will have their own collection. Your main
                    account stays {accounts.mainUsername}.
                  </p>
                )}
                <div className="import-options">
                  <label>
                    Archives
                    <select
                      value={months}
                      onChange={(e) => setMonths(Number(e.target.value))}
                    >
                      {[1, 3, 6, 12, 24].map((n) => (
                        <option key={n} value={n}>
                          Latest {n} month{n > 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Specific game link (optional)
                    <input
                      value={gameLink}
                      onChange={(e) => setGameLink(e.target.value)}
                      placeholder="https://www.chess.com/game/live/…"
                    />
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={!username.trim() || importing}
                  onClick={() => void importAccount()}
                >
                  {importing
                    ? importStatus || "Fetching games…"
                    : "Fetch finished games"}
                </button>
                <p className="quiet">
                  New games may take time to appear in Chess.com’s public
                  archives.
                </p>
                <div className="divider">Or import a PGN</div>
                <label className="file-input">
                  <FolderOpen size={17} />
                  Choose PGN file
                  <input
                    type="file"
                    accept=".pgn,.txt"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        if (f.size > 2_000_000)
                          throw new Error("PGN must be smaller than 2 MB.");
                        addGames(parsePgnCollection(await f.text()));
                      } catch (x) {
                        setError(err(x));
                      }
                    }}
                  />
                </label>
                <textarea
                  aria-label="Paste PGN"
                  placeholder="Paste PGN moves here…"
                  value={pgn}
                  onChange={(e) => setPgn(e.target.value)}
                />
                <div className="actions">
                  <button
                    disabled={!pgn.trim()}
                    onClick={() => {
                      try {
                        addGames(parsePgnCollection(pgn));
                      } catch (e) {
                        setError(err(e));
                      }
                    }}
                  >
                    Import PGN
                  </button>
                  <button
                    className="text-button"
                    onClick={() => addGames([parsePgn(DEMO, "Sample")])}
                  >
                    Use the Opera game sample
                  </button>
                </div>
              </>
            ) : (
              <>
                <label>
                  Appearance
                  <select
                    value={prefs.theme}
                    onChange={(e) =>
                      setPrefs({ ...prefs, theme: e.target.value })
                    }
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <label>
                  Text size
                  <select
                    value={prefs.font}
                    onChange={(e) =>
                      setPrefs({ ...prefs, font: Number(e.target.value) })
                    }
                  >
                    <option value="16">Standard</option>
                    <option value="18">Large</option>
                    <option value="20">Extra large</option>
                  </select>
                </label>
                {(["sound", "reduced"] as const).map((key) => (
                  <label className="check-label" key={key}>
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={(e) =>
                        setPrefs({ ...prefs, [key]: e.target.checked })
                      }
                    />
                    {{ sound: "Move sounds", reduced: "Reduce motion" }[key]}
                  </label>
                ))}
                <details className="advanced-settings">
                  <summary>Advanced</summary>
                  <p className="quiet">
                    Extra tools for exploring positions and customising your
                    reviews.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.advanced}
                      onChange={(e) => {
                        setPrefs({ ...prefs, advanced: e.target.checked });
                        if (!e.target.checked) setView("review");
                      }}
                    />
                    Show analysis tools
                  </label>
                  <label>
                    Analysis depth
                    <select
                      value={prefs.depth}
                      onChange={(e) =>
                        setPrefs({ ...prefs, depth: Number(e.target.value) })
                      }
                    >
                      <option value="10">Battery saver</option>
                      <option value="12">Standard</option>
                      <option value="16">Deep</option>
                      <option value="20">Extended</option>
                    </select>
                  </label>
                  <p className="quiet">
                    Deeper analysis takes longer. On Android, analysis pauses
                    when you leave the app and can be resumed.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.arrows}
                      onChange={(e) =>
                        setPrefs({ ...prefs, arrows: e.target.checked })
                      }
                    />
                    Show suggestion arrows
                  </label>
                  {isDesktop && (
                    <FoxashPanel
                      onReclassify={async () => {
                        if (!game?.review) return;
                        const review = await analyzeGame(game, {
                          depth: game.review.depth,
                          existing: game.review,
                          classify: async (facts) =>
                            (await window.chessash!.reviewFacts([facts]))[0],
                        });
                        updateGame(game.id, { review });
                      }}
                    />
                  )}
                </details>
                <details className="about-analysis">
                  <summary>About your review</summary>
                  <p className="quiet">
                    Scores and labels are ChessAsh’s own. They can change with
                    deeper analysis and will differ from Chess.com.
                  </p>
                  <p className="quiet">
                    Accuracy averages 100 × exp(−centipawn loss / 300) across
                    your moves. Loss is capped at 1,500 centipawns. This is a
                    guide to this game, not your rating.
                  </p>
                  <p className="quiet">
                    Stockfish 19 lite is included under GPLv3. Source and
                    licences are included with the app. Foxash powers the
                    Windows review rules.
                  </p>
                </details>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function MoveList({
  game,
  ply,
  onSelect,
  filter,
}: {
  game: Game;
  ply: number;
  onSelect: (n: number) => void;
  filter: string;
}) {
  const active = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const button = active.current;
    const scroll = button?.closest(".moves-scroll");
    if (button && scroll) {
      const row = button.parentElement!;
      const target =
        row.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop;
      if (
        target < scroll.scrollTop ||
        target > scroll.scrollTop + scroll.clientHeight - 36
      )
        scroll.scrollTop = target - 60;
    }
  }, [ply]);
  return (
    <div className="move-list">
      <div className="section-heading">
        <h2>Moves</h2>
        <span>
          {filter !== "all" && filter in LABEL_INFO
            ? LABEL_INFO[filter as Label].name
            : "Complete game"}
        </span>
      </div>
      <div className="moves-scroll">
        {Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, i) => (
          <div className="move-pair" key={i}>
            <span>{i + 1}.</span>
            {[i * 2, i * 2 + 1].map((n) => {
              if (!game.moves[n]) return <span key={n} />;
              const r = game.review?.results.find((r) => r.ply === n + 1);
              return (
                <button
                  key={n}
                  ref={ply === n + 1 ? active : undefined}
                  className={`${ply === n + 1 ? "active-move" : ""} ${filter !== "all" && r?.label !== filter ? "dimmed" : ""}`}
                  onClick={() => onSelect(n + 1)}
                >
                  <span>{game.moves[n]}</span>
                  {r && badge(r)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
