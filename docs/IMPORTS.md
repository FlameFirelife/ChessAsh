# Public game imports

Choose Chess.com or Lichess under Game source in the import dialog. Both imports use public finished games and require no password. PGN file/paste import remains available.

Lichess accepts a username or a game link, including `/game/` links, orientation suffixes and player links. Only the public eight-character game ID is sent for a specific game. Username import requests up to 300 finished standard games from the selected month range, newest first. An empty range, ongoing game or unsupported variant is not added. A single-game link works without a username; supplying a username also checks that the player belongs to that game.

Lichess account collections, sync timestamps and practice history use a provider-qualified identity. A Chess.com username and the same Lichess username stay separate. Public game IDs deduplicate Lichess imports, including matching PGNs, while existing reviews and notes are preserved. A main Lichess account uses the existing visible/online sync schedule and backoff. Single-game imports without an account have a Lichess games collection.

The Windows IPC bridge permits only documented Chess.com public paths and the bounded Lichess user/single-game export endpoints. Requests reject redirects, credentials, nonstandard ports and unrelated Lichess paths. Lichess requests are serialized and successful responses are cached briefly. Android uses Capacitor HTTP; browser development uses fetch. NDJSON user exports and JSON single-game responses are parsed explicitly. Current API PGNs may use `https://lichess.org/game/{id}` as Site.

Official endpoints: [user exports](https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/games/api-games-user-username.yaml) and [single-game exports](https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/games/game-export-gameId.yaml). See the [Lichess API reference](https://lichess.org/api).

`tests/lichess.test.ts` covers finished/standard filtering, ID/link validation, provider separation, deduplication, preserved annotations and native allowlisting. `scripts/testing-followup-smoke.mjs` checks live public username and single-game responses, a controlled import through the native bridge, and Italian phone layout. These checks do not establish physical Android behaviour.
