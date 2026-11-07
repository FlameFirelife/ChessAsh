import {Chess} from 'chess.js';
import {describeMove,explainMoveInsight} from './coaching';
import {findMoveInsights} from './moveInsight';
import type {TrainingCard,TrainingHistory,TrainingPattern} from './training';

export function mixedTrainingSession(queue:TrainingCard[],limit=5):TrainingCard[] {
 const remaining=[...queue],selected:TrainingCard[]=[];
 const patterns=new Map<TrainingPattern,number>(),games=new Map<string,number>();
 while(remaining.length&&selected.length<limit) {
  let index=0,best=Infinity;
  remaining.forEach((card,i)=>{
   const penalty=(patterns.get(card.pattern)||0)*3+(games.get(card.game.id)||0)*2+i/Math.max(1,remaining.length);
   if(penalty<best){best=penalty;index=i;}
  });
  const [card]=remaining.splice(index,1);selected.push(card);
  patterns.set(card.pattern,(patterns.get(card.pattern)||0)+1);games.set(card.game.id,(games.get(card.game.id)||0)+1);
 }
 return selected;
}
export interface SessionOutcome {card:TrainingCard;attempts:number;solved:boolean;assisted:boolean;due:number}
export function summarizeTraining(session:TrainingCard[],outcomes:Record<string,SessionOutcome>,history:TrainingHistory) {
 const completed=session.map(card=>outcomes[card.id]).filter(Boolean);
 return {total:session.length,solved:completed.filter(r=>r.solved).length,independent:completed.filter(r=>r.solved&&!r.assisted&&r.attempts===1).length,retried:completed.filter(r=>r.solved&&!r.assisted&&r.attempts>1).length,assisted:completed.filter(r=>r.assisted).length,retry:completed.filter(r=>!r.solved||r.assisted||r.attempts>1).map(r=>r.card),nextDue:completed.length?Math.min(...completed.map(r=>history[r.card.id]?.due||r.due)):0};
}
export interface TrainingReply {beforeFen:string;fen:string;move:string;text:string}
export function trainingReplyLine(fen:string,pv:string[],language:'en'|'it',playerColor:'w'|'b',origin?:{fen:string;move:string}):TrainingReply[] {
 const board=new Chess(fen),steps:TrainingReply[]=[];
 const insight=(()=>{if(!origin)return undefined;try{const test=new Chess(origin.fen);test.move({from:origin.move.slice(0,2),to:origin.move.slice(2,4),promotion:origin.move[4]});return test.fen().split(' ').slice(0,4).join(' ')===fen.split(' ').slice(0,4).join(' ')?findMoveInsights(origin.fen,origin.move,pv)[0]:undefined;}catch{return undefined;}})();
 const reason=insight?explainMoveInsight(insight,{language,playerColor}).text:'';
 for(const uci of pv.slice(0,4)) {
  if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))break;
  const before=board.fen(),side=board.turn();
  try {
   const move=board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
   const description=describeMove(before,uci,{language,playerColor});
   const actor=language==='it'?(side===playerColor?'Puoi':'Il tuo avversario può'):(side===playerColor?'You can':'Your opponent can');
   steps.push({beforeFen:before,fen:board.fen(),move:move.lan,text:(steps.length===0&&reason?reason+' ':'')+actor+' '+description+'.'});
  }catch {break;}
 }
 return steps;
}
