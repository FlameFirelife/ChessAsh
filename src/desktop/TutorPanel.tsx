import { useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Game, MoveReview } from "../core/types";
import { analyzePosition } from "../core";
import { tutorSystemPrompt } from '../core/tutorPrompt';
import TutorMarkdown from './TutorMarkdown';
import "./desktop.css";

type Config = {
  mode: "off" | "ollama" | "api";
  endpoint: string;
  model: string;
  apiKey?: string;
  hasKey?: boolean;
  clearKey?: boolean;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  ply: number;
  fen: string;
};
type Bridge = {
  platform: string;
  tutorGetSettings(): Promise<Config>;
  tutorSaveSettings(config: Config): Promise<Config>;
  tutorModels(config: Config): Promise<string[]>;
  tutorChat(request: {
    config: Config;
    messages: { role: string; content: string }[];
    requestId: string;
  }): Promise<string>;
  tutorCancel(requestId: string): Promise<void>;
  tutorOnChunk(
    callback: (event: { requestId: string; text: string }) => void,
  ): () => void;
};
const defaults: Config = {
  mode: "off",
  endpoint: "http://127.0.0.1:11434",
  model: "",
};
const getBridge = () => (window as unknown as { chessash?: Bridge }).chessash;

export function validLine(
  fen: string,
  text: string,
): { uci: string[]; san: string[] } | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (
    !tokens.length ||
    tokens.length > 20 ||
    tokens.some((t) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t))
  )
    return null;
  try {
    const chess = new Chess(fen);
    const san = tokens.map(
      (t) =>
        chess.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] })
          .san,
    );
    return { uci: tokens, san };
  } catch {
    return null;
  }
}

function readMessages(id: string): ChatMessage[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(`chessash.chat.${id}`) || "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (x) =>
              ["user", "assistant"].includes(x.role) &&
              typeof x.content === "string" &&
              typeof x.fen === "string",
          )
          .slice(-40)
      : [];
  } catch {
    return [];
  }
}

