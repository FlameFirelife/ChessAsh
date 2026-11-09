import { useLanguage } from "../i18n";
import { useMemo, useState } from 'react';
import { Check, ChevronDown, CloudDownload, FolderOpen, Plus, RefreshCw, Search, Star, Trash2, UserRound } from 'lucide-react';
import type { Game } from '../core/types';
import { openingName } from '../core/openings';
import { groupAccountGames } from '../accounts/model';
import type { AccountGroup } from '../accounts/model';
import { accountTitle } from '../core/accountIdentity';
import '../accounts/accounts.css';

export interface AccountLibraryProps {
  games: Game[];
  mainUsername: string;
  onMainUsernameChange: (username: string) => void | boolean;
  onSync: () => void | Promise<void>;
  syncing: boolean;
  lastSynced: number;
  syncError?: string;
  onOpen: (game: Game) => void;
  onDelete: (game: Game) => void;
  onImport?: () => void;
}

function Group({ group, mainUsername, onMainUsernameChange, onOpen, onDelete, query, status, result, time }: {
  group: AccountGroup; mainUsername: string; onMainUsernameChange: AccountLibraryProps['onMainUsernameChange']; onOpen: AccountLibraryProps['onOpen']; onDelete: AccountLibraryProps['onDelete']; query: string; status: string; result: string; time: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(group.kind === 'main' || group.kind === 'files' || group.kind === 'earlier');
  const filtered = group.games.filter(game => {
    const text = [game.headers.White, game.headers.Black, openingName(game.moves), game.headers.Date].join(' ').toLowerCase();
    return text.includes(query.toLowerCase()) && (status === 'all' || (status === 'reviewed' ? game.review?.completed : !game.review?.completed)) && (result === 'all' || game.headers.Result === result) && (time === 'all' || game.timeClass === time);
  });
  const expanded = open || !!query || status !== 'all' || result !== 'all' || time !== 'all';
  return <section className={`account-container account-${group.kind}`} aria-label={group.username ? t(`Games imported for ${group.title}`) : t(group.title)}>
    <header className="account-heading">
      <button className="account-toggle" aria-expanded={expanded} aria-controls={`account-games-${group.id}`} onClick={() => setOpen(value => !value)}>
        <span className="account-avatar">{group.kind === 'main' ? <Star size={22} /> : group.username ? <UserRound size={22} /> : <FolderOpen size={22} />}</span>
        <span className="account-title"><strong>{group.username ? group.title : t(group.title)}</strong><small>{group.kind === 'main' ? t("Your main account") : group.kind === 'guest' ? t("Imported player") : t("Saved on this device")}</small></span>
        <span className="account-count">{group.games.length} {group.games.length === 1 ? t("game") : t("games")}</span>
        <ChevronDown size={18} className={expanded ? 'account-chevron expanded' : 'account-chevron'} />
      </button>
      {group.username && group.username !== mainUsername && <button className="make-main" onClick={() => onMainUsernameChange(group.username!)} title={t("Keep this player's latest games synced")}>{t("Make main")}</button>}
    </header>
    {expanded && <div className="account-games" id={`account-games-${group.id}`}>
      {filtered.map(game => <div className="account-game-row game-row" key={game.id}>
        <button className="account-game-title game-title" onClick={() => onOpen(game)}><strong>{game.headers.White || t('White')} <span>{t("vs")}</span> {game.headers.Black || t('Black')}</strong><small>{t(openingName(game.moves))} <span className="account-game-date">/ {game.headers.Date || t('Unknown date')}</span></small></button>
        <span className="account-result">{game.headers.Result || '*'}</span>
        <span className={`account-review-status ${game.review?.completed ? 'complete' : ''}`}>{game.review?.completed ? <><Check size={14} />{t("Reviewed")}</> : game.review ? t("In progress") : t("To review")}</span>
        <button className="icon-button account-delete" aria-label={t(`Delete game ${game.headers.White} versus ${game.headers.Black}`)} onClick={() => onDelete(game)}><Trash2 size={16} /></button>
      </div>)}
      {!filtered.length && <div className="account-empty"><FolderOpen size={24} /><p>{group.games.length ? t("No games match these filters.") : group.kind === 'main' ? t("Your next finished games will appear here.") : t("No games in this collection yet.")}</p></div>}
    </div>}
  </section>;
}

export default function AccountLibrary({ games, mainUsername, onMainUsernameChange, onSync, syncing, lastSynced, syncError, onOpen, onDelete, onImport }: AccountLibraryProps) {
  const { language, t } = useLanguage();
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [result, setResult] = useState('all'), [time, setTime] = useState('all');
  const [mainDraft, setMainDraft] = useState('');
  const groups = useMemo(() => groupAccountGames(games, mainUsername), [games, mainUsername]);
  return <main className="library-page account-library">
    <div className="page-heading"><div><h1>{t("Your library")}</h1><p>{t("Your games and the players you follow, kept apart.")}</p></div><button className="primary" onClick={onImport}><Plus size={18} />{t("Import games")}</button></div>
    <div className="account-sync-strip">
      <CloudDownload size={22} />
      {mainUsername ? <><div><strong>{accountTitle(mainUsername)}</strong><span>{syncing ? t("Checking for new games…") : lastSynced ? t(`Last checked ${new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : t("Ready to check for new games")}<small>{t("Syncs while ChessAsh is open. Public archives can be delayed.")}</small></span></div><button onClick={() => void onSync()} disabled={syncing}><RefreshCw size={16} className={syncing ? 'account-refresh spinning' : 'account-refresh'} />{syncing ? t("Syncing…") : t("Check now")}</button></> : <><div><strong>{t("Keep your own games up to date")}</strong><span>{t("Choose your main Chess.com username.")}</span></div><form onSubmit={event => { event.preventDefault(); onMainUsernameChange(mainDraft); }}><input aria-label={t("Main Chess.com username")} value={mainDraft} onChange={event => setMainDraft(event.target.value)} placeholder={t("Your username")} autoComplete="off" /><button className="primary" disabled={!mainDraft.trim()}>{t("Set main account")}</button></form></>}
    </div>
    {syncError && <p className="account-sync-error" role="status">{t(syncError)} {t("Your saved games are still available.")}</p>}
    <div className="library-filters"><label className="search"><Search size={17} /><input aria-label={t("Search saved games")} placeholder={t("Search player, opening or date")} value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label={t("Review status")} value={status} onChange={event => setStatus(event.target.value)}><option value="all">{t("All games")}</option><option value="reviewed">{t("Reviewed")}</option><option value="unreviewed">{t("To review")}</option></select><select aria-label={t("Game result")} value={result} onChange={event => setResult(event.target.value)}><option value="all">{t("Any result")}</option><option>1-0</option><option>0-1</option><option>1/2-1/2</option></select><select aria-label={t("Time control")} value={time} onChange={event => setTime(event.target.value)}><option value="all">{t("Any time control")}</option>{['bullet', 'blitz', 'rapid', 'daily'].map(control => <option key={control} value={control}>{t(control)}</option>)}</select></div>
    <div className="account-collections">{groups.map(group => <Group key={group.id + ':' + (group.kind === 'main')} group={group} mainUsername={mainUsername} onMainUsernameChange={onMainUsernameChange} onOpen={onOpen} onDelete={onDelete} query={query} status={status} result={result} time={time} />)}</div>
    {!groups.length && <div className="empty-state"><FolderOpen size={34} /><h2>{t("A home for your games")}</h2><p>{t("Import your games or explore another player's collection.")}</p><button onClick={onImport}>{t("Import a game")}</button></div>}
  </main>;
}
