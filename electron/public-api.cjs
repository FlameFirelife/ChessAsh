function publicApi(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('Only documented public chess APIs are allowed.');
  if (url.hostname === 'api.chess.com' && url.pathname.startsWith('/pub/')) return { url, provider: 'Chess.com', accept: 'application/json', ndjson: false };
  if (url.hostname !== 'lichess.org') throw new Error('Only documented public chess APIs are allowed.');
  const user = /^\/api\/games\/user\/[a-z0-9_-]{2,30}$/i.test(url.pathname);
  const game = /^\/game\/export\/[a-z0-9]{8}$/i.test(url.pathname);
  const keys = ['max', 'since', 'ongoing', 'finished', 'pgnInJson', 'moves', 'evals', 'clocks', 'opening', 'perfType'];
  if ((!user && !game) || [...url.searchParams.keys()].some(key => !keys.includes(key))) throw new Error('Only finished Lichess game exports are allowed.');
  if (user && (url.searchParams.get('ongoing') !== 'false' || url.searchParams.get('finished') !== 'true' || !/^(?:[1-9][0-9]?|[12][0-9]{2}|300)$/.test(url.searchParams.get('max') || ''))) throw new Error('Lichess imports must request a bounded set of finished games.');
  return { url, provider: 'Lichess', accept: user ? 'application/x-ndjson' : 'application/json', ndjson: user };
}
module.exports = { publicApi };
