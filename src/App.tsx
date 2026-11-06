import { useLanguage } from "./i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { reviewCoaching } from "./core/coaching";
import { playerColorFor } from "./core/perspective";
import { reviewVariationMove } from "./core/variationReview";
import { version as appVersion } from "../package.json";
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
const cp = (n: number, t: (key: string) => string) =>
  Math.abs(n) >= 29000
    ? (n > 0 ? t("White") : t("Black")) + " " + t("mating")
    : (n > 0 ? "+" : "") + (n / 100).toFixed(2);
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const badge = (r: MoveReview, t: (key: string) => string) => (
  <span className={`badge label-${r.label}`} title={t(LABEL_INFO[r.label].name)}>
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

export default function App() {
  const { language, setLanguage, t } = useLanguage();
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
    [focusedSquare, setFocusedSquare] = useState<string | null>(null),
    [retry, setRetry] = useState(false),
    [retryText, setRetryText] = useState("");
  const [branch, setBranch] = useState<string[]>([]),
    [branchIndex, setBranchIndex] = useState(0),
    [branchOrigin, setBranchOrigin] = useState(""),
    [engineResult, setEngineResult] = useState<EngineResult | null>(null),
    [searching, setSearching] = useState(false);
  const [variationState, setVariationState] = useState<{ key: string; review?: { game: Game; result: MoveReview }; error?: string }>({ key: '' });
  const [variationAttempt, setVariationAttempt] = useState(0);
  const [practice, setPractice] = useState<{ game: Game; result: MoveReview } | null>(null);
  const variationCache = useRef(new Map<string, { game: Game; result: MoveReview }>());
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
  const playerColor = game ? playerColorFor(game, accounts.mainUsername) : undefined;
  const initialFen = game?.positions[ply] || new Chess().fen();
  const effectiveFen =
    retry && (practice?.result || current)
      ? (practice?.game || game!).positions[(practice?.result || current!).ply - 1]
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
  const variationPosition = useMemo(() => {
    if (!branch.length || !branchOrigin || !branchIndex) return undefined;
    const board = new Chess(branchOrigin);
    for (const uci of branch.slice(0, branchIndex - 1)) board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { fen: board.fen(), move: branch[branchIndex - 1] };
  }, [branch, branchOrigin, branchIndex]);
  const variationKey = variationPosition ? JSON.stringify([game?.id, variationPosition.fen, variationPosition.move, prefs.depth]) : '';
  const variationReview = variationState.key === variationKey ? variationState.review : undefined;
  const coachGame = retry && practice ? practice.game : branch.length ? variationReview?.game : game;
  const coachResult = retry && practice ? practice.result : branch.length ? variationReview?.result : current;
  const coaching = useMemo(() => coachGame && coachResult ? reviewCoaching(coachGame, coachResult, { playerColor, language }) : undefined, [coachGame, coachResult, playerColor, language]);
  const reviewing = view === "review" && !!coachResult && !retry;
  const focusedThreat = !!coaching?.threat && !!focusedSquare && [coaching.threat.slice(0, 2), coaching.threat.slice(2, 4)].includes(focusedSquare);
  useEffect(() => {
    if (!variationPosition || !variationKey) return;
    const cached = variationCache.current.get(variationKey);
    if (cached) { setVariationState({ key: variationKey, review: cached }); return; }
    const controller = new AbortController();
    setVariationState({ key: variationKey });
    void reviewVariationMove(variationPosition.fen, variationPosition.move, {
      depth: prefs.depth,
      signal: controller.signal,
      classify: isDesktop ? async facts => {
        const row = (await window.chessash!.reviewFacts([facts]))[0];
        if (!row || !LABELS.includes(row.label)) throw new Error('Foxash returned an invalid review label.');
        return row;
      } : undefined,
    }).then(review => {
      if (controller.signal.aborted) return;
      if (variationCache.current.size >= 64) variationCache.current.delete(variationCache.current.keys().next().value!);
      variationCache.current.set(variationKey, review);
      setVariationState({ key: variationKey, review });
    }).catch(error => {
      if (!controller.signal.aborted) setVariationState({ key: variationKey, error: err(error) });
    });
    return () => controller.abort();
  }, [variationKey, isDesktop, variationAttempt]);
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
  useLayoutEffect(() => {
    setFocusedSquare(null);
    setPractice(null);
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
          ? t("Review complete. Select a key moment to begin.")
          : t("Analysis paused. Your progress is saved."),
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
    const retryResult = practice?.result || current;
    const retryGame = practice?.game || game;
    if (retry && retryResult) {
      if (uci === retryResult.best) {
        setRetryText(
          "Found it. Play through the continuation to see the idea.",
        );
        setRetry(false);
    
        preview([retryResult.best], retryGame.positions[retryResult.ply - 1]);
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
        const base = retryGame.positions[retryResult.ply - 1];
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
          preview([uci], retryGame.positions[retryResult.ply - 1]);
          setBranchIndex(1);
          sound();
        } else {
          setRetryText(
            "There is a stronger move. Return to the review to compare it or play the continuation.",
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
      const origin = branch.length ? branchOrigin : effectiveFen;
      const next = [...branch.slice(0, branchIndex), uci];
      setBranchOrigin(origin);
      setBranch(next);
      setBranchIndex(next.length);
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
  const activeScore = (engineResult?.fen === effectiveFen ? engineResult.score : undefined) ?? (retry ? coachResult?.before : coachResult?.after) ?? 0;
  const lastMove = branchIndex ? branch[branchIndex - 1] : current?.move;
  const pawnName = game?.headers.White || t("White"),
    blackName = game?.headers.Black || t("Black");

  return (
    <>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setScreen("board")}
          aria-label={t("ChessAsh board")}
        >
          <span className="brand-mark">
            <Flame size={23} />
          </span>
          Chess<span>Ash</span>
          <small>{appVersion.replace(/\.0$/, "")}</small>
        </button>
        <nav aria-label={t("Main navigation")}>
          <button
            className={screen === "board" ? "nav-active" : ""}
            onClick={() => setScreen("board")}
          >
            <BookOpen size={17} />
            {t("Review")}</button>
          <button
            className={screen === "library" ? "nav-active" : ""}
            onClick={() => {
              setFilter("all");
              setScreen("library");
            }}
          >
            <Library size={17} />
            {t("Library")}<span className="count">{games.length}</span>
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            title={t("Settings")}
            aria-label={t("Settings")}
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
            {t("Import game")}</button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{t(error)}</span>
          <button aria-label={t("Dismiss error")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {t(notice)}
        </div>
      )}
      {!ready ? (
        <main className="empty-state">
          <Flame size={40} />
          <h1>{t("Opening your library…")}</h1>
        </main>
      ) : !game && screen === "board" ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="section-label">{t("A closer look at your chess")}</span>
            <h1>{t("Review your games.")}</h1>
            <p>{t("Import from Chess.com or open a PGN.")}</p>
            <div className="actions">
              <button className="primary" onClick={() => openImport()}>
                <Plus size={18} />
                {t("Import your games")}</button>
              <button onClick={() => addGames([parsePgn(DEMO, "Sample")])}>
                {t("Explore a sample")}</button>
            </div>
            <p className="quiet">{t("Free reviews, saved on your device.")}</p>
          </div>
          <div className="welcome-board">
            <Board
                  language={language}
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
              {t("Game removed.")}<button
                onClick={() => {
                  setGames((gs) => mergeGames(gs, [deleted]));
                  setDeleted(null);
                }}
              >
                <Undo2 size={15} />
                {t("Undo")}</button>
              <button
                aria-label={t("Dismiss undo")}
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
                    {t(openingName(game.moves))}
                  </span>
                  <h1>{game.headers.Event || "Game review"}</h1>
                </div>
                <button
                  className="icon-button"
                  title={t("Export annotated PGN")}
                  aria-label={t("Export annotated PGN")}
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
              <label className="review-perspective">{t("Review as")}
                <select aria-label={t("Review perspective")} value={game.reviewAs || "auto"} onChange={(e) => updateGame(game.id, { reviewAs: e.target.value === "auto" ? undefined : e.target.value as 'w' | 'b' | 'neutral' })}>
                  <option value="auto">{t("My account")}</option>
                  <option value="w">{t("White")}</option>
                  <option value="b">{t("Black")}</option>
                  <option value="neutral">{t("White / Black")}</option>
                </select>
              </label>
              <div className="review-message-slot">
              {view === "review" ? (
                <ReviewMessage
                  language={language}
                  moveNumber={coachGame && coachResult ? Number(coachGame.positions[coachResult.ply - 1].split(' ')[5]) : undefined}
                  onSquare={setFocusedSquare}
                  result={coachResult}
                  text={
                    coachResult
                      ? coaching!.text
                      : branch.length
                        ? variationState.key === variationKey && variationState.error
                          ? t("Move review unavailable. Try again.")
                          : branchIndex ? t("Reviewing your move…") : t("Try a move on the board.")
                      : results.length
                        ? t("Your review is ready. Let’s look at a turning point.")
                        : t("Let’s look at this game together. Start a review to find the moments worth practising.")
                  }
                  detail={coaching?.best}
                  expandedDetail={coaching?.detail}
                  retryText={t(retryText)}
                  retry={retry}
                  busy={busy}
                  hasReview={!branch.length && results.length > 0}
                  onTry={() => {
                    if (!coachGame || !coachResult) return;
                    setPractice({ game: coachGame, result: coachResult });
                    setBranch([]);
                    setRetry(true);
                    setRetryText("Find a strong move on the board.");
                
                  }}
                  onLine={() => {
                    if (!coachResult || !coachGame) return;
                
                    setRetry(false);
                    preview(coachResult.pv, coachGame.positions[coachResult.ply - 1]);
                  }}
                  onExit={() => {
                    setRetry(false);
                    setRetryText("");
                    setPractice(null);
                  }}
                  onStart={() => {
                    setBranch([]);
                    setPly(keyResults[0]?.ply || 1);
                  }}
                />
              ) : <div className="workspace-context"><strong>{view === "analysis" ? t("Explore the position") : t("Tutor")}</strong><p>{t("Your game stays here. Return to Review whenever you want.")}</p></div>}
              </div>
              <div className="review-controls-slot">
                <div className="review-position-controls" aria-label={t("Review position")}>
                  {branch.length > 0 && <div className="temporary-review-tools"><strong className="temporary-review-label">{t("Temporary move review")}</strong><button onClick={() => { setBranch([]); setEngineResult(null); }}>{t("Return to game")}</button></div>}
                  {branch.length > 0 && variationState.key === variationKey && variationState.error && <button onClick={() => setVariationAttempt(n => n + 1)}>{t("Try again")}</button>}
                  <span>{retry ? t("Try a move on the board.") : reviewing ? t("Blue: best alternative. Focus a square in the explanation to see the reply.") : branch.length ? t("This move is outside the saved game.") : t("Select a reviewed move to see the feedback.")}</span>
                </div>
              </div>
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
                  aria-label={t(`Evaluation ${cp(activeScore, t)}`)}
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
                  language={language}
                  key={activeId}
                  fen={effectiveFen}
                  flipped={flipped}
                  onMove={(f, t, p) => void move(f, t, p)}
                  comparison={prefs.arrows && reviewing && !focusedThreat && coachResult && coachGame ? { fen: coachGame.positions[coachResult.ply - 1], move: coachResult.best } : undefined}
                  threat={prefs.arrows && reviewing && focusedThreat ? coaching?.threat : undefined}
                  highlights={[...(focusedSquare ? [focusedSquare] : []), ...(reviewing ? coaching?.targets || [] : [])]}
                  lastMove={retry ? undefined : lastMove}
                  quality={
                    coachResult && !retry
                      ? {
                          square: coachResult.move.slice(2, 4),
                          label: coachResult.label,
                          name: t(LABEL_INFO[coachResult.label].name),
                          key: game.id + ":" + effectiveFen,
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
                  title={t("Flip board")}
                  aria-label={t("Flip board")}
                  onClick={() => setFlipped((f) => !f)}
                >
                  <RotateCw size={18} />
                </button>
                <div className="move-controls">
                  <button
                    aria-label={t("First move")}
                    onClick={() =>
                      branch.length ? setBranchIndex(0) : navigate(0)
                    }
                  >
                    <ChevronsLeft size={21} />
                  </button>
                  <button
                    aria-label={t("Previous move")}
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
                    aria-label={t("Next move")}
                    onClick={() => navigate(ply + 1)}
                  >
                    <ChevronRight size={23} />
                  </button>
                  <button
                    aria-label={t("Last move")}
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
                  aria-label={t("Analysis settings")}
                  title={t("Analysis settings")}
                  onClick={() => setDialog("settings")}
                >
                  <SlidersHorizontal size={18} />
                </button>
              </div>
              {branch.length > 0 && (
                <div className="variation-strip">
                  <span>
                    {t("Exploring")}{" "}
                    {variationSan(branchOrigin, branch)
                      .slice(0, branchIndex)
                      .join(" ") || t("starting position")}
                  </span>
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
                    {t("Game advantage")}<span>{t("Who had the edge?")}</span>
                  </summary>
                  <p>
                    {t("Above the middle favours White. Below favours Black. Select a point to revisit that moment.")}</p>
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
                    {t("Stockfish 19 lite / depth")}{" "}
                    {game.review?.depth || prefs.depth}
                  </span>
                  <span>
                    {game.review?.completed
                      ? t("Saved on this device")
                      : t('Moves analysed: {done}/{total}', { done: results.length, total: game.moves.length })}
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
                  {t("Review")}</button>
                {(
                  <button
                    role="tab"
                    aria-selected={view === "analysis"}
                    className={view === "analysis" ? "active" : ""}
                    onClick={() => setView("analysis")}
                  >
                    <Search size={16} />
                    {t("Explore")}</button>
                )}
                {isDesktop && (
                  <button
                    role="tab"
                    aria-selected={view === "tutor"}
                    className={view === "tutor" ? "active" : ""}
                    onClick={() => setView("tutor")}
                  >
                    <MessageSquare size={16} />
                    {t("Tutor")}</button>
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
                    <h2>{t("Explore the position")}</h2>
                    <span>
                      {new Chess(effectiveFen).turn() === "w"
                        ? t("White")
                        : t("Black")}{" "}
                      {t("to move")}</span>
                  </div>
                  <p>
                    {t("Move pieces to explore an alternative. Ask the engine to compare candidate lines.")}</p>
                  <button
                    className="primary"
                    disabled={searching || busy}
                    onClick={() => void evaluate()}
                  >
                    {searching ? t("Evaluating…") : t("Evaluate position")}
                  </button>
                  {searching && (
                    <button onClick={() => positionAbort.current?.abort()}>
                      {t("Stop")}</button>
                  )}
                  {engineResult && (
                    <div className="engine-lines">
                      <div className="section-heading">
                        <strong>{cp(engineResult.score, t)}</strong>
                        <span>{t("Depth")} {engineResult.depth}</span>
                      </div>
                      {engineResult.lines.map((l, i) => (
                        <button
                          key={i}
                          onClick={() => preview(l.pv, effectiveFen)}
                        >
                          <strong>{cp(l.score, t)}</strong>
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
                    {t("Position notes")}<textarea
                      placeholder={t("What did you notice?")}
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
                          ? t("Your review")
                          : t("Review this game")}
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
                        {t("Find the moments that mattered and try a better move.")}</p>
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
                              ? t("Analysing…")
                              : results.length
                                ? t("Continue review")
                                : t("Start review")}
                          </button>
                          {busy && (
                            <button
                              aria-label={t("Pause analysis")}
                              onClick={() => abort.current?.abort()}
                            >
                              <Square size={14} />
                              {t("Pause")}</button>
                          )}
                          {prefs.advanced && <span>{t("Depth")} {prefs.depth}</span>}
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
                        {t("Review saved")}<button
                          onClick={() => void runReview()}
                          disabled={busy}
                        >
                          {t("Reanalyse")}</button>
                      </div>
                    )}
                    {results.length > 0 && (
                      <details className="quality-details">
                        <summary>
                          {t("Move quality")}<span>{t("Both players")}</span>
                        </summary>
                        <div className="classifications">
                          {LABELS.map((label) => (
                            <button
                              title={t(LABEL_INFO[label].description)}
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
                              <span>{t(LABEL_INFO[label].name)}</span>
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
                        <h2>{t("Turning points")}</h2>
                        <div className="segmented">
                          <button
                            className={short ? "active" : ""}
                            onClick={() => setShort(true)}
                          >
                            {t("Short")}</button>
                          <button
                            className={!short ? "active" : ""}
                            onClick={() => setShort(false)}
                          >
                            {t("Full")}</button>
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
                              {badge(r, t)}
                              <span>
                                {Math.ceil(r.ply / 2)}
                                {r.color === "b" ? "…" : "."} {r.san}
                              </span>
                            </button>
                          ))}
                        {!keyResults.length && (
                          <p className="quiet">
                            {t("No major turning points found at this depth. Explore the moves below.")}</p>
                        )}
                      </div>
                      <div className="key-navigation">
                        <button onClick={() => jumpKey(-1)}>
                          <ChevronLeft size={16} />
                          {t("Previous")}</button>
                        <button onClick={() => jumpKey(1)}>
                          {t("Next moment")}<ChevronRight size={16} />
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
                            <span>{t(phase)}</span>
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
                      {t("All moves")}<span>{game.moves.length} {t("moves")}</span>
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
        <span>{t("ChessAsh by FlameDev")}</span>
        <span>{t("Reviews saved on this device.")}</span>
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
            aria-label={dialog === "import" ? t("Import games") : t("Settings")}
          >
            <div className="section-heading">
              <h2>
                {dialog === "import" ? t("Bring your games") : t("Make it yours")}
              </h2>
              <button
                className="icon-button"
                aria-label={t("Close dialog")}
                disabled={importing}
                onClick={() => setDialog(null)}
              >
                <X size={19} />
              </button>
            </div>
            {dialog === "import" ? (
              <>
                <p>{t("Use your public Chess.com username. No password needed.")}</p>
                <label>
                  {t("Chess.com username")}<input
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("Your username")}
                    disabled={importing}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={useAsMain}
                    onChange={(e) => setUseAsMain(e.target.checked)}
                  />
                  {t("This is my account. Keep it synced.")}</label>
                {accounts.mainUsername && !useAsMain && (
                  <p className="quiet">
                    {t("These games will have their own collection. Your main account stays")}{accounts.mainUsername}.
                  </p>
                )}
                <div className="import-options">
                  <label>
                    {t("Archives")}<select
                      value={months}
                      onChange={(e) => setMonths(Number(e.target.value))}
                    >
                      {[1, 3, 6, 12, 24].map((n) => (
                        <option key={n} value={n}>
                          {t(`Latest ${n} month${n > 1 ? 's' : ''}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Specific game link (optional)")}<input
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
                    ? t(importStatus || "Fetching games…")
                    : t("Fetch finished games")}
                </button>
                <p className="quiet">
                  {t("New games may take time to appear in Chess.com’s public archives.")}</p>
                <div className="divider">{t("Or import a PGN")}</div>
                <label className="file-input">
                  <FolderOpen size={17} />
                  {t("Choose PGN file")}<input
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
                  aria-label={t("Paste PGN")}
                  placeholder={t("Paste PGN moves here…")}
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
                    {t("Import PGN")}</button>
                  <button
                    className="text-button"
                    onClick={() => addGames([parsePgn(DEMO, "Sample")])}
                  >
                    {t("Use the Opera game sample")}</button>
                </div>
              </>
            ) : (
              <>
                <label>
                  {t("Language")}<select id="app-language" aria-label={t("Language")} value={language} onChange={e => setLanguage(e.target.value as "en" | "it")}><option value="en">English</option><option value="it">Italiano</option></select>
                </label>
                <label>
                  {t("Appearance")}<select
                    value={prefs.theme}
                    onChange={(e) =>
                      setPrefs({ ...prefs, theme: e.target.value })
                    }
                  >
                    <option value="dark">{t("Dark")}</option>
                    <option value="light">{t("Light")}</option>
                  </select>
                </label>
                <label>
                  {t("Text size")}<select
                    value={prefs.font}
                    onChange={(e) =>
                      setPrefs({ ...prefs, font: Number(e.target.value) })
                    }
                  >
                    <option value="16">{t("Standard")}</option>
                    <option value="18">{t("Large")}</option>
                    <option value="20">{t("Extra large")}</option>
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
                    {t({ sound: "Move sounds", reduced: "Reduce motion" }[key])}
                  </label>
                ))}
                <details className="advanced-settings">
                  <summary>{t("Advanced")}</summary>
                  <p className="quiet">
                    {t("Extra tools for exploring positions and customising your reviews.")}</p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.advanced}
                      onChange={(e) => {
                        setPrefs({ ...prefs, advanced: e.target.checked });
                        if (!e.target.checked) setView("review");
                      }}
                    />
                    {t("Show analysis tools")}</label>
                  <label>
                    {t("Analysis depth")}<select
                      value={prefs.depth}
                      onChange={(e) =>
                        setPrefs({ ...prefs, depth: Number(e.target.value) })
                      }
                    >
                      <option value="10">{t("Battery saver")}</option>
                      <option value="12">{t("Standard")}</option>
                      <option value="16">{t("Deep")}</option>
                      <option value="20">{t("Extended")}</option>
                    </select>
                  </label>
                  <p className="quiet">
                    {t("Deeper analysis takes longer. On Android, analysis pauses when you leave the app and can be resumed.")}</p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.arrows}
                      onChange={(e) =>
                        setPrefs({ ...prefs, arrows: e.target.checked })
                      }
                    />
                    {t("Show suggestion arrows")}</label>
                  {isDesktop && (
                    <FoxashPanel
                      onReclassify={async () => {
                        variationCache.current.clear();
                        setVariationAttempt(n => n + 1);
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
                  <summary>{t("About your review")}</summary>
                  <p className="quiet">
                    {t("Scores and labels are ChessAsh’s own. They can change with deeper analysis and will differ from Chess.com.")}</p>
                  <p className="quiet">
                    {t("Accuracy averages 100 × exp(−centipawn loss / 300) across your moves. Loss is capped at 1,500 centipawns. This is a guide to this game, not your rating.")}</p>
                  <p className="quiet">
                    {t("Stockfish 19 lite is included under GPLv3. Source and licences are included with the app. Foxash powers the Windows review rules.")}</p>
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
  const { t } = useLanguage();
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
        <h2>{t("Moves")}</h2>
        <span>
          {filter !== "all" && filter in LABEL_INFO
            ? t(LABEL_INFO[filter as Label].name)
            : t("Complete game")}
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
                  {r && badge(r, t)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
