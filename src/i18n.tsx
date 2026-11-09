import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Language = 'en' | 'it';
type Parameters = Record<string, string | number>;
const italian: Record<string, string> = Object.fromEntries(`
Move-quality names|Nomi delle qualità delle mosse
Date range|Intervallo di date
Choose your main account first.|Scegli prima il tuo account principale.
Brilliant|Brillante
Great|Grande mossa
Book|Apertura
Miss|Occasione mancata
Game source|Origine delle partite
Lichess username|Nome utente Lichess
Lichess games|Partite Lichess
Use a public Lichess username or game link. No password needed.|Usa un nome utente pubblico Lichess o il link di una partita. Non serve una password.
Fetching finished Lichess game…|Recupero della partita conclusa su Lichess…
Fetching finished Lichess games…|Recupero delle partite concluse su Lichess…
Imports up to 300 finished standard games from the selected range.|Importa fino a 300 partite standard concluse nell’intervallo selezionato.
Enter a valid Lichess username.|Inserisci un nome utente Lichess valido.
Enter a valid username.|Inserisci un nome utente valido.
Enter a valid Lichess game link.|Inserisci un link valido a una partita Lichess.
No completed standard Lichess games were found. You can import a PGN instead.|Nessuna partita standard conclusa trovata su Lichess. Puoi importare un PGN.
The selected game does not include this Lichess player.|Il giocatore Lichess indicato non partecipa alla partita selezionata.

Played position · blue shows the best alternative; red shows the reply.|Posizione giocata · il blu mostra l’alternativa migliore, il rosso la risposta.
Blue: best alternative. Focus a square in the explanation to see the reply.|Blu: alternativa migliore. Seleziona una casa nella spiegazione per vedere la risposta.
Review as|Rivedi come
Review perspective|Punto di vista della revisione
My account|Il mio account
White / Black|Bianco / Nero
Your game stays here. Return to Review whenever you want.|La partita resta qui. Puoi tornare alla revisione quando vuoi.
Try a move on the board.|Prova una mossa sulla scacchiera.
Playing a continuation. Return to game to see the played position.|Stai seguendo una variante. Torna alla partita per vedere la posizione giocata.
Select a reviewed move to see the feedback.|Seleziona una mossa revisionata per vedere il commento.
Reviewing your move…|Analisi della tua mossa…
Temporary move review|Revisione temporanea
This move is outside the saved game.|Questa mossa non fa parte della partita salvata.
Move review unavailable. Try again.|Revisione della mossa non disponibile. Riprova.
mating|sta dando matto
King’s Pawn|Apertura di pedone di re
Queen’s Pawn|Apertura di pedone di donna
English Opening|Apertura inglese
Réti Opening|Apertura Réti
Open Game|Partita aperta
Sicilian Defence|Difesa siciliana
French Defence|Difesa francese
Caro–Kann Defence|Difesa Caro-Kann
Scandinavian Defence|Difesa scandinava
Pirc setup|Impianto Pirc
Alekhine Defence|Difesa Alekhine
Closed Game|Partita chiusa
Indian Game|Partita indiana
Dutch Defence|Difesa olandese
Italian Game|Partita italiana
Scotch Game|Partita scozzese
Petrov Defence|Difesa Petrov
Vienna Game|Partita viennese
King’s Gambit|Gambetto di re
Queen’s Gambit|Gambetto di donna
Queen’s Gambit Declined|Gambetto di donna rifiutato
Queen’s Gambit Accepted|Gambetto di donna accettato
Slav Defence|Difesa slava
King’s Indian setup|Impianto est-indiano
Nimzo-Indian Defence|Difesa nimzo-indiana
London System|Sistema di Londra
Sicilian Najdorf|Siciliana Najdorf
Unclassified opening|Apertura non classificata
daily|Giornaliera
rapid|Rapida
bullet|Bullet
blitz|Blitz
vs|contro
Invalid coaching pack.|Pacchetto di revisione non valido.
Coaching thresholds must be numbers from 0 to 2000 centipawns.|Le soglie devono essere numeri da 0 a 2000 centesimi di pedone.
Thresholds must increase: excellent < inaccuracy < mistake < blunder.|Le soglie devono crescere in questo ordine: ottima, imprecisione, errore, grave errore.
The bundled Foxash runtime is missing. Reinstall ChessAsh.|Manca il runtime Foxash incluso. Reinstalla ChessAsh.
Use an HTTP(S) endpoint without embedded credentials.|Usa un indirizzo HTTP(S) senza credenziali incorporate.
Remote tutors require HTTPS. Use HTTP only for a local model server.|I tutor remoti richiedono HTTPS. Usa HTTP solo per un server di modelli locale.
Choose Ollama or an API tutor first.|Scegli prima Ollama o un tutor API.
Conversational tutoring is switched off.|Il tutor conversazionale è disattivato.
Select a model before asking the tutor.|Seleziona un modello prima di fare una domanda.
This conversation is too large. Start a new conversation.|Questa conversazione è troppo lunga. Iniziane una nuova.
The tutor returned an empty response.|Il tutor ha restituito una risposta vuota.
The selected model could not complete this request.|Il modello selezionato non ha completato la richiesta.
Tutor response exceeded the size limit.|La risposta del tutor ha superato il limite di lunghezza.
The model returned no answer. Try another model or ask again.|Il modello non ha risposto. Prova un altro modello o ripeti la domanda.
Tutor request stopped or timed out.|Richiesta al tutor interrotta o scaduta.
Could not reach the tutor. Check that the server is running and the endpoint is correct.|Impossibile raggiungere il tutor. Controlla che il server sia avviato e l’indirizzo sia corretto.
Moves analysed: {done}/{total}|Mosse analizzate: {done}/{total}
White|Bianco
Black|Nero
Review|Revisione
Library|Libreria
Settings|Impostazioni
Import game|Importa partita
Import games|Importa partite
Import your games|Importa le tue partite
Main navigation|Navigazione principale
ChessAsh board|Scacchiera ChessAsh
Dismiss error|Chiudi errore
Opening your library…|Apertura della libreria…
A closer look at your chess|Le tue partite, viste da vicino
Review your games.|Rivedi le tue partite.
Import from Chess.com or open a PGN.|Importa da Chess.com o apri un PGN.
Explore a sample|Prova una partita di esempio
Free reviews, saved on your device.|Revisioni gratuite, salvate sul tuo dispositivo.
Game removed.|Partita rimossa.
Undo|Annulla
Dismiss undo|Chiudi annullamento
Game review|Revisione della partita
Export annotated PGN|Esporta PGN con annotazioni
PGN exported.|PGN esportato.
Your review is ready. Let’s look at a turning point.|La revisione è pronta. Vediamo un momento decisivo.
Let’s look at this game together. Start a review to find the moments worth practicing.|Guardiamo insieme questa partita. Avvia la revisione per trovare i momenti su cui esercitarti.
Find a strong move on the board.|Trova una buona mossa sulla scacchiera.
Review position|Posizione della revisione
Best move · before|Mossa migliore · prima
Played move · after|Mossa giocata · dopo
After your move · red arrow shows a checked capture or check|Dopo la mossa · la freccia rossa indica una cattura o uno scacco verificati
Before your move · blue arrow shows the best move|Prima della mossa · la freccia blu indica la mossa migliore
Flip board|Ruota scacchiera
First move|Prima mossa
Previous move|Mossa precedente
Next move|Mossa successiva
Last move|Ultima mossa
Analysis settings|Impostazioni di analisi
Exploring|Esplorazione
starting position|posizione iniziale
Return to game|Torna alla partita
Game advantage|Vantaggio nella partita
Who had the edge?|Chi era in vantaggio?
Above the middle favours White. Below favours Black. Select a point to revisit that moment.|Sopra il centro è in vantaggio il Bianco, sotto il Nero. Seleziona un punto per tornare a quel momento.
Stockfish 19 lite / depth|Stockfish 19 lite / profondità
Saved on this device|Salvato sul dispositivo
Explore|Esplora
Tutor|Tutor
Explore the position|Esplora la posizione
to move|muove
Move pieces to explore an alternative. Ask the engine to compare candidate lines.|Muovi i pezzi per provare un’alternativa. Chiedi al motore di confrontare le varianti.
Evaluating…|Valutazione…
Evaluate position|Valuta posizione
Stop|Ferma
Depth|Profondità
Position notes|Note sulla posizione
What did you notice?|Che cosa hai notato?
Your review|La tua revisione
Review this game|Rivedi questa partita
Find the moments that mattered and try a better move.|Trova i momenti decisivi e prova una mossa migliore.
Analysing…|Analisi…
Continue review|Riprendi revisione
Start review|Avvia revisione
Pause analysis|Metti in pausa l’analisi
Pause|Pausa
Review saved|Revisione salvata
Reanalyse|Analizza di nuovo
Move quality|Qualità delle mosse
Both players|Entrambi i giocatori
Turning points|Momenti decisivi
Short|Breve
Full|Completa
No major turning points found at this depth. Explore the moves below.|A questa profondità non sono emersi grandi errori. Esplora le mosse qui sotto.
Previous|Precedente
Next moment|Momento successivo
Opening|Apertura
Middlegame|Mediogioco
Endgame|Finale
All moves|Tutte le mosse
moves|mosse
Move|Mossa
Moves|Mosse
Complete game|Partita completa
ChessAsh by FlameDev|ChessAsh di FlameDev
Reviews saved on this device.|Revisioni salvate sul dispositivo.
Bring your games|Importa le tue partite
Make it yours|Personalizza ChessAsh
Close dialog|Chiudi finestra
Use your public Chess.com username. No password needed.|Usa il tuo nome utente pubblico di Chess.com. Non serve la password.
Chess.com username|Nome utente Chess.com
Your username|Il tuo nome utente
This is my account. Keep it synced.|Questo è il mio account. Mantienilo aggiornato.
These games will have their own collection. Your main account stays|Queste partite avranno una raccolta separata. Il tuo account principale resta
Archives|Archivi
Latest|Ultimi
month|mese
Specific game link (optional)|Link a una partita (facoltativo)
Fetching games…|Caricamento delle partite…
Fetch finished games|Importa partite concluse
New games may take time to appear in Chess.com’s public archives.|Le nuove partite possono comparire negli archivi pubblici di Chess.com con un po’ di ritardo.
Or import a PGN|Oppure importa un PGN
Choose PGN file|Scegli file PGN
PGN must be smaller than 2 MB.|Il PGN deve essere più piccolo di 2 MB.
Paste PGN|Incolla PGN
Paste PGN moves here…|Incolla qui le mosse del PGN…
Import PGN|Importa PGN
Use the Opera game sample|Usa la partita dell’Opera come esempio
Appearance|Aspetto
Dark|Scuro
Light|Chiaro
Text size|Dimensione del testo
Standard|Standard
Large|Grande
Extra large|Molto grande
Move sounds|Suoni delle mosse
Reduce motion|Riduci animazioni
Advanced|Avanzate
Extra tools for exploring positions and customising your reviews.|Strumenti aggiuntivi per esplorare le posizioni e personalizzare le revisioni.
Show analysis tools|Mostra strumenti di analisi
Analysis depth|Profondità di analisi
Battery saver|Risparmio batteria
Deep|Approfondita
Extended|Estesa
Deeper analysis takes longer. On Android, analysis pauses when you leave the app and can be resumed.|L’analisi approfondita richiede più tempo. Su Android va in pausa quando esci dall’app e puoi riprenderla dopo.
Show suggestion arrows|Mostra frecce dei suggerimenti
About your review|Informazioni sulla revisione
Scores and labels are ChessAsh’s own. They can change with deeper analysis and will differ from Chess.com.|I punteggi e le categorie sono propri di ChessAsh. Possono cambiare con un’analisi più approfondita e differiscono da quelli di Chess.com.
Accuracy averages 100 × exp(−centipawn loss / 300) across your moves. Loss is capped at 1,500 centipawns. This is a guide to this game, not your rating.|La precisione calcola la media di 100 × exp(−perdita in centesimi di pedone / 300) sulle tue mosse. La perdita è limitata a 1.500 centesimi. È un’indicazione su questa partita, non sul tuo punteggio.
Stockfish 19 lite is included under GPLv3. Source and licences are included with the app. Foxash powers the Windows review rules.|Stockfish 19 lite è incluso con licenza GPLv3. Il codice sorgente e le licenze sono inclusi nell’app. Foxash gestisce le regole di revisione su Windows.
Language|Lingua
English|English
Italian|Italiano
Your main account|Il tuo account principale
Imported player|Giocatore importato
Keep this player's latest games synced|Mantieni aggiornate le partite di questo giocatore
Make main|Imposta come principale
Unknown date|Data sconosciuta
Reviewed|Revisionata
In progress|In corso
To review|Da rivedere
No games match these filters.|Nessuna partita corrisponde ai filtri.
Your next finished games will appear here.|Le tue prossime partite concluse compariranno qui.
No games in this collection yet.|Questa raccolta non contiene ancora partite.
Your library|La tua libreria
Your games and the players you follow, kept apart.|Le tue partite e quelle degli altri giocatori, in raccolte separate.
Checking for new games…|Ricerca di nuove partite…
Ready to check for new games|Pronto a cercare nuove partite
Syncs while ChessAsh is open. Public archives can be delayed.|Si aggiorna mentre ChessAsh è aperto. Gli archivi pubblici possono essere in ritardo.
Syncing…|Aggiornamento…
Check now|Controlla ora
Keep your own games up to date|Mantieni aggiornate le tue partite
Choose your main Chess.com username.|Scegli il tuo nome utente principale di Chess.com.
Main Chess.com username|Nome utente Chess.com principale
Set main account|Imposta account principale
Your saved games are still available.|Le partite salvate sono ancora disponibili.
Search saved games|Cerca nelle partite salvate
Search player, opening or date|Cerca giocatore, apertura o data
Review status|Stato della revisione
All games|Tutte le partite
Game result|Risultato della partita
Any result|Qualsiasi risultato
Time control|Cadenza
Any time control|Qualsiasi cadenza
A home for your games|Uno spazio per le tue partite
Import your games or explore another player's collection.|Importa le tue partite o esplora la raccolta di un altro giocatore.
Import a game|Importa una partita
PGN files and samples|File PGN ed esempi
Earlier imports|Importazioni precedenti
game|partita
games|partite
Saved tutor settings could not be opened. Choose a connection below.|Non è stato possibile aprire le impostazioni del tutor. Scegli una connessione qui sotto.
Chat could not be saved: local storage is full.|Impossibile salvare la chat: lo spazio locale è esaurito.
Tutor settings saved.|Impostazioni del tutor salvate.
Could not save settings.|Impossibile salvare le impostazioni.
Connected, but no models are installed. Install one in your model server first.|Connessione riuscita, ma non ci sono modelli installati. Installane uno nel server dei modelli.
Connection failed.|Connessione non riuscita.
Position changed. Ask again for this position.|La posizione è cambiata. Ripeti la domanda per questa posizione.
The tutor requested an illegal move. Try another question or model.|Il tutor ha richiesto una mossa illegale. Prova un’altra domanda o un altro modello.
Checking that alternative with Stockfish…|Verifica dell’alternativa con Stockfish…
Position changed. The old request was stopped; ask again for this position.|La posizione è cambiata. La richiesta precedente è stata fermata; ripeti la domanda per questa posizione.
Tutor request failed.|Richiesta al tutor non riuscita.
Ask a tutor|Chiedi al tutor
Chat with a tutor in the Windows app. You can use guided review here.|Chatta con il tutor nell’app Windows. Qui puoi usare la revisione guidata.
Conversational tutor|Tutor conversazionale
Choose how to connect|Scegli come collegarti
Talk through the game|Parliamo della partita
Pick a tutor when you want to ask a question. Your usual reviews stay free.|Scegli un tutor quando vuoi fare una domanda. Le normali revisioni restano gratuite.
Use a model installed on this computer with Ollama.|Usa con Ollama un modello installato su questo computer.
Use your own provider. Its charges may apply.|Usa il tuo fornitore, che può addebitarti dei costi.
Tutor connection|Connessione del tutor
Off|Disattivato
Ollama on this computer|Ollama su questo computer
My API provider|Il mio fornitore API
Model|Modello
Tutor model|Modello del tutor
Choose a model|Scegli un modello
Enter a model name…|Inserisci il nome di un modello…
Finding models…|Ricerca dei modelli…
Find models|Cerca modelli
Model name|Nome del modello
Custom model name|Nome del modello personalizzato
Name provided by your model server|Nome indicato dal server dei modelli
Connection settings|Impostazioni di connessione
Server endpoint|Indirizzo del server
This provider receives your game and recent chat. Its charges may apply. ChessAsh never switches to a cloud tutor automatically.|Questo fornitore riceve la partita e i messaggi recenti e può addebitarti dei costi. ChessAsh non passa mai automaticamente a un tutor nel cloud.
API key|Chiave API
Saved securely; leave blank to keep|Salvata in modo sicuro; lascia vuoto per mantenerla
Enter your own API key|Inserisci la tua chiave API
Saved API key removed.|Chiave API salvata rimossa.
Could not remove key.|Impossibile rimuovere la chiave.
Remove saved key|Rimuovi chiave salvata
Save tutor settings|Salva impostazioni del tutor
Ask about|Chiedi informazioni su
the starting position|la posizione iniziale
. Tutor answers may be wrong.|. Le risposte del tutor possono contenere errori.
Saved tutor conversation|Conversazione del tutor salvata
You|Tu
Return to the original position to preview this line|Torna alla posizione originale per vedere questa variante
Moves checked for legality|Legalità delle mosse verificata
Preview|Mostra variante
This suggested line failed legality checks and cannot be previewed.|La variante suggerita contiene mosse illegali e non può essere mostrata.
Checking the position…|Verifica della posizione…
Ask the tutor|Chiedi al tutor
Why is that move better?|Perché quella mossa è migliore?
Ask tutor|Chiedi al tutor
Clear chat|Svuota chat
Foxash rules applied to the current review.|Regole Foxash applicate alla revisione corrente.
Could not apply this pack.|Impossibile applicare questo pacchetto.
Foxash coaching rules|Regole di revisione Foxash
Foxash classifies moves and selects review moments and hints. Adjust loss thresholds in centipawns; 100 equals one pawn. Imported packs contain data only.|Foxash classifica le mosse e sceglie i momenti da rivedere e i suggerimenti. Regola le soglie in centesimi di pedone: 100 equivalgono a un pedone. I pacchetti importati contengono solo dati.
Pack name|Nome del pacchetto
Excellent maximum|Massimo per Ottima
Inaccuracy minimum|Minimo per Imprecisione
Mistake minimum|Minimo per Errore
Blunder minimum|Minimo per Grave errore
Applying…|Applicazione…
Apply rules|Applica regole
Restore defaults|Ripristina valori predefiniti
Export pack|Esporta pacchetto
Import pack|Importa pacchetto
Pack is too large.|Il pacchetto è troppo grande.
Invalid JSON pack.|Pacchetto JSON non valido.
Game advantage. White above the centre line, Black below. Use the slider to select a move.|Vantaggio nella partita. Bianco sopra la linea centrale, Nero sotto. Usa il cursore per scegliere una mossa.
Move on evaluation graph|Mossa sul grafico della valutazione
White above / Black below|Bianco sopra / Nero sotto
Review in progress|Revisione in corso
Accuracy|Precisione
Best|Migliore
Excellent|Ottima
Good|Buona
Inaccuracy|Imprecisione
Mistake|Errore
Blunder|Grave errore
Missed chance|Occasione mancata
Critical find|Mossa decisiva
Sound sacrifice|Sacrificio corretto
A recognised opening sequence.|Una sequenza di apertura riconosciuta.
The engine’s preferred move at this search depth.|La mossa preferita dal motore a questa profondità.
Very close to the engine’s preferred move.|Molto vicina alla mossa preferita dal motore.
Keeps most of the position’s chances.|Mantiene quasi tutte le possibilità della posizione.
Concedes some of the position’s chances.|Riduce alcune possibilità della posizione.
Gives away a substantial opportunity.|Spreca un’opportunità importante.
A large, avoidable deterioration.|Un grande peggioramento evitabile.
Misses a concrete advantage from a promising position.|Perde un vantaggio concreto in una posizione promettente.
Finds the only clearly strong candidate in this search.|Trova l’unica mossa nettamente forte tra quelle analizzate.
An engine-checked material investment with compensation.|Un sacrificio verificato dal motore con un compenso sufficiente.
Enter a valid Chess.com username.|Inserisci un nome utente Chess.com valido.
Enter a Chess.com username using letters, numbers, underscores or hyphens.|Inserisci un nome utente Chess.com con lettere, numeri, trattini bassi o trattini.
Choose your main username to keep its games synced.|Scegli il tuo nome utente principale per mantenerne aggiornate le partite.
Reconnect to the internet and return to ChessAsh to sync.|Riconnettiti a Internet e torna a ChessAsh per aggiornare le partite.
Finding public game archives…|Ricerca degli archivi pubblici…
Chess.com could not find this username or game archive.|Chess.com non trova questo nome utente o archivio di partite.
Chess.com is limiting requests. Wait a few minutes and try again.|Chess.com sta limitando le richieste. Attendi qualche minuto e riprova.
No completed standard chess games were found in these archives. You can import a PGN instead.|In questi archivi non ci sono partite concluse di scacchi standard. Puoi importare un PGN.
Choose a non-empty PGN smaller than 2 MB.|Scegli un PGN non vuoto e più piccolo di 2 MB.
This PGN has no moves to review.|Questo PGN non contiene mosse da rivedere.
Stockfish did not start. Restart the app and try again.|Stockfish non si è avviato. Riavvia l’app e riprova.
The local chess engine could not run. Check the engine assets or restart the app.|Il motore locale non si è avviato. Controlla i file del motore o riavvia l’app.
The engine search timed out. Try a lower analysis depth.|Il motore ha impiegato troppo tempo. Prova una profondità di analisi inferiore.
The engine returned no usable evaluation. Try again.|Il motore non ha restituito una valutazione utilizzabile. Riprova.
Analysis cancelled.|Analisi annullata.
That game was not found in the fetched archives. Increase archive range or import its PGN.|La partita non è negli archivi caricati. Aumenta il periodo o importa il suo PGN.
Foxash returned an invalid review label.|Foxash ha restituito una categoria non valida.
Review complete. Select a key moment to begin.|Revisione completata. Seleziona un momento decisivo per iniziare.
Analysis paused. Your progress is saved.|Analisi in pausa. I progressi sono salvati.
Pause the game review before analysing a variation.|Metti in pausa la revisione prima di analizzare una variante.
Found it. Play through the continuation to see the idea.|Trovata. Segui la variante per capire l’idea.
Pause analysis to check an alternative.|Metti in pausa l’analisi per verificare un’alternativa.
Checking your alternative…|Verifica dell’alternativa…
That works too. Your move preserves the position’s chances.|Va bene anche questa. La tua mossa mantiene le possibilità della posizione.
There is a stronger move. Return to the review to compare it or play the continuation.|C’è una mossa più forte. Torna alla revisione per confrontarla o segui la variante.
No more matching key moments.|Non ci sono altri momenti decisivi con questi filtri.
`.trim().split('\n').map(line => { const at = line.indexOf('|'); return [line.slice(0, at), line.slice(at + 1)]; }));

