import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Game } from '../core/types';
import { importChessCom, importLichess } from '../core/importer';
import { accountIdentity } from '../core/accountIdentity';
import { associateGames, mergeAccountGames, migrateLegacyAccount, normaliseUsername, validUsername } from './model';
import { AccountSyncCoordinator, SYNC_INTERVAL } from './sync';
import type { SyncSnapshot } from './sync';

const MAIN_KEY = 'chessash:main-username';
const TIMES_KEY = 'chessash:account-sync-times';
const empty: SyncSnapshot = { syncing: false, lastSynced: 0, lastAttempt: 0, nextCheck: 0, failures: 0, error: '' };
const read = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
const readTimes = (): Record<string, number> => { try { return JSON.parse(read(TIMES_KEY) || '{}'); } catch { return {}; } };
export function canAutoSync(): boolean { return !document.hidden && navigator.onLine !== false; }

export function useAccounts({ games, setGames, ready = true }: {
  games: Game[]; setGames: Dispatch<SetStateAction<Game[]>>; ready?: boolean; onNotice?: (message: string) => void;
}) {
  const [mainUsername, setMain] = useState(() => { const stored = normaliseUsername(read(MAIN_KEY)); return validUsername(stored) ? stored : ''; });
  const [state, setState] = useState<SyncSnapshot>(empty);
  const [configError, setConfigError] = useState('');
  const mainRef = useRef(mainUsername); mainRef.current = mainUsername;
  const setters = useRef({ setGames }); setters.current = { setGames };
  const controller = useRef<AccountSyncCoordinator | null>(null);
  if (!controller.current) controller.current = new AccountSyncCoordinator({
    fetchGames: (key, progress, months) => { const identity = accountIdentity(key); return identity.provider === 'lichess' ? importLichess(identity.username, progress, months) : importChessCom(identity.username, progress, months); },
    commit: incoming => setters.current.setGames(previous => mergeAccountGames(previous, incoming)),
    hydrate: name => readTimes()[name] || 0,
    onState: (name, snapshot) => {
      if (name === mainRef.current) setState(snapshot);
      if (snapshot.lastSynced) write(TIMES_KEY, JSON.stringify({ ...readTimes(), [name]: snapshot.lastSynced }));
    },
  });
  useEffect(() => {
    if (!ready) return;
    setGames(previous => migrateLegacyAccount(previous, read('chessash:username')));
  }, [ready, setGames]);
  useEffect(() => {
    if (!ready || !mainUsername) { setState(empty); return; }
    setState(controller.current!.snapshot(mainUsername));
    const check = () => { void controller.current!.sync(mainUsername, { eligible: canAutoSync() }).catch(() => {}); };
    check();
    const interval = setInterval(check, SYNC_INTERVAL);
    window.addEventListener('focus', check); window.addEventListener('online', check); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(interval); window.removeEventListener('focus', check); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check); };
  }, [mainUsername, ready]);
  function setMainUsername(username: string): boolean {
    const name = normaliseUsername(username);
    if (name && !validUsername(name)) { setConfigError('Enter a valid username.'); return false; }
    setConfigError(''); write(MAIN_KEY, name); setMain(name); return true;
  }
  async function importAccount(username: string, months = 3, onProgress?: (message: string) => void, link = ''): Promise<Game[]> {
    const name = normaliseUsername(username);
    if (!validUsername(name)) throw new Error('Enter a valid username.');
    const identity = accountIdentity(name);
    const incoming = identity.provider === 'lichess' ? await importLichess(identity.username, onProgress, months, link) : await importChessCom(identity.username, onProgress, months);
    if (identity.provider === 'lichess' && link && !incoming.every(game => [game.headers.White, game.headers.Black].some(player => player?.toLowerCase() === identity.username))) throw new Error('The selected game does not include this Lichess player.');
    return associateGames(incoming, name);
  }
  async function syncMain() {
    if (!mainUsername) { setConfigError('Choose your main username to keep its games synced.'); return; }
    if (!canAutoSync()) { setConfigError('Reconnect to the internet and return to ChessAsh to sync.'); return; }
    setConfigError('');
    try { await controller.current!.sync(mainUsername, { manual: true, eligible: true }); } catch {}
  }
  return {
    mainUsername, setMainUsername, syncing: state.syncing,
    syncStatus: state.syncing ? 'Checking for new games…' : state.error ? 'Will retry automatically' : state.lastSynced ? 'Up to date' : 'Ready to sync',
    lastSynced: state.lastSynced, error: configError || state.error, importAccount, syncMain,
    accountCount: new Set(games.flatMap(game => (game as Game & { accountUsernames?: string[] }).accountUsernames || [])).size,
  };
}
