import {afterEach,expect,it,vi} from 'vitest';
import {trainingDecisions,defaultTrainingDecisions} from '../src/core/trainingPolicy';
import {loadTrainingHistory} from '../src/core/training';
const facts=[{bestCapture:true,bestCheck:false,replyDanger:false,loss:150,attempts:0,solved:0,streak:0,passed:false}];
afterEach(()=>vi.unstubAllGlobals());
it('uses matching shared defaults on Android',async()=>{
 vi.stubGlobal('window',{});expect(await trainingDecisions(facts)).toEqual(defaultTrainingDecisions(facts));
});
it('uses Foxash responses on Windows without substituting defaults',async()=>{
 const changed=[{focus:'check',priority:100,intervalSeconds:172800}];const bridge=vi.fn().mockResolvedValue(changed);
 vi.stubGlobal('window',{chessash:{platform:'windows',trainingDecisions:bridge}});
 expect(await trainingDecisions(facts)).toBe(changed);expect(bridge).toHaveBeenCalledWith(facts);
});
it('surfaces Windows policy failures instead of silently switching policy',async()=>{
 vi.stubGlobal('window',{chessash:{platform:'windows',trainingDecisions:vi.fn().mockRejectedValue(new Error('Policy failed'))}});
 await expect(trainingDecisions(facts)).rejects.toThrow('Policy failed');
 vi.stubGlobal('window',{chessash:{platform:'windows'}});await expect(trainingDecisions(facts)).rejects.toThrow('unavailable');
});
it('ignores impossible stored practice history before it reaches the policy',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({invalid:{attempts:1,solved:3,streak:0,due:0,last:0},valid:{attempts:2,solved:1,streak:0,due:0,last:0}})});
 expect(Object.keys(loadTrainingHistory('fixture'))).toEqual(['valid']);
});
