import { useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board';
import { analyzePosition, playUci } from '../core';
import type { Game } from '../core';
import { describeMove, reviewCoaching } from '../core/coaching';
import { acceptableTrainingMove, loadTrainingHistory, recordTraining, trainingCards, trainingQueue, trainingStorageKey, trainingFact } from '../core/training';
import type { TrainingCard, TrainingHistory, TrainingPattern } from '../core/training';
import { trainingDecisions } from '../core/trainingPolicy';
import type { TrainingDecision } from '../core/trainingPolicy';
import {mixedTrainingSession,summarizeTraining,trainingReplyLine} from '../core/trainingSession';
import type {SessionOutcome,TrainingReply} from '../core/trainingSession';
import {restoreTraining,persistTraining} from '../core/trainingResume';
import type {PracticeState} from '../core/trainingResume';
import {loadPracticeEvents,mergePracticeEvents,practiceTrends} from '../core/trainingProgress';
import { useLanguage } from '../i18n';
import '../training.css';

export default function Training({games,username,onLibrary,onSource,soundEnabled=false}:{games:Game[];username:string;onLibrary:()=>void;onSource:(game:Game,ply:number)=>void;soundEnabled?:boolean}) {
 const {language}=useLanguage();const it=language==='it';
 const key=trainingStorageKey(username);
 const [history,setHistory]=useState<TrainingHistory>(()=>loadTrainingHistory(key));
 const rawCards=useMemo(()=>trainingCards(games,username),[games,username]);
 const [resumed]=useState(()=>restoreTraining(key,rawCards,language));
 const [sessionId,setSessionId]=useState(resumed.id);
 const [events,setEvents]=useState(()=>loadPracticeEvents(key));
 const [session,setSession]=useState<TrainingCard[]>(resumed.session);
 const [index,setIndex]=useState(resumed.index);
 const [fen,setFen]=useState(resumed.fen);const [move,setMove]=useState(resumed.move);
 const [state,setState]=useState<PracticeState>(resumed.state);
 const [message,setMessage]=useState('');const [storageError,setStorageError]=useState(false);
 const [outcomes,setOutcomes]=useState<Record<string,SessionOutcome>>(resumed.outcomes);
 const [reply,setReply]=useState<TrainingReply[]>(resumed.reply);const [replyIndex,setReplyIndex]=useState(resumed.replyIndex);
 const [attemptMove,setAttemptMove]=useState(resumed.attempt);
 const controller=useRef<AbortController|null>(null);
 const [plan,setPlan]=useState<{cards:TrainingCard[];history:TrainingHistory;rows:TrainingDecision[];error?:boolean}|null>(null);
 const [policyAttempt,setPolicyAttempt]=useState(0);
 useEffect(()=>{
  let disposed=false;
  trainingDecisions(rawCards.map(card=>trainingFact(card,history[card.id])))
   .then(rows=>{if(!disposed)setPlan({cards:rawCards,history,rows});})
   .catch(()=>{if(!disposed)setPlan({cards:rawCards,history,rows:[],error:true});});
  return ()=>{disposed=true;};
 },[rawCards,history,policyAttempt]);
 const policyReady=plan?.cards===rawCards&&plan.history===history&&!plan.error;
 const cards=useMemo(()=>policyReady?rawCards.map((card,index)=>({...card,pattern:plan!.rows[index].focus})):[],[rawCards,plan,policyReady]);
 const priorities=Object.fromEntries(cards.map((card,index)=>[card.id,plan!.rows[index].priority]));
 const queue=policyReady?trainingQueue(cards,history,Date.now(),priorities):[];
 const card=session[index];
 const localizedReply=useMemo(()=>card&&reply.length?trainingReplyLine(reply[0].beforeFen,reply.map(r=>r.move),language,card.result.color,{fen:card.fen,move:attemptMove}):[],[reply,language,card,attemptMove]);
 const names:Record<TrainingPattern,string>={capture:it?'Occasioni di cattura':'Capture opportunities',check:it?'Scacchi da trovare':'Finding checks',reply:it?'Risposte avversarie':'Opponent replies',improve:it?'Scelte da migliorare':'Better choices',undefended:it?'Pezzi indifesi':'Undefended pieces',fork:it?'Attacchi doppi':'Forks',backrank:it?'Matto sull’ultima traversa':'Back-rank mates'};
 const prompts:Record<TrainingPattern,string>={capture:it?'Confronta le catture disponibili prima di scegliere.':'Compare the available captures before choosing.',check:it?'Cerca uno scacco e controlla le risposte del re.':'Look for a check and consider the king’s replies.',reply:it?'Controlla gli scacchi e le catture del tuo avversario prima di decidere.':'Check your opponent’s checks and captures before deciding.',improve:it?'Confronta le tue mosse candidate e le risposte avversarie.':'Compare your candidate moves and the opponent’s replies.',undefended:it?'Controlla quali pezzi sono senza difesa prima di scegliere.':'Check which pieces are undefended before choosing.',fork:it?'Cerca una mossa che attacchi due pezzi contemporaneamente.':'Look for a move that attacks two pieces at once.',backrank:it?'Controlla gli scacchi sull’ultima traversa e le vie di fuga del re.':'Check the back-rank checks and the king’s escape squares.'};
 const groups=Object.entries(names).map(([pattern,name])=>({pattern,name,cards:cards.filter(c=>c.pattern===pattern)})).filter(g=>g.cards.length).sort((a,b)=>b.cards.length-a.cards.length);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{
  try{persistTraining(key,{session,id:sessionId,index,state,fen,move,attempt:attemptMove,reply,replyIndex,outcomes});}catch{setStorageError(true);}
 },[key,session,sessionId,index,state,fen,move,attemptMove,reply,replyIndex,outcomes]);
 const completed=session.length>0&&index>=session.length;
 useEffect(()=>{
  if(!completed)return;
  try{const updated=mergePracticeEvents(loadPracticeEvents(key),sessionId,session,outcomes);localStorage.setItem(key+':events',JSON.stringify(updated));setEvents(updated);}catch{setStorageError(true);}
 },[completed,key,sessionId,session,outcomes]);
 function begin(next:TrainingCard[],mixed=false) {controller.current?.abort();const chosen=mixed?mixedTrainingSession(next):next.slice(0,5);setSession(chosen);setSessionId(crypto.randomUUID());setOutcomes({});setIndex(0);setFen(chosen[0]?.fen||'');setMove('');setAttemptMove('');setState('ready');setMessage('');setReply([]);setReplyIndex(-1);}
 async function remember(current:TrainingCard,solved:boolean,signal:AbortSignal,shown=false) {
  const assisted=shown||!!outcomes[current.id]?.assisted;
  const earned=solved&&!assisted;
  const [decision]=await trainingDecisions([trainingFact(current,history[current.id],earned)]);
  if(signal.aborted)return false;
  const updated={...history,[current.id]:recordTraining(history[current.id],earned,Date.now(),decision.intervalSeconds)};
  setHistory(updated);
  setOutcomes(previous=>({...previous,[current.id]:{card:current,attempts:(previous[current.id]?.attempts||0)+1,solved,assisted:assisted||!!previous[current.id]?.assisted,due:updated[current.id].due}}));
  try{localStorage.setItem(key,JSON.stringify(updated));setStorageError(false);}catch{setStorageError(true);}
  return true;
 }
 async function attempt(from:string,to:string,promotion?:string) {
  if(!card||state!=='ready')return;
  const uci=from+to+(promotion||'');const played=playUci(card.fen,uci);if(!played)return;
  setFen(played.fen);setMove(uci);setAttemptMove(uci);setState('checking');setMessage('');setReply([]);setReplyIndex(-1);
  const active=new AbortController();controller.current?.abort();controller.current=active;
  try {
   let correct=uci===card.result.best;
   if(!correct){
    const before=await analyzePosition(card.fen,{depth:12,multiPv:1,signal:active.signal});
    const after=await analyzePosition(played.fen,{depth:12,multiPv:1,signal:active.signal});
    correct=acceptableTrainingMove(before,after,card.result.color);
    if(!correct&&!active.signal.aborted)setReply(trainingReplyLine(played.fen,after.pv,language,card.result.color,{fen:card.fen,move:uci}));
   }
   if(active.signal.aborted)return;
   if(await remember(card,correct,active.signal))setState(correct?'correct':'missed');
  }catch {if(!active.signal.aborted){setState('error');setMessage(it?'Analisi non disponibile. Riprova.':'Analysis unavailable. Try again.');}}
 }
 async function reveal() {
  if(!card)return;controller.current?.abort();
  const solution=playUci(card.fen,card.result.best);if(!solution)return;
  const active=new AbortController();controller.current=active;
  const needsRecord=state==='ready'||state==='error';setState('checking');
  try {
   if(needsRecord&&!await remember(card,false,active.signal,true))return;
   if(active.signal.aborted)return;
   setMove(card.result.best);setFen(solution.fen);setState('revealed');
   setOutcomes(previous=>previous[card.id]?({...previous,[card.id]:{...previous[card.id],assisted:true}}):previous);setReply([]);setReplyIndex(-1);
  }catch {if(!active.signal.aborted){setState('error');setMessage(it?'Allenamento non disponibile. Riprova.':'Training unavailable. Try again.');}}
 }
 function next(){controller.current?.abort();const n=index+1;setIndex(n);setFen(session[n]?.fen||'');setMove('');setState('ready');setMessage('');setReply([]);setReplyIndex(-1);}
 const finished=session.length>0&&!card;
 const summary=summarizeTraining(session,outcomes,history);
 const trends=practiceTrends(events);
 const coaching=card&&(state==='correct'||state==='revealed')?reviewCoaching(card.game,card.result,{language,playerColor:card.result.color}):undefined;
 return <main className="training-screen">
  <header className="training-heading"><div><span className="section-label">{it?'Dalle tue partite':'From your games'}</span><h1>{it?'Allenamento personalizzato':'Personalized training'}</h1><p>{it?'Ritrova le occasioni perse e allenati a scegliere meglio.':'Revisit missed opportunities and practice choosing a better move.'}</p></div>{session.length>0&&<button onClick={()=>begin([])}>{it?'Torna ai tuoi schemi':'Back to your patterns'}</button>}</header>
  {storageError&&<p role="alert">{it?'I progressi non sono stati salvati. Controlla lo spazio disponibile.':'Progress could not be saved. Check available storage.'}</p>}
  {plan?.error&&<p role="alert">{it?'Allenamento non disponibile.':'Training unavailable.'} <button onClick={()=>setPolicyAttempt(n=>n+1)}>{it?'Riprova':'Try again'}</button></p>}
  {!session.length?<>
   <section className="training-overview"><h2>{it?'Su cosa lavorare':'What to work on'}</h2><p>{it?'Uso solo le tue mosse nelle partite revisionate. I problemi ricorrenti e gli esercizi da ripassare vengono prima.':'Only your moves in reviewed games are used. Recurring problems and positions due for another try come first.'}</p>
    <div className="training-patterns">{groups.map(group=><article key={group.pattern}><strong>{group.name}</strong><span>{group.cards.length} {it?(group.cards.length===1?'posizione':'posizioni'):(group.cards.length===1?'position':'positions')} · {new Set(group.cards.map(c=>c.game.id)).size} {it?(new Set(group.cards.map(c=>c.game.id)).size===1?'partita':'partite'):(new Set(group.cards.map(c=>c.game.id)).size===1?'game':'games')}</span><span>{group.cards.filter(c=>(history[c.id]?.streak||0)>0).length} / {group.cards.length} {it?(group.cards.length===1?'risolta all’ultimo tentativo':'risolte all’ultimo tentativo'):'solved on last attempt'}</span><button disabled={!trainingQueue(group.cards,history,Date.now(),priorities).length} onClick={()=>begin(trainingQueue(group.cards,history,Date.now(),priorities))}>{it?'Allenati su questo':'Practice this'}</button></article>)}</div>
    {!policyReady?<p>{plan?.error?'':it?'Preparo il tuo allenamento…':'Preparing your training…'}</p>:queue.length>0?<button className="primary" onClick={()=>begin(queue,true)}>{it?'Inizia allenamento':'Start training'} · {Math.min(5,queue.length)}</button>:<p>{cards.length?(it?'Tutto ripassato per ora. Gli esercizi torneranno quando è il momento di riprovarli.':'You are up to date. Positions will return when they are due for another try.'):(it?'Revisiona le tue partite per trovare posizioni da allenare. Imposta il tuo account o scegli il tuo colore in «Rivedi come».':'Review your games to find training positions. Set your main account or choose your colour under “Review as”.')}</p>}
    {policyReady&&!cards.length&&<button onClick={onLibrary}>{it?'Apri libreria':'Open library'}</button>}
   </section>
   <section className="training-overview training-progress"><h2>{it?'Progressi nel tempo':'Progress over time'}</h2>{trends.length?<div className="training-trends">{trends.map(trend=><article key={trend.pattern}><h3>{names[trend.pattern]}</h3><p>{trend.sessions} {it?(trend.sessions===1?'sessione completata':'sessioni completate'):(trend.sessions===1?'completed session':'completed sessions')}</p><label>{it?'Posizioni recenti':'Recent positions'}: {trend.recent} / {trend.recentTotal} {it?'risolte senza soluzione mostrata':'solved without revealing'}<progress aria-label={names[trend.pattern]+(it?' · recenti':' · recent')} value={trend.recent} max={trend.recentTotal}/></label>{trend.earlierTotal>0&&<label>{it?'Posizioni precedenti':'Earlier positions'}: {trend.earlier} / {trend.earlierTotal}<progress aria-label={names[trend.pattern]+(it?' · precedenti':' · earlier')} value={trend.earlier} max={trend.earlierTotal}/></label>}<p className="training-trend-change">{trend.delta===null?(it?'Completa altre sessioni per confrontare due gruppi di cinque posizioni.':'Complete more sessions to compare two groups of five positions.'):trend.delta>0?(it?'In miglioramento: +':'Improving: +')+trend.delta+(it?' punti percentuali':' percentage points'):trend.delta<0?(it?'Da ripassare: ':'Needs more practice: ')+trend.delta+(it?' punti percentuali':' percentage points'):(it?'Risultati stabili nei due gruppi più recenti.':'Steady results across the two latest groups.')}</p></article>)}</div>:<p>{it?'Completa una sessione per iniziare a vedere i tuoi progressi.':'Complete a session to start seeing your progress.'}</p>}</section>
  </>:finished?<section className="training-overview training-finish"><h2>{it?'Allenamento completato':'Training complete'}</h2><dl className="training-summary"><div><dt>{it?'Risolte al primo tentativo':'Solved first try'}</dt><dd>{summary.independent} / {summary.total}</dd></div><div><dt>{it?'Risolte dopo un altro tentativo':'Solved after another try'}</dt><dd>{summary.retried}</dd></div><div><dt>{it?'Soluzione mostrata':'Solution shown'}</dt><dd>{summary.assisted}</dd></div></dl><h3>{it?'Da ripassare':'What to revisit'}</h3>{summary.retry.length?<ul>{summary.retry.map(c=><li key={c.id}>{names[c.pattern]} · {c.game.headers.White} — {c.game.headers.Black}</li>)}</ul>:<p>{it?'Hai risolto tutte le posizioni senza aiuto.':'You solved every position without help.'}</p>}{summary.nextDue>0&&<p>{summary.nextDue<=Date.now()?(it?'Ci sono già posizioni pronte per un altro tentativo.':'Some positions are ready for another try.'):(it?'Prossimo ripasso: ':'Next practice: ')+new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(summary.nextDue)}</p>}{summary.retry.length>0&&<button onClick={()=>begin(summary.retry)}>{it?'Riprova queste posizioni':'Practice these again'}</button>}<button className="primary" onClick={()=>begin([])}>{it?'Vedi i tuoi schemi':'See your patterns'}</button></section>:<section className="training-workspace">
   <div className="training-board"><Board soundEnabled={soundEnabled} fen={fen||card.fen} flipped={card.result.color==='b'} onMove={attempt} language={language} lastMove={move||undefined} disabled={state!=='ready'} arrow={state==='revealed'?card.result.best:undefined} quality={state==='correct'?{square:move.slice(2,4),label:move===card.result.best?'best':'excellent',name:it?'Soluzione trovata':'Solution found',key:card.id}:undefined}/></div>
   <div className={`training-feedback training-${state}`} aria-live="polite"><span className="section-label">{index+1} / {session.length} · {names[card.pattern]}</span><h2>{state==='correct'?(it?'Ben trovato!':'Well found!'):state==='checking'?(it?'Controllo la tua mossa…':'Checking your move…'):state==='missed'?(it?'C’è una scelta migliore':'There is a better choice'):state==='revealed'?(it?'La mossa da trovare':'The move to find'):(it?'Trova una mossa migliore':'Find a better move')}</h2>
    <p>{state==='correct'?(it?'Questa mossa conserva il vantaggio della continuazione migliore.':'This move preserves the value of the best continuation.'):state==='revealed'?describeMove(card.fen,card.result.best,{language,playerColor:card.result.color}):state==='missed'?(it?'Esplora la risposta, poi riprova o confronta la soluzione.':'Explore the reply, then try again or compare the solution.'):(it?'Sei '+(card.result.color==='w'?'il Bianco':'il Nero')+'. Scegli la tua mossa sulla scacchiera.':'You are '+(card.result.color==='w'?'White':'Black')+'. Choose your move on the board.')}</p>
    {message&&<p role="alert">{message}</p>}
    {state==='missed'&&reply.length>0&&<div className="training-reply"><p>{localizedReply[Math.max(0,replyIndex)]?.text}</p><div className="button-row"><button onClick={()=>{const n=replyIndex+1<reply.length?replyIndex+1:0;setReplyIndex(n);setFen(reply[n].fen);setMove(reply[n].move);}}>{replyIndex<0?(it?'Mostra la risposta avversaria':'Show opponent’s reply'):replyIndex+1<reply.length?(it?'Continua la variante':'Continue the line'):(it?'Rivedi la risposta':'Replay reply')}</button>{replyIndex>=0&&<button onClick={()=>{setFen(reply[0].beforeFen);setMove(attemptMove);setReplyIndex(-1);}}>{it?'Torna alla tua mossa':'Back to your move'}</button>}</div></div>}
    {state==='ready'&&<p className="training-focus">{prompts[card.pattern]}</p>}
    {(state==='ready'||state==='error'||state==='missed')&&<button onClick={reveal}>{it?'Mostra soluzione':'Show solution'}</button>}
    {(state==='error'||state==='missed'||state==='revealed')&&<button onClick={()=>{setFen(card.fen);setMove('');setState('ready');setMessage('');setReply([]);setReplyIndex(-1);}}>{it?'Riprova':'Try again'}</button>}
    {['correct','missed','revealed'].includes(state)&&<button className="primary" onClick={next}>{index+1===session.length?(it?'Termina':'Finish'):(it?'Prossima posizione':'Next position')}</button>}
    <button className="training-source" onClick={()=>onSource(card.game,card.result.ply)}>{it?'Apri posizione originale':'Open source position'}</button>
    <details><summary>{it?'Partita originale':'Original game'}</summary><p>{card.game.headers.White} — {card.game.headers.Black} · {Math.ceil(card.result.ply/2)}{card.result.color==='b'?'…':'.'}</p><p>{describeMove(card.fen,card.result.move,{language,playerColor:card.result.color})}</p>{coaching&&<><p>{coaching.text}</p><p>{coaching.detail}</p></>}</details>
   </div>
  </section>}
 </main>;
}
