import {Chess} from 'chess.js';
import type {Move,Square} from 'chess.js';
export interface TrainingEvidence {bestCapture:boolean;bestCheck:boolean;replyDanger:boolean;undefended:boolean;fork:boolean;backrank:boolean}
const play=(board:Chess,uci:string)=>board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
function backRankMate(board:Chess,move:Move):boolean {
 if(!board.isCheckmate()||!['r','q'].includes(move.piece))return false;
 const side=board.turn(),rank=side==='w'?'1':'8',shield=side==='w'?'2':'7';
 const king=board.board().flat().find(p=>p?.type==='k'&&p.color===side);
 if(!king||king.square[1]!==rank||move.to[1]!==rank)return false;
 let pawns=0;for(const offset of [-1,0,1]){const file=king.square.charCodeAt(0)+offset;if(file<97||file>104)continue;const p=board.get((String.fromCharCode(file)+shield) as Square);if(p?.color===side&&p.type==='p')pawns++;}
 return pawns>=2;
}
export function trainingEvidence(fen:string,played:string,best:string,reply?:string):TrainingEvidence {
 const bestBoard=new Chess(fen),bestMove=play(bestBoard,best);
 const playedBoard=new Chess(fen);play(playedBoard,played);
 const evidence:TrainingEvidence={bestCapture:!!bestMove.captured,bestCheck:bestBoard.isCheck(),replyDanger:false,undefended:false,fork:false,backrank:backRankMate(bestBoard,bestMove)};
 if(['n','p'].includes(bestMove.piece)) {
  const fields=bestBoard.fen().split(' ');fields[1]=bestMove.color;fields[3]='-';
  const legal=new Chess(fields.join(' ')).moves({square:bestMove.to,verbose:true});
  const targets=bestBoard.board().flat().filter(p=>p&&p.color!==bestMove.color&&p.type!=='p'&&bestBoard.attackers(p.square,bestMove.color).includes(bestMove.to)&&
   (p.type==='k'?bestBoard.isCheck():legal.some(move=>move.to===p.square)));
  evidence.fork=targets.length>=2;
 }
 if(reply){
  const board=playedBoard;
  const targetSquare=reply.slice(2,4) as Square,target=board.get(targetSquare);
  const unprotected=!!target&&!['p','k'].includes(target.type)&&board.attackers(targetSquare,target.color).length===0;
  const response=play(board,reply);
  evidence.replyDanger=!!response.captured||board.isCheck();
  evidence.undefended=!!response.captured&&unprotected;
  evidence.backrank=evidence.backrank||backRankMate(board,response);
 }
 return evidence;
}