const patterns: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Lichess returned (\d+)\..*$/, m => `Lichess ha restituito l’errore ${m[1]}. Riprova più tardi o importa un PGN.`],

  [/^Evaluation (.+)$/, m => `Valutazione ${m[1]}`],
  [/^Imported (\d+) games?\.$/, m => `Importat${m[1] === '1' ? 'a' : 'e'} ${m[1]} partit${m[1] === '1' ? 'a' : 'e'}.`],
  [/^Model server returned HTTP (\d+)\..*$/, m => `Il server dei modelli ha restituito l’errore HTTP ${m[1]}. Controlla l’indirizzo e le credenziali.`],
  [/^The tutor could not answer \(HTTP (\d+)\)\..*$/, m => `Il tutor non ha risposto (HTTP ${m[1]}). Controlla il modello e le impostazioni di connessione.`],
  [/^Importing archive (\d+) of (\d+)…$/, m => `Importazione dell’archivio ${m[1]} di ${m[2]}…`],
  [/^Last checked (.+)$/, m => `Ultimo controllo ${m[1]}`],
  [/^Games imported for (.+)$/, m => `Partite importate per ${m[1]}`],
  [/^Delete game (.+) versus (.+)$/, m => `Elimina la partita ${m[1]} contro ${m[2]}`],
  [/^Connected\. (\d+) models? available\.$/, m => `Connesso. ${m[1]} ${m[1] === '1' ? 'modello disponibile' : 'modelli disponibili'}.`],
  [/^the position after (.+)$/, m => `la posizione dopo ${m[1]}`],
  [/^after (.+)$/, m => `dopo ${m[1]}`],
  [/^Latest (\d+) months?$/, m => `Ultim${m[1] === '1' ? 'o' : 'i'} ${m[1]} mes${m[1] === '1' ? 'e' : 'i'}`],
  [/^Chess\.com returned (\d+)\..*$/, m => `Chess.com ha restituito l’errore ${m[1]}. Riprova più tardi o importa un PGN.`],
  [/^The (.+) variant is not supported\. Import a standard chess game\.$/, m => `La variante ${m[1]} non è supportata. Importa una partita di scacchi standard.`],
  [/^Could not open your library: (.+)$/, m => `Impossibile aprire la libreria: ${m[1]}`],
  [/^Could not save: (.+)$/, m => `Impossibile salvare: ${m[1]}`],
  [/^Invalid PGN: (.+)$/, m => `PGN non valido: ${m[1]}`],
];

export function translate(language: Language, key: string, parameters: Parameters = {}): string {
  const normalized = key.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/\s+/g, ' ').trim();
  let value = key;
  if (language === 'it') {
    value = italian[normalized] ?? patterns.reduce<string | undefined>((found, [pattern, render]) => found ?? (normalized.match(pattern) ? render(normalized.match(pattern)!) : undefined), undefined) ?? key;
  }
  return value.replace(/\{(\w+)\}/g, (token, name: string) => parameters[name] === undefined ? token : String(parameters[name]));
}

export function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem('chessash:language');
    if (stored === 'en' || stored === 'it') return stored;
    if (localStorage.getItem('chessash:prefs') || localStorage.getItem('chessash:username')) return 'en';
  } catch {}
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en';
}
const LanguageContext = createContext({ language: 'en' as Language, setLanguage: (_: Language) => {}, t: (key: string, parameters?: Parameters) => translate('en', key, parameters) });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const t = useCallback((key: string, parameters?: Parameters) => translate(language, key, parameters), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem('chessash:language', language); } catch {}
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { return useContext(LanguageContext); }
