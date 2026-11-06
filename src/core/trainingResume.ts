import {playUci} from './pgn';
import type {TrainingCard} from './training';
import {trainingFocuses} from './trainingProgress';
import {trainingReplyLine} from './trainingSession';
import type {TrainingReply,SessionOutcome} from './trainingSession';
export type PracticeState='ready'|'checking'|'correct'|'missed'|'revealed'|'error';
export interface ResumedTraining {session:TrainingCard[];id:string;index:number;state:PracticeState;fen:string;move:string;attempt:string;reply:TrainingReply[];replyIndex:number;outcomes:Record<string,SessionOutcome>}
export function emptyTraining():ResumedTraining{return {session:[],id:'',index:0,state:'ready',fen:'',move:'',attempt:'',reply:[],replyIndex:-1,outcomes:{}};}
export function restoreTraining(key:string,cards:TrainingCard[],language:'en'|'it'):ResumedTraining {
 try{
  const saved=JSON.parse(localStorage.getItem(key+':session')||'null');
  if(!saved||saved.version!==1||typeof saved.id!=='string'||!Array.isArray(saved.cards)||saved.cards.length<1||saved.cards.length>5||new Set(saved.cards.map((c:{id:string})=>c.id)).size!==saved.cards.length||!Number.isInteger(saved.index)||saved.index<0||saved.index>=saved.cards.length)return emptyTraining();
  const session:TrainingCard[]=saved.cards.map((entry:{id:string;pattern:string})=>{
   const card=cards.find(c=>c.id===entry.id);if(!card||!trainingFocuses.includes(entry.pattern as TrainingCard['pattern']))throw new Error('Stale exercise');
   return {...card,pattern:entry.pattern};
  });
  const outcomes:Record<string,SessionOutcome>={};
  for(const card of session){const r=saved.outcomes?.[card.id];if(r&&Number.isSafeInteger(r.attempts)&&r.attempts>0&&r.attempts<=1000000&&typeof r.solved==='boolean'&&typeof r.assisted==='boolean'&&Number.isFinite(r.due)&&r.due>=0)outcomes[card.id]={...r,card};}
  const card=session[saved.index];
  let state:PracticeState=['ready','correct','missed','revealed'].includes(saved.state)?saved.state:'ready';
  if(state!=='ready'&&!outcomes[card.id])state='ready';
  const attempt=typeof saved.attempt==='string'?saved.attempt:'';
  const played=playUci(card.fen,attempt);
  let fen=card.fen,move='',reply:TrainingReply[]=[],replyIndex=-1;
  if(state==='revealed'){const solution=playUci(card.fen,card.result.best);if(!solution)return emptyTraining();fen=solution.fen;move=card.result.best;}
  else if(state==='correct'||state==='missed'){
   if(!played)return emptyTraining();fen=played.fen;move=attempt;
   if(state==='missed'&&Array.isArray(saved.reply)&&saved.reply.every((m:unknown)=>typeof m==='string')){
    reply=trainingReplyLine(fen,saved.reply,language,card.result.color);
    if(Number.isInteger(saved.replyIndex)&&saved.replyIndex>=0&&saved.replyIndex<reply.length){replyIndex=saved.replyIndex;fen=reply[replyIndex].fen;move=reply[replyIndex].move;}
   }
  }
  return {session,id:saved.id,index:saved.index,state,fen,move,attempt:state==='ready'?'':attempt,reply,replyIndex,outcomes};
 }catch{return emptyTraining();}
}
export function persistTraining(key:string,data:ResumedTraining) {
 if(!data.session.length||data.index>=data.session.length){localStorage.removeItem(key+':session');return;}
 const outcomes=Object.fromEntries(Object.entries(data.outcomes).map(([id,{attempts,solved,assisted,due}])=>[id,{attempts,solved,assisted,due}]));
 localStorage.setItem(key+':session',JSON.stringify({version:1,id:data.id,cards:data.session.map(c=>({id:c.id,pattern:c.pattern})),index:data.index,state:data.state,attempt:data.attempt,reply:data.reply.map(r=>r.move),replyIndex:data.replyIndex,outcomes}));
}
