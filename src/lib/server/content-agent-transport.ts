import type OpenAI from 'openai';
import {ApiError} from './http';
interface Input {agent_id:string;agent?:{model:string};environment:{type:'none'};input:string;stream:true}
interface Options {timeoutMs?:number;pollMs?:number;now?:()=>number;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;log?:(event:Record<string,unknown>)=>void}
function pause(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(new Error('aborted'));return;}const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('aborted'));}signal.addEventListener('abort',abort,{once:true});});}
function fault(code:string,message:string,status=503){return new ApiError(status,message,code);}
/** One paid input, then bounded reads of its own canonical turn. Never recreate after a lost connection. */
export function createManagedAgentTransport(client:OpenAI,options:Options={}){
 return{beta:{agents:{retrieve:(id:string)=>client.beta.agents.retrieve(id),sessions:{create:async(input:Input)=>{
  const controller=new AbortController();let result:Promise<{output_text:string}>|undefined;
  const run=async()=>{const now=options.now||Date.now,started=now(),deadline=started+(options.timeoutMs??180000),wait=options.wait||pause;let phase='create';
   const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-now()));
   const remaining=()=>{if(controller.signal.aborted||now()>=deadline)throw fault('content_agent_timeout','Penyusunan naskah melewati waktu tunggu. Belum ada draf tersimpan; silakan coba lagi.',504);return deadline-now();};
   const requestOptions=()=>({signal:controller.signal,timeout:Math.max(1,Math.min(20000,remaining())),maxRetries:0});
   const read=async<T>(fn:()=>PromiseLike<T>):Promise<T>=>{for(let attempt=0;;attempt++){remaining();try{return await fn();}catch(error){remaining();const e=error as{status?:number;name?:string};const transient=e.status===429||(e.status!==undefined&&e.status>=500)||['APIConnectionError','APIConnectionTimeoutError'].includes(e.name||'');if(!transient||attempt>=2)throw error;await wait(Math.min(1000*(attempt+1),remaining()),controller.signal);}}};
   try{
    // Do not retry creation: an ambiguous write may already have started a paid turn.
    const session=await client.beta.agents.sessions.create({...input,stream:false},requestOptions());
    if(!session.id||!/^sess_[a-zA-Z0-9_-]+$/.test(session.id))throw fault('invalid_content_agent_session','Agen belum memberikan identitas proses yang valid.',502);
    let turnId:string|undefined;
    for(;;){remaining();phase='poll';let turn;
     if(turnId)turn=await read(()=>client.beta.agents.sessions.turns.retrieve(turnId!,{session_id:session.id},requestOptions()));
     else{const page=await read(()=>client.beta.agents.sessions.turns.list(session.id,{limit:3,order:'desc'},requestOptions()));const roots=page.data.filter(item=>!item.subagent_id);if(roots.length>1)throw fault('invalid_content_agent_turn','Agen memberikan proses yang tidak sesuai.',502);turn=roots[0];if(turn)turnId=turn.id;}
     if(turn){if(turn.id!==turnId||turn.session_id!==session.id||turn.agent_id!==input.agent_id||turn.subagent_id)throw fault('invalid_content_agent_turn','Hasil agen berasal dari proses yang berbeda.',502);
      if(turn.status==='completed'){phase='items';const page=await read(()=>client.beta.agents.sessions.turns.items.list(turnId!,{session_id:session.id,limit:100,order:'asc'},requestOptions()));if(page.hasNextPage())throw fault('invalid_content_agent_response','Hasil naskah terlalu besar untuk diperiksa.',502);
       const finals=page.data.filter(item=>item.type==='message'&&item.role==='assistant'&&item.phase==='final_answer');
       if(finals.length!==1)throw fault('invalid_content_agent_response','Hasil akhir naskah belum lengkap.',502);
       const item=finals[0];if(item.type!=='message'||item.turn_id!==turnId||item.status!=='completed')throw fault('invalid_content_agent_response','Hasil akhir naskah tidak sesuai proses.',502);
       const text=item.content.filter(part=>part.type==='output_text').map(part=>part.text).join('');if(!text.trim()||text.length>48000)throw fault('invalid_content_agent_response','Hasil akhir naskah tidak valid.',502);return{output_text:text};
      }
      if(turn.status==='failed')throw fault('content_agent_failed','Agen belum berhasil menyelesaikan naskah. Silakan coba lagi.');
      if(turn.status==='cancelled')throw fault('content_agent_cancelled','Proses naskah dibatalkan sebelum selesai. Silakan coba lagi.');
      if(turn.status==='waiting')throw fault('content_agent_waiting','Agen meminta langkah yang belum didukung untuk membuat konten.');
      if(!['queued','in_progress'].includes(turn.status))throw fault('invalid_content_agent_turn','Status proses naskah tidak dikenali.',502);
     }
     await wait(Math.min(options.pollMs??2500,remaining()),controller.signal);
    }
   }catch(error){const e=error as{status?:number;name?:string};const safe=error instanceof ApiError?error:controller.signal.aborted||now()>=deadline?fault('content_agent_timeout','Penyusunan naskah melewati waktu tunggu. Belum ada draf tersimpan; silakan coba lagi.',504):fault('content_agent_unavailable','Koneksi ke agen naskah belum berhasil. Silakan coba lagi.');
    (options.log||((event)=>console.warn(JSON.stringify(event))))({event:'content_agent_transport_failed',phase,code:safe.code,elapsedMs:Math.max(0,now()-started),...(Number.isInteger(e.status)&&e.status!>=400&&e.status!<=599?{providerStatus:e.status}:{})});throw safe;
   }finally{clearTimeout(timer);}
  };
  return{controller,finalResult:()=>result??(result=run())};
 }}}}};
}
