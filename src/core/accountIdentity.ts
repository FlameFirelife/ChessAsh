export type GameProvider = 'chesscom' | 'lichess';
export function accountIdentity(key: string): { provider: GameProvider; username: string } {
  const name = key.trim().toLowerCase();
  return name.startsWith('lichess:') ? { provider: 'lichess', username: name.slice(8) } : { provider: 'chesscom', username: name };
}
export function accountKey(username: string, provider: GameProvider): string {
  return (provider === 'lichess' ? 'lichess:' : '') + username.trim().toLowerCase();
}
export function accountTitle(key: string): string {
  const identity = accountIdentity(key);
  return identity.provider === 'lichess' ? `${identity.username} · Lichess` : identity.username;
}
