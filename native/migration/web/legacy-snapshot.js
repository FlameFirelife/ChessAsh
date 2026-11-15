async function chessAshLegacySnapshot() {
  const knownKeys = new Set([
    'chessash:prefs', 'chessash:active', 'chessash:screen', 'chessash:import-provider',
    'chessash:username', 'chessash:main-username', 'chessash:account-sync-times', 'chessash:language',
  ]);
  const settings = Object.create(null);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && (knownKeys.has(key) || key.startsWith('chessash:training:v1:') || key.startsWith('chessash.chat.'))) {
      const value = localStorage.getItem(key);
      if (value !== null) settings[key] = value;
    }
  }
  const games = await new Promise((resolve, reject) => {
    const request = indexedDB.open('chessash');
    let missing = false;
    request.onblocked = () => reject(new Error('The V1.5 library is still in use.'));
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction.abort();
    };
    request.onerror = () => missing ? resolve([]) : reject(new Error('The V1.5 library could not be opened.'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('games')) {
        db.close();
        reject(new Error('The V1.5 games store is missing.'));
        return;
      }
      const transaction = db.transaction('games', 'readonly');
      const read = transaction.objectStore('games').getAll();
      transaction.oncomplete = () => {
        db.close();
        resolve(read.result);
      };
      transaction.onabort = () => {
        db.close();
        reject(new Error('The V1.5 games store could not be read.'));
      };
    };
  });
  return { format: 'chessash-v1.5-backup', games, localStorage: settings };
}
