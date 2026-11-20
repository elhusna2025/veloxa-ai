import type OpenAI from 'openai';
import {ApiError} from './http';
interface Input {agent_id:string;agent?:{model:string};environment:{type:'none'};input:string;stream:true}
export interface ContentAgentCheckpointState { sessionId: string; turnId?: string; completed?: boolean }
export interface ContentAgentCheckpoint {
 load(): Promise<ContentAgentCheckpointState | null>;
 save(value: ContentAgentCheckpointState): Promise<void>;
}
interface Options {checkpoint?:ContentAgentCheckpoint;timeoutMs?:number;pollMs?:number;now?:()=>number;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;log?:(event:Record<string,unknown>)=>void}
function pause(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(new Error('aborted'));return;}const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('aborted'));}signal.addEventListener('abort',abort,{once:true});});}
function fault(code:string,message:string,status=503){return new ApiError(status,message,code);}
/** One paid input, then bounded reads of its own canonical turn. Never recreate after a lost connection. */
export function createManagedAgentTransport(client:OpenAI,options:Options={}){
 return{beta:{agents:{retrieve:(id:string)=>client.beta.agents.retrieve(id),sessions:{create:async(input:Input)=>{
  const controller=new AbortController();let result:Promise<{output_text:string}>|undefined;
  const run=async()=>{const now=options.now||Date.now,started=now(),deadline=started+(options.timeoutMs??(options.checkpoint?45000:180000)),wait=options.wait||pause;let phase='create';
   let sessionId:string|undefined,turnId:string|undefined,deadlineExpired=false;
   const timer=setTimeout(()=>{deadlineExpired=true;controller.abort();},Math.max(1,deadline-now()));
   const expired=()=>{
    if(options.checkpoint&&sessionId&&(deadlineExpired||now()>=deadline))return fault('content_agent_pending','Naskah masih disusun. Proses yang sama akan dilanjutkan otomatis.',202);
    return fault('content_agent_timeout','Penyusunan naskah melewati waktu tunggu. Belum ada draf tersimpan; silakan coba lagi.',504);
   };
   const remaining=()=>{if(controller.signal.aborted||now()>=deadline)throw expired();return deadline-now();};
   const requestOptions=()=>({signal:controller.signal,timeout:Math.max(1,Math.min(20000,remaining())),maxRetries:0});
   const read=async<T>(fn:()=>PromiseLike<T>):Promise<T>=>{for(let attempt=0;;attempt++){remaining();try{return await fn();}catch(error){remaining();const e=error as{status?:number;name?:string};const transient=e.status===429||(e.status!==undefined&&e.status>=500)||['APIConnectionError','APIConnectionTimeoutError'].includes(e.name||'');if(!transient||attempt>=2)throw error;await wait(Math.min(1000*(attempt+1),remaining()),controller.signal);}}};
   try{
    const checkpoint=await options.checkpoint?.load();
    if(checkpoint){
     if(!/^sess_[a-zA-Z0-9_-]+$/.test(checkpoint.sessionId)||checkpoint.turnId!==undefined&&!/^turn_[a-zA-Z0-9_-]+$/.test(checkpoint.turnId))throw fault('invalid_content_agent_session','Identitas proses naskah tersimpan tidak valid.',502);
     sessionId=checkpoint.sessionId;turnId=checkpoint.turnId;
    }else{
     // Do not retry creation: an ambiguous write may already have started a paid turn.
     const session=await client.beta.agents.sessions.create({...input,stream:false},requestOptions());
     if(!session.id||!/^sess_[a-zA-Z0-9_-]+$/.test(session.id))throw fault('invalid_content_agent_session','Agen belum memberikan identitas proses yang valid.',502);
     sessionId=session.id;
     await options.checkpoint?.save({sessionId});
    }
    for(;;){remaining();phase='poll';let turn;
     if(turnId)turn=await read(()=>client.beta.agents.sessions.turns.retrieve(turnId!,{session_id:sessionId!},requestOptions()));
     else{const page=await read(()=>client.beta.agents.sessions.turns.list(sessionId!,{limit:3,order:'desc'},requestOptions()));const roots=page.data.filter(item=>!item.subagent_id);if(roots.length>1)throw fault('invalid_content_agent_turn','Agen memberikan proses yang tidak sesuai.',502);turn=roots[0];if(turn){
      if(turn.session_id!==sessionId||turn.agent_id!==input.agent_id||turn.subagent_id||!/^turn_[a-zA-Z0-9_-]+$/.test(turn.id))throw fault('invalid_content_agent_turn','Hasil agen berasal dari proses yang berbeda.',502);
      turnId=turn.id;await options.checkpoint?.save({sessionId:sessionId!,turnId});
     }}
     if(turn){if(turn.id!==turnId||turn.session_id!==sessionId||turn.agent_id!==input.agent_id||turn.subagent_id)throw fault('invalid_content_agent_turn','Hasil agen berasal dari proses yang berbeda.',502);
      if(turn.status==='completed'){phase='items';const page=await read(()=>client.beta.agents.sessions.turns.items.list(turnId!,{session_id:sessionId!,limit:100,order:'asc'},requestOptions()));if(page.hasNextPage())throw fault('invalid_content_agent_response','Hasil naskah terlalu besar untuk diperiksa.',502);
       remaining();
       const finals=page.data.filter(item=>item.type==='message'&&item.role==='assistant'&&item.phase==='final_answer');
       if(finals.length!==1)throw fault('invalid_content_agent_response','Hasil akhir naskah belum lengkap.',502);
       const item=finals[0];if(item.type!=='message'||item.turn_id!==turnId||item.status!=='completed')throw fault('invalid_content_agent_response','Hasil akhir naskah tidak sesuai proses.',502);
       const text=item.content.filter(part=>part.type==='output_text').map(part=>part.text).join('');if(!text.trim()||text.length>48000)throw fault('invalid_content_agent_response','Hasil akhir naskah tidak valid.',502);
       await options.checkpoint?.save({sessionId:sessionId!,turnId:turnId!,completed:true});
       remaining();
       return{output_text:text};
      }
      if(turn.status==='failed')throw fault('content_agent_failed','Agen belum berhasil menyelesaikan naskah. Silakan coba lagi.');
      if(turn.status==='cancelled')throw fault('content_agent_cancelled','Proses naskah dibatalkan sebelum selesai. Silakan coba lagi.');
      if(turn.status==='waiting')throw fault('content_agent_waiting','Agen meminta langkah yang belum didukung untuk membuat konten.');
      if(!['queued','in_progress'].includes(turn.status))throw fault('invalid_content_agent_turn','Status proses naskah tidak dikenali.',502);
     }
     await wait(Math.min(options.pollMs??2500,remaining()),controller.signal);
    }
   }catch(error){const e=error as{status?:number;name?:string};const safe=error instanceof ApiError?error:controller.signal.aborted||now()>=deadline?expired():fault('content_agent_unavailable','Koneksi ke agen naskah belum berhasil. Silakan coba lagi.');
    (options.log||((event)=>console.warn(JSON.stringify(event))))({event:'content_agent_transport_failed',phase,code:safe.code,elapsedMs:Math.max(0,now()-started),...(Number.isInteger(e.status)&&e.status!>=400&&e.status!<=599?{providerStatus:e.status}:{})});throw safe;
   }finally{clearTimeout(timer);}
  };
  return{controller,finalResult:()=>result??(result=run())};
 }}}}};
}
