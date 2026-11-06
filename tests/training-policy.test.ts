import { describe,expect,it } from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {defaultTrainingDecisions} from '../src/core/trainingPolicy';
import type {TrainingPolicyFact} from '../src/core/trainingPolicy';
const require=createRequire(import.meta.url);
const policy=require('../electron/training-policy.cjs');
const fact=(changes:Partial<TrainingPolicyFact>={}):TrainingPolicyFact=>({bestCapture:false,bestCheck:false,replyDanger:false,loss:150,attempts:0,solved:0,streak:0,passed:false,...changes});
describe('Foxash training decisions',()=>{
 it('matches Android focus, priority and repeat intervals through the actual runtime',async()=>{
  const facts:TrainingPolicyFact[]=[];
  for(const bestCapture of [false,true])for(const bestCheck of [false,true])for(const replyDanger of [false,true])for(const streak of [0,1,2,3,4,10])for(const passed of [false,true])facts.push(fact({bestCapture,bestCheck,replyDanger,streak,passed,attempts:streak+3,solved:streak+1,loss:streak?1000:45}));
  expect(await policy.trainingDecisions(facts,process.cwd())).toEqual(defaultTrainingDecisions(facts));
  const motifs=[];for(const undefended of [false,true])for(const fork of [false,true])for(const backrank of [false,true])motifs.push(fact({undefended,fork,backrank,replyDanger:true,bestCheck:true,bestCapture:true}));
  expect(await policy.trainingDecisions(motifs,process.cwd())).toEqual(defaultTrainingDecisions(motifs));
  expect(await policy.trainingDecisions([],process.cwd())).toEqual([]);
 });
 it('ranks repeated weaknesses and failed exercises ahead of otherwise equal new cards',async()=>{
  const facts=[fact({bestCapture:true}),fact({replyDanger:true}),fact({replyDanger:true,attempts:3,solved:1,streak:0})];
  const output=await policy.trainingDecisions(facts,process.cwd());
  expect(output[1].priority).toBeGreaterThan(output[0].priority);
  expect(output[2].priority).toBeGreaterThan(output[1].priority);
 });
 it('changes real decisions when the bundled Foxash rules change',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'chessash-training-test-'));
  try {
   await mkdir(path.join(folder,'resources/foxash'),{recursive:true});await mkdir(path.join(folder,'rules'));
   await copyFile('resources/foxash/foxash.exe',path.join(folder,'resources/foxash/foxash.exe'));
   const source=await readFile('rules/training.foxash','utf8');
   const changed=source.replace('errors * 4','errors * 20').replace('give 86400','give 172800').replace('when fact["replyDanger"] { give "reply" }','when fact["replyDanger"] { give "improve" }');
   expect(changed).not.toBe(source);await writeFile(path.join(folder,'rules/training.foxash'),changed);
   const facts=[fact({replyDanger:true,attempts:1,passed:true})];
   const [normal]=await policy.trainingDecisions(facts,process.cwd());const [modified]=await policy.trainingDecisions(facts,folder);
   expect(modified.focus).toBe('improve');expect(normal.focus).toBe('reply');
   expect(modified.priority-normal.priority).toBe(16);expect(modified.intervalSeconds).toBe(172800);
  }finally{await rm(folder,{recursive:true,force:true});}
 });
 it('rejects invalid evidence and impossible practice records',async()=>{
  for(const invalid of [null,[fact({loss:NaN})],[fact({attempts:-1})],[fact({solved:3,attempts:1})],[fact({streak:2,solved:1,attempts:3})],[fact({bestCheck:'yes' as unknown as boolean})]])await expect(policy.trainingDecisions(invalid,process.cwd())).rejects.toThrow();
 });
 it('fails visibly for missing or malformed Foxash policies',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'chessash-training-invalid-'));
  try{
   await expect(policy.trainingDecisions([fact()],folder)).rejects.toThrow('missing');
   await mkdir(path.join(folder,'resources/foxash'),{recursive:true});await mkdir(path.join(folder,'rules'));
   await copyFile('resources/foxash/foxash.exe',path.join(folder,'resources/foxash/foxash.exe'));
   await writeFile(path.join(folder,'rules/training.foxash'),'define rows = [["reply", 1, -50]]\nsave rows to "training-policy.json"\n');
   await expect(policy.trainingDecisions([fact()],folder)).rejects.toThrow('invalid training decisions');
  }finally{await rm(folder,{recursive:true,force:true});}
 });
});
