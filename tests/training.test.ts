import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { acceptableTrainingMove, recordTraining, trainingCards, trainingQueue, trainingStorageKey } from '../src/core/training';
import type { EngineResult, Game, MoveReview } from '../src/core/types';

function game():Game {
 const chess=new Chess();const moves=['f3','e5','g4','Qh4#'];const positions=[chess.fen()];const results:MoveReview[]=[];
 moves.forEach((san,index)=>{const m=chess.move(san);positions.push(chess.fen());results.push({ply:index+1,move:m.lan,color:m.color,before:0,after:0,loss:150,label:'mistake',best:index===2?'b1c3':m.lan,pv:[],depth:12,explanation:'',hints:[],key:true,replyPv:index===2?['d8h4']:[]});});
 return {id:'mine',pgn:chess.pgn(),headers:{White:'FlameDev',Black:'Opponent'},moves,positions,source:'PGN',review:{version:1,engine:'fixture',depth:12,results,completed:true}};
}
const evaluation=(score:number,mate?:number):EngineResult=>({fen:'',depth:12,score,mate,best:'',pv:[],lines:[]});
describe('personalized training',()=>{
 it('uses only the identified player’s completed reviewed mistakes',()=>{
  const mine=game();expect(trainingCards([mine],'flamedev')).toHaveLength(1);
  expect(trainingCards([mine],'opponent')).toHaveLength(0);
  expect(trainingCards([mine],'guest')).toHaveLength(0);
  mine.review!.completed=false;expect(trainingCards([mine],'FlameDev')).toHaveLength(0);
 });
 it('supports explicitly selected PGN sides and excludes samples/neutral games',()=>{
  const mine=game();mine.reviewAs='w';expect(trainingCards([mine],'')).toHaveLength(1);
  mine.reviewAs='neutral';expect(trainingCards([mine],'FlameDev')).toHaveLength(0);
  mine.reviewAs='w';mine.source='Sample';expect(trainingCards([mine],'')).toHaveLength(0);
 });
 it('grounds reply patterns in legal continuations and deduplicates positions',()=>{
  const mine=game();const cards=trainingCards([mine,{...mine,id:'duplicate'}],'FlameDev');
  expect(cards).toHaveLength(1);expect(cards[0].pattern).toBe('reply');
  mine.review!.results[2].best='a1a8';expect(trainingCards([mine],'FlameDev')).toHaveLength(0);
 });
 it('does not train positions already lost to a forced mate',()=>{
  const mine=game();mine.review!.results[2].before=-30000;
  expect(trainingCards([mine],'FlameDev')).toHaveLength(0);
 });
 it('schedules missed positions sooner and successful ones further apart',()=>{
  const card=trainingCards([game()],'FlameDev')[0];const success=recordTraining(undefined,true,100);
  expect(trainingQueue([card],{[card.id]:success},101)).toHaveLength(0);
  expect(trainingQueue([card],{[card.id]:success},success.due)).toHaveLength(1);
  const miss=recordTraining(success,false,200);expect(miss.streak).toBe(0);expect(miss.due).toBeLessThan(success.due);
  const second=recordTraining(success,true,success.due);expect(second.due-second.last).toBe(3*86400000);
 });
 it('accepts sound alternatives with correct score orientation for both sides',()=>{
  expect(acceptableTrainingMove(evaluation(100),evaluation(60),'w')).toBe(true);
  expect(acceptableTrainingMove(evaluation(100),evaluation(-100),'w')).toBe(false);
  expect(acceptableTrainingMove(evaluation(-100),evaluation(-60),'b')).toBe(true);
  expect(acceptableTrainingMove(evaluation(-100),evaluation(100),'b')).toBe(false);
  expect(acceptableTrainingMove(evaluation(29000,3),evaluation(150),'w')).toBe(false);
  expect(acceptableTrainingMove(evaluation(29000,3),evaluation(29000,5),'w')).toBe(true);
  expect(acceptableTrainingMove(evaluation(29000,3),evaluation(30000,0),'w')).toBe(true);
  expect(acceptableTrainingMove(evaluation(-100),evaluation(30000,0),'b')).toBe(false);
 });
 it('keeps player progress separate and leaves saved reviews unchanged',()=>{
  const mine=game();const original=JSON.stringify(mine);const cards=trainingCards([mine],'FlameDev');recordTraining(undefined,true);trainingQueue(cards,{});
  expect(JSON.stringify(mine)).toBe(original);
  expect(trainingStorageKey(' FlameDev ')).toBe(trainingStorageKey('flamedev'));
  expect(trainingStorageKey('opponent')).not.toBe(trainingStorageKey('flamedev'));
 });
});
