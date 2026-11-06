import {describe,it,expect} from 'vitest';
import {trainingEvidence} from '../src/core/trainingTactics';
import {mixedTrainingSession,summarizeTraining,trainingReplyLine} from '../src/core/trainingSession';
import type {TrainingCard,TrainingPattern} from '../src/core/training';
import {Chess} from 'chess.js';
describe('specific training motifs',()=>{
 it('recognizes a legal knight fork',()=>{
  expect(trainingEvidence('4k3/7q/8/3N4/8/8/8/K7 w - - 0 1','d5b4','d5f6').fork).toBe(true);
 });
 it('does not count captures that expose the player’s king as a fork',()=>{
  expect(trainingEvidence('4qr1k/7q/8/3N4/8/8/8/5K2 w - - 0 1','f1g1','d5f6').fork).toBe(false);
 });
 it('distinguishes an undefended piece from a defended one',()=>{
  expect(trainingEvidence('k6r/8/8/8/7B/8/P7/K7 w - - 0 1','a2a3','h4g3','h8h4').undefended).toBe(true);
  expect(trainingEvidence('k6r/8/8/8/7B/5N2/P7/K7 w - - 0 1','a2a3','h4g3','h8h4').undefended).toBe(false);
 });
 it('requires checkmate and a pawn shield for a back-rank motif',()=>{
  expect(trainingEvidence('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1','e1e2','e1e8').backrank).toBe(true);
  expect(trainingEvidence('6k1/8/8/8/8/8/8/4R1K1 w - - 0 1','e1e2','e1e8').backrank).toBe(false);
 });
});
const card=(id:string,pattern:TrainingPattern,gameId=id)=>({id,pattern,game:{id:gameId}} as TrainingCard);
describe('training sessions',()=>{
 it('keeps the highest-priority first card and adds pattern/game variety',()=>{
  const cards=[card('a','reply','same'),card('b','reply','same'),card('c','reply','same'),card('d','fork'),card('e','capture'),card('f','check')];
  const chosen=mixedTrainingSession(cards);expect(chosen[0].id).toBe('a');expect(chosen[1].id).toBe('d');expect(new Set(chosen.map(c=>c.pattern)).size).toBe(4);expect(chosen).toHaveLength(5);expect(cards[1].id).toBe('b');
 });
 it('fills focused practice and handles short queues without repeats',()=>{
  const cards=[card('a','fork'),card('b','fork')];expect(mixedTrainingSession(cards)).toHaveLength(2);expect(mixedTrainingSession([])).toEqual([]);
 });
 it('separates first-try solves, retries and revealed solutions in the recap',()=>{
  const cards=[card('a','fork'),card('b','reply'),card('c','capture'),card('d','check')];
  const outcome=(i:number,solved:boolean,assisted:boolean,attempts:number)=>({card:cards[i],solved,assisted,attempts,due:1000+i});
  const summary=summarizeTraining(cards,{a:outcome(0,true,false,1),b:outcome(1,true,false,2),c:outcome(2,true,true,2),d:outcome(3,false,false,1)},{});
  expect(summary.independent).toBe(1);expect(summary.retried).toBe(1);expect(summary.assisted).toBe(1);expect(summary.retry.map(c=>c.id)).toEqual(['b','c','d']);expect(summary.nextDue).toBe(1000);
 });
 it('explains and plays only legal replies from the attempted position',()=>{
  const board=new Chess();for(const m of ['f3','e5','g4'])board.move(m);
  const reply=trainingReplyLine(board.fen(),['d8h4','e1e3'],'en','w');
  expect(reply).toHaveLength(1);expect(reply[0].text).toContain('Your opponent can move the queen from d8 to h4');expect(reply[0].text).toContain('checkmate');expect(new Chess(reply[0].fen).isCheckmate()).toBe(true);
  expect(trainingReplyLine(board.fen(),['d8h4'],'it','w')[0].text).toContain('scacco matto');
 });
});
