export type TrainingFocus = 'capture'|'check'|'reply'|'improve'|'undefended'|'fork'|'backrank';
export interface TrainingPolicyFact {
 bestCapture:boolean; bestCheck:boolean; replyDanger:boolean;
 undefended?:boolean;fork?:boolean;backrank?:boolean;
 loss:number; attempts:number; solved:number; streak:number; passed:boolean;
}
export interface TrainingDecision {focus:TrainingFocus;priority:number;intervalSeconds:number}
export function defaultTrainingDecisions(facts:TrainingPolicyFact[]):TrainingDecision[] {
 const focuses:TrainingFocus[]=facts.map(f=>f.backrank?'backrank':f.fork?'fork':f.undefended?'undefended':f.replyDanger?'reply':f.bestCapture?'capture':f.bestCheck?'check':'improve');
 const counts=new Map<string,number>();for(const focus of focuses)counts.set(focus,(counts.get(focus)||0)+1);
 return facts.map((fact,index)=>({focus:focuses[index],priority:(fact.attempts?(fact.attempts-fact.solved)*4:3)+(counts.get(focuses[index])||0)+Math.min(600,fact.loss)/100,intervalSeconds:fact.passed?[86400,259200,604800,1209600,2592000][Math.min(fact.streak,4)]:600}));
}
export async function trainingDecisions(facts:TrainingPolicyFact[]):Promise<TrainingDecision[]> {
 if(window.chessash?.platform==='windows') {
  if(typeof window.chessash.trainingDecisions!=='function')throw new Error('Training policy unavailable. Restart or update ChessAsh.');
  return window.chessash.trainingDecisions(facts);
 }
 return defaultTrainingDecisions(facts);
}