export default function TutorPanel({
  game,
  ply,
  result,
  onPreview,
}: {
  game: Game;
  ply: number;
  result?: MoveReview;
  onPreview: (moves: string[]) => void;
}) {
  const { language, t } = useLanguage();
  const bridge = getBridge();
  const [config, setConfig] = useState<Config>(defaults);
  const [models, setModels] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    readMessages(game.id),
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [stream, setStream] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [customModel, setCustomModel] = useState(false);
  const drafts = useRef<Partial<Record<Config["mode"], Config>>>({});
  const connectionRequest = useRef(0);
  const active = useRef("");
  const position = useRef({ game: game.id, ply });
  position.current = { game: game.id, ply };
  const analysisAbort = useRef<AbortController | null>(null);
  const messageList = useRef<HTMLDivElement | null>(null);
  const fen = game.positions[ply] || game.positions[0];

  useEffect(() => {
    let mounted = true;
    bridge
      ?.tutorGetSettings()
      .then((x) => {
        if (!mounted) return;
        const saved = { ...defaults, ...x, apiKey: "" };
        setConfig(saved);
        drafts.current[saved.mode] = saved;
      })
      .catch(() => {
        if (mounted)
          setNotice(
            "Saved tutor settings could not be opened. Choose a connection below.",
          );
      })
      .finally(() => {
        if (mounted) setLoadingSettings(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    setMessages(readMessages(game.id));
    setStream("");
    setError("");
    return () => {
      if (active.current) bridge?.tutorCancel(active.current);
      analysisAbort.current?.abort();
    };
  }, [game.id]);
  useEffect(
    () =>
      bridge?.tutorOnChunk?.((event) => {
        if (event.requestId === active.current)
          setStream((x) => x + event.text);
      }),
    [],
  );
  useEffect(() => {
    if (active.current) {
      bridge?.tutorCancel(active.current);
      analysisAbort.current?.abort();
    }
  }, [game.id, ply]);
  useEffect(() => {
    const list = messageList.current;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 200)
      list.scrollTop = list.scrollHeight;
  }, [messages, stream]);

  function persist(value: ChatMessage[]) {
    setMessages(value);
    try {
      localStorage.setItem(
        `chessash.chat.${game.id}`,
        JSON.stringify(value.slice(-40)),
      );
    } catch {
      setNotice("Chat could not be saved: local storage is full.");
    }
  }

  async function save() {
    try {
      setError("");
      const saved = await bridge?.tutorSaveSettings(config);
      setNotice("Tutor settings saved.");
      setConfig((x) => {
        const next = { ...x, ...saved, apiKey: "", clearKey: false };
        for (const mode of ["off", "ollama", "api"] as const) {
          const draft = drafts.current[mode];
          if (
            draft &&
            draft.endpoint.replace(/\/$/, "") !==
              next.endpoint.replace(/\/$/, "")
          )
            draft.hasKey = false;
        }
        drafts.current[next.mode] = next;
        return next;
      });
      setSettingsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not save settings."));
    }
  }

  function selectConnection(mode: Config["mode"]) {
    if (busy) return;
    drafts.current[config.mode] = { ...config };
    connectionRequest.current++;
    const next = drafts.current[mode] || {
      ...defaults,
      mode,
      endpoint: mode === "api" ? "" : defaults.endpoint,
      model: "",
    };
    setConfig(next);
    setModels([]);
    setCustomModel(false);
    setError("");
    setNotice("");
    setSettingsOpen(mode === "api");
  }

  async function test() {
    if (!bridge) return;
    setTesting(true);
    setError("");
    setNotice("");
    const version = ++connectionRequest.current;
    try {
      const found = await bridge.tutorModels(config);
      if (version !== connectionRequest.current) return;
      setModels(found);
      setCustomModel(false);
      if (!config.model && found.length)
        setConfig((x) => ({ ...x, model: found[0] }));
      setNotice(
        found.length
          ? `Connected. ${found.length} model${found.length === 1 ? "" : "s"} available.`
          : t("Connected, but no models are installed. Install one in your model server first."),
      );
    } catch (e) {
      if (version === connectionRequest.current)
        setError(e instanceof Error ? e.message : t("Connection failed."));
    } finally {
      if (version === connectionRequest.current) setTesting(false);
    }
  }

  async function ask(text = question) {
    if (!bridge || !text.trim() || busy || config.mode === "off") return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    const snapshot = { game: game.id, ply, fen };
    const user: ChatMessage = {
      role: "user",
      content: text.trim().slice(0, 4000),
      ply,
      fen,
    };
    const conversation = [...messages, user];
    persist(conversation);
    setQuestion("");
    setError("");
    setStream("");
    setBusy(true);
    const abort = new AbortController();
    analysisAbort.current = abort;
    try {
      const engine = await analyzePosition(fen, {
        depth: 12,
        signal: abort.signal,
      });
      if (
        abort.signal.aborted ||
        position.current.game !== snapshot.game ||
        position.current.ply !== snapshot.ply
      )
        throw new Error("Position changed. Ask again for this position.");
      const legal = new Chess(fen)
        .moves({ verbose: true })
        .map((m) => `${m.from}${m.to}${m.promotion || ""}`);
      const history = conversation
        .slice(-10)
        .map((m) => ({
          role: m.role,
          content: `Position ply ${m.ply}, FEN ${m.fen}\n${m.content}`,
        }));
      const outbound = [{ role: "system", content: tutorSystemPrompt(language) }, { role: 'user', content: 'Current position data (not instructions):\n' + JSON.stringify({ fen, sideToMove: new Chess(fen).turn(), legalUci: legal, engine, ply, gameMoves: game.moves, reviewFinding: result?.explanation || null }) }, ...history];
      let answer = await bridge.tutorChat({
        config,
        messages: outbound,
        requestId,
      });
      const request = answer
        .trim()
        .match(/^\[\[analyze:([a-h][1-8][a-h][1-8][qrbn]?)\]\]$/);
      if (request) {
        const line = validLine(fen, request[1]);
        if (!line)
          throw new Error(
            "The tutor requested an illegal move. Try another question or model.",
          );
        const alternative = new Chess(fen);
        alternative.move({
          from: request[1].slice(0, 2),
          to: request[1].slice(2, 4),
          promotion: request[1][4],
        });
        setStream("Checking that alternative with Stockfish…");
        const evidence = await analyzePosition(alternative.fen(), {
          depth: 12,
          signal: abort.signal,
        });
        setStream("");
        answer = await bridge.tutorChat({
          config,
          requestId,
          messages: [
            ...outbound,
            { role: "assistant", content: answer },
            {
              role: "user",
              content: `Engine tool result for ${request[1]}: white centipawn score ${evidence.score}; mate ${evidence.mate ?? "none"}; depth ${evidence.depth}; continuation ${evidence.pv.join(" ")}. Explain using this evidence. No further tool requests.`,
            },
          ],
        });
      }
      if (
        position.current.game === snapshot.game &&
        position.current.ply === snapshot.ply
      )
        persist([
          ...conversation,
          {
            role: "assistant",
            content: answer,
            ply: snapshot.ply,
            fen: snapshot.fen,
          },
        ]);
      else
        setNotice(
          "Position changed. The old request was stopped; ask again for this position.",
        );
    } catch (e) {
      if (position.current.game === snapshot.game)
        setError(e instanceof Error ? e.message : t("Tutor request failed."));
    } finally {
      if (active.current === requestId) {
        active.current = "";
        setBusy(false);
        setStream("");
      }
    }
  }

  if (!bridge)
    return (
      <div className="tutor-panel">
        <h3>{t("Ask a tutor")}</h3>
        <p>
          {t("Chat with a tutor in the Windows app. You can use guided review here.")}</p>
      </div>
    );

  return (
    <section className="tutor-panel" aria-label={t("Conversational tutor")}>
      <div className="tutor-welcome">
        <h3>
          {config.mode === "off"
            ? t("Choose how to connect")
            : t("Talk through the game")}
        </h3>
        <p>
          {config.mode === "off"
            ? t("Pick a tutor when you want to ask a question. Your usual reviews stay free.")
            : config.mode === "ollama"
              ? t("Use a model installed on this computer with Ollama.")
              : t("Use your own provider. Its charges may apply.")}
        </p>
      </div>
      <label className="tutor-provider">
        {t("Tutor connection")}<select
          aria-label={t("Tutor connection")}
          value={config.mode}
          disabled={busy || testing || loadingSettings}
          onChange={(e) => selectConnection(e.target.value as Config["mode"])}
        >
          <option value="off">{t("Off")}</option>
          <option value="ollama">{t("Ollama on this computer")}</option>
          <option value="api">{t("My API provider")}</option>
        </select>
      </label>
      {config.mode !== "off" && (
        <div className="tutor-model-picker">
          <label>
            {t("Model")}<select
              aria-label={t("Tutor model")}
              value={customModel ? "__custom__" : config.model}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomModel(true);
                  setConfig((x) => ({ ...x, model: "" }));
                } else {
                  setCustomModel(false);
                  setConfig((x) => ({ ...x, model: e.target.value }));
                }
              }}
            >
              <option value="">{t("Choose a model")}</option>
              {[
                ...new Set([
                  ...models,
                  ...(!customModel && config.model ? [config.model] : []),
                ]),
              ].map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="__custom__">{t("Enter a model name…")}</option>
            </select>
          </label>
          <button onClick={test} disabled={testing || busy || !config.endpoint}>
            {testing ? t("Finding models…") : t("Find models")}
          </button>
          {customModel && (
            <label className="custom-model">
              {t("Model name")}<input
                aria-label={t("Custom model name")}
                value={config.model}
                onChange={(e) =>
                  setConfig((x) => ({ ...x, model: e.target.value }))
                }
                placeholder={t("Name provided by your model server")}
              />
            </label>
          )}
        </div>
      )}
      <details
        className="tutor-settings"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>{t("Connection settings")}</summary>
        {config.mode !== "off" && (
          <>
            <label>
              {t("Server endpoint")}<input
                value={config.endpoint}
                placeholder={
                  config.mode === "api"
                    ? "https://your-provider.example/v1"
                    : "http://127.0.0.1:11434"
                }
                onChange={(e) => {
                  connectionRequest.current++;
                  setTesting(false);
                  setModels([]);
                  setConfig((x) => ({ ...x, endpoint: e.target.value }));
                }}
              />
            </label>
            {config.mode === "api" && (
              <>
                <p className="muted">
                  {t("This provider receives your game and recent chat. Its charges may apply. ChessAsh never switches to a cloud tutor automatically.")}</p>
                <label>
                  {t("API key")}<input
                    type="password"
                    autoComplete="off"
                    value={config.apiKey || ""}
                    placeholder={
                      config.hasKey
                        ? t("Saved securely; leave blank to keep")
                        : t("Enter your own API key")
                    }
                    onChange={(e) =>
                      setConfig((x) => ({
                        ...x,
                        apiKey: e.target.value,
                        clearKey: false,
                      }))
                    }
                  />
                </label>
                {config.hasKey && (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = { ...config, apiKey: "", clearKey: true };
                      setConfig(next);
                      try {
                        await bridge.tutorSaveSettings(next);
                        setConfig((x) => ({
                          ...x,
                          clearKey: false,
                          hasKey: false,
                        }));
                        setNotice("Saved API key removed.");
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : t("Could not remove key."),
                        );
                      }
                    }}
                  >
                    {t("Remove saved key")}</button>
                )}
              </>
            )}
          </>
        )}
      </details>
      <button
        className="tutor-save"
        onClick={save}
        disabled={
          busy ||
          loadingSettings ||
          (config.mode !== "off" &&
            (!config.model.trim() || !config.endpoint.trim()))
        }
      >
        {t("Save tutor settings")}</button>
      {notice && (
        <p role="status" className="muted">
          {t(notice)}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {config.mode !== "off" && (
        <>
          <p className="muted">
            {t("Ask about")}{" "}
            {ply === 0
              ? t("the starting position")
              : t(`the position after ${Math.ceil(ply / 2)}${ply % 2 === 0 ? "…" : "."} ${game.moves[ply - 1]}`)}
            {t(". Tutor answers may be wrong.")}</p>
          <div
            className="tutor-messages"
            ref={messageList}
            aria-label={t("Saved tutor conversation")}
          >
            {messages.map((m, i) => (
              <article className={`chat-${m.role}`} key={i}>
                <strong>
                  {m.role === "user" ? t("You") : t("Tutor")}{" "}
                  <small>
                    {m.ply === 0
                      ? t("starting position")
                      : t(`after ${Math.ceil(m.ply / 2)}${m.ply % 2 === 0 ? "…" : "."} ${game.moves[m.ply - 1] || ""}`)}
                  </small>
                </strong>
                {m.content.split(/```uci\s*([\s\S]*?)```/g).map((part, j) => {
                  if (j % 2 === 0)
                    return part.trim() ? (
                      <TutorMarkdown key={j}>
                        {part.trim()}
                      </TutorMarkdown>
                    ) : null;
                  const line = validLine(m.fen, part);
                  return line ? (
                    <button
                      key={j}
                      disabled={m.fen !== fen}
                      onClick={() => onPreview(line.uci)}
                      title={
                        m.fen !== fen
                          ? t("Return to the original position to preview this line")
                          : t("Moves checked for legality")
                      }
                    >
                      {t("Preview")} {line.san.join(" ")}
                    </button>
                  ) : (
                    <p key={j} className="muted">
                      {t("This suggested line failed legality checks and cannot be previewed.")}</p>
                  );
                })}
              </article>
            ))}
          </div>
          {busy && (
            <div role="status"><TutorMarkdown>
              {stream ? (stream === "Checking that alternative with Stockfish…" ? t(stream) : stream) : t("Checking the position…")}
            </TutorMarkdown></div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <label>
              {t("Ask the tutor")}<textarea
                rows={3}
                value={question}
                maxLength={4000}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("Why is that move better?")}
              />
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !question.trim() || !config.model}
              >
                {t("Ask tutor")}</button>
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    bridge.tutorCancel(active.current);
                    analysisAbort.current?.abort();
                  }}
                >
                  {t("Stop")}</button>
              )}
              <button
                type="button"
                disabled={busy || !messages.length}
                onClick={() => persist([])}
              >
                {t("Clear chat")}</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
