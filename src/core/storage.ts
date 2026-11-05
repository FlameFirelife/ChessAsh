import type { Game } from './types';

let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('chessash', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('The game library could not be opened: ' + request.error?.message));
    });
    database.catch(() => { database = undefined; });
  }
  return database;
}

export async function loadGames(): Promise<Game[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('games').objectStore('games').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not read the game library.'));
  });
}

export async function saveGames(games: Game[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('games', 'readwrite');
    const store = transaction.objectStore('games');
    for (const game of games) store.put(game);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Could not save games. Check available device storage.'));
    transaction.onabort = () => reject(new Error('Saving the library was interrupted.'));
  });
}

export async function saveGame(game: Game): Promise<void> { return saveGames([game]); }

export async function deleteGame(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('games', 'readwrite');
    transaction.objectStore('games').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Could not remove this game.'));
  });
}
