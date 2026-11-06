import {afterEach,describe,it,expect,vi} from 'vitest';
import {Chess} from 'chess.js';
import type {TrainingCard} from '../src/core/training';
import {emptyTraining,persistTraining,restoreTraining} from '../src/core/trainingResume';
import {trainingReplyLine} from '../src/core/trainingSession';
import {mergePracticeEvents,practiceTrends,loadPracticeEvents} from '../src/core/trainingProgress';
const board=new Chess();for(const move of ['f3','e5'])board.move(move);
const card={id:'position',fen:board.fen(),pattern:'reply',result:{best:'b1c3',color:'w'},game:{id:'source'}} as TrainingCard;
function storage(){const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});return data;}
afterEach(()=>vi.unstubAllGlobals());
describe('resumable training',()=>{
 it('restores the current exercise and safely restarts interrupted analysis',()=>{
  storage();persistTraining('mine',{...emptyTraining(),id:'session',session:[card],state:'checking',attempt:'g2g4'});
  const restored=restoreTraining('mine',[card],'en');expect(restored.session[0].id).toBe(card.id);expect(restored.state).toBe('ready');expect(restored.fen).toBe(card.fen);expect(restored.attempt).toBe('');
 });
 it('restores a failed result, its legal reply preview and localized text',()=>{
  storage();const played=new Chess(card.fen);played.move('g4');const reply=trainingReplyLine(played.fen(),['d8h4'],'en','w');
  persistTraining('mine',{...emptyTraining(),id:'session',session:[card],state:'missed',attempt:'g2g4',reply,replyIndex:0,outcomes:{position:{card,solved:false,assisted:false,attempts:1,due:1000}}});
  const restored=restoreTraining('mine',[card],'it');expect(restored.move).toBe('d8h4');expect(new Chess(restored.fen).isCheckmate()).toBe(true);expect(restored.reply[0].text).toContain('scacco matto');expect(restored.outcomes.position.attempts).toBe(1);
 });
 it('rejects deleted/reanalyzed exercises and corrupt snapshots',()=>{
  const data=storage();persistTraining('mine',{...emptyTraining(),id:'session',session:[card]});expect(restoreTraining('mine',[],'en').session).toEqual([]);
  data.set('mine:session','{"version":1,"id":"x","cards":[null],"index":0}');expect(restoreTraining('mine',[card],'en').session).toEqual([]);
 });
 it('keeps accounts separate and removes completed sessions',()=>{
  const data=storage();persistTraining('mine',{...emptyTraining(),id:'session',session:[card]});expect(restoreTraining('other',[card],'en').session).toEqual([]);
  persistTraining('mine',{...emptyTraining(),id:'session',session:[card],index:1});expect(data.has('mine:session')).toBe(false);
 });
});
describe('practice trends',()=>{
 it('records completed positions once per session and keeps assistance separate',()=>{
  const outcomes={position:{card,solved:true,assisted:true,attempts:2,due:1000}};
  const once=mergePracticeEvents([],'one',[card],outcomes,100);const twice=mergePracticeEvents(once,'one',[card],outcomes,100);
  expect(twice).toHaveLength(1);expect(twice[0].independent).toBe(false);expect(practiceTrends(twice)[0].delta).toBe(null);
 });
 it('compares two complete five-position windows across sessions',()=>{
  const events=Array.from({length:10},(_,i)=>({session:i<5?'before':'after',card:String(i),pattern:'reply' as const,at:i,independent:i>=5,assisted:false,attempts:1}));
  const trend=practiceTrends(events)[0];expect(trend.recent).toBe(5);expect(trend.earlier).toBe(0);expect(trend.delta).toBe(100);expect(trend.sessions).toBe(2);
  expect(practiceTrends(events.map(e=>({...e,session:'single'})))[0].delta).toBe(null);
 });
 it('keeps bounded, validated history without changing older aggregate records',()=>{
  const data=storage();data.set('mine:events',JSON.stringify([{session:'x',card:'y',pattern:'fake',at:0,independent:true,assisted:false,attempts:1}]));expect(loadPracticeEvents('mine')).toEqual([]);
  const previous=Array.from({length:2000},(_,i)=>({session:String(i),card:String(i),pattern:'reply' as const,at:i,independent:true,assisted:false,attempts:1}));
  expect(mergePracticeEvents(previous,'new',[card],{position:{card,solved:true,assisted:false,attempts:1,due:0}})).toHaveLength(2000);expect(previous).toHaveLength(2000);
 });
});
