import { Chess } from 'chess.js';
import { playerColorFor } from './perspective';
import type { EngineResult, Game, MoveReview } from './types';
import { defaultTrainingDecisions } from './trainingPolicy';
import type { TrainingPolicyFact } from './trainingPolicy';
import type {TrainingFocus} from './trainingPolicy';
import {trainingEvidence} from './trainingTactics';
import type {TrainingEvidence} from './trainingTactics';

export type TrainingPattern = TrainingFocus;
export interface TrainingCard { id: string; game: Game; result: MoveReview; fen: string; pattern: TrainingPattern; evidence:TrainingEvidence }
export interface TrainingRecord { attempts: number; solved: number; streak: number; due: number; last: number }
export type TrainingHistory = Record<string, TrainingRecord>;

export function trainingCards(games: Game[], username: string): TrainingCard[] {
 const cards: TrainingCard[]=[];
 const positions=new Set<string>();
 for(const game of games) {
  const side=playerColorFor(game,username);
  if(!side||!game.review?.completed||/sample/i.test(game.source))continue;
  for(const result of game.review.results) {
   if(result.color!==side||!['inaccuracy','mistake','blunder','miss'].includes(result.label)||result.best===result.move||result.depth<8)continue;
   const fen=game.positions[result.ply-1];
   try {
    const before=new Chess(fen);
    if(before.turn()!==side||before.moves().length<2||result.before*(side==='w'?1:-1)<=-29000)continue;
    const evidence=trainingEvidence(fen,result.move,result.best,result.replyPv?.[0]);
    const position=fen.split(' ').slice(0,4).join(' ');
    if(positions.has(position))continue;
    positions.add(position);
    const pattern=defaultTrainingDecisions([{...evidence,loss:result.loss,attempts:0,solved:0,streak:0,passed:false}])[0].focus;
    cards.push({id:game.id+':'+result.ply+':'+result.best,game,result,fen,pattern,evidence});
   }catch { continue; }
  }
 }
 return cards;
}

export function trainingFact(card:TrainingCard,previous?:TrainingRecord,passed=false):TrainingPolicyFact {
 return {...card.evidence,loss:Math.max(0,card.result.loss),attempts:previous?.attempts||0,solved:previous?.solved||0,streak:previous?.streak||0,passed};
}

export function trainingQueue(cards: TrainingCard[], history: TrainingHistory, now=Date.now(), priorities?:Record<string,number>): TrainingCard[] {
 const defaults=priorities?undefined:defaultTrainingDecisions(cards.map(card=>trainingFact(card,history[card.id])));
 const scores=priorities||Object.fromEntries(cards.map((card,index)=>[card.id,defaults![index].priority]));
 return cards.filter(card=>!history[card.id]||history[card.id].due<=now).sort((a,b)=>scores[b.id]-scores[a.id]||a.id.localeCompare(b.id));
}

export function recordTraining(previous: TrainingRecord|undefined, solved: boolean, now=Date.now(), intervalSeconds?:number): TrainingRecord {
 const streak=solved?(previous?.streak||0)+1:0;
 const seconds=intervalSeconds??defaultTrainingDecisions([{bestCapture:false,bestCheck:false,replyDanger:false,loss:0,attempts:previous?.attempts||0,solved:previous?.solved||0,streak:previous?.streak||0,passed:solved}])[0].intervalSeconds;
 return {attempts:(previous?.attempts||0)+1,solved:(previous?.solved||0)+(solved?1:0),streak,due:now+seconds*1000,last:now};
}

export function acceptableTrainingMove(before: EngineResult, after: EngineResult, side:'w'|'b'): boolean {
 const direction=side==='w'?1:-1;
 const winningMate=(value:EngineResult)=>value.mate!==undefined&&(value.mate===0?value.score*direction>0:value.mate*direction>0);
 if(before.mate!==undefined||after.mate!==undefined) {
  if(winningMate(before))return winningMate(after);
  if(after.mate!==undefined)return winningMate(after);
  return false;
 }
 return (before.score-after.score)*direction<=60;
}

export function trainingStorageKey(username: string): string { return 'chessash:training:v1:'+encodeURIComponent(username.trim().toLowerCase()||'selected-pgn-sides'); }

export function loadTrainingHistory(key: string): TrainingHistory {
 try {
  const raw=JSON.parse(localStorage.getItem(key)||'{}');
  const valid:TrainingHistory={};
  for(const [id,value] of Object.entries(raw)) {
   const record=value as TrainingRecord;
   if(record&&['attempts','solved','streak','due','last'].every(field=>typeof record[field as keyof TrainingRecord]==='number'&&Number.isFinite(record[field as keyof TrainingRecord])&&record[field as keyof TrainingRecord]>=0)&&['attempts','solved','streak'].every(field=>Number.isSafeInteger(record[field as keyof TrainingRecord])&&record[field as keyof TrainingRecord]<=1000000)&&record.solved<=record.attempts&&record.streak<=record.solved)valid[id]=record;
  }
  return valid;
 }catch { return {}; }
}
