import type {TrainingCard,TrainingPattern} from './training';
import type {SessionOutcome} from './trainingSession';
export const trainingFocuses:TrainingPattern[]=['capture','check','reply','improve','undefended','fork','backrank'];
export interface PracticeEvent {session:string;card:string;pattern:TrainingPattern;at:number;independent:boolean;assisted:boolean;attempts:number}
export function loadPracticeEvents(key:string):PracticeEvent[] {
 try{
  const raw=JSON.parse(localStorage.getItem(key+':events')||'[]');if(!Array.isArray(raw))return [];
  return raw.filter((e):e is PracticeEvent=>e&&typeof e.session==='string'&&typeof e.card==='string'&&trainingFocuses.includes(e.pattern)&&Number.isFinite(e.at)&&e.at>=0&&typeof e.independent==='boolean'&&typeof e.assisted==='boolean'&&!(e.independent&&e.assisted)&&Number.isSafeInteger(e.attempts)&&e.attempts>0).slice(-2000);
 }catch{return [];}
}
export function mergePracticeEvents(previous:PracticeEvent[],session:string,cards:TrainingCard[],outcomes:Record<string,SessionOutcome>,now=Date.now()):PracticeEvent[] {
 const entries=cards.flatMap(card=>{const r=outcomes[card.id];return r?[{session,card:card.id,pattern:card.pattern,at:now,independent:r.solved&&!r.assisted,assisted:r.assisted,attempts:r.attempts}]:[];});
 const ids=new Set(entries.map(e=>JSON.stringify([e.session,e.card])));
 return [...previous.filter(e=>!ids.has(JSON.stringify([e.session,e.card]))),...entries].slice(-2000);
}
export function practiceTrends(events:PracticeEvent[]) {
 return trainingFocuses.flatMap(pattern=>{
  const rows=events.filter(e=>e.pattern===pattern).sort((a,b)=>a.at-b.at);
  if(!rows.length)return [];
  const recent=rows.slice(-5),earlier=rows.slice(-10,-5);
  const score=(list:PracticeEvent[])=>list.filter(e=>e.independent).length;
  const comparable=recent.length===5&&earlier.length===5&&new Set(rows.slice(-10).map(e=>e.session)).size>=2;
  return [{pattern,recent:score(recent),recentTotal:recent.length,earlier:score(earlier),earlierTotal:earlier.length,sessions:new Set(rows.map(e=>e.session)).size,delta:comparable?(score(recent)-score(earlier))*20:null}];
 });
}
