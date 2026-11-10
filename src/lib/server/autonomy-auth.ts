import {OAuth2Client} from 'google-auth-library';
import {ApiError} from './http';
export async function requireScheduler(request:Request,verify:(token:string,audience:string)=>Promise<{email?:string;email_verified?:boolean}>=async(token,audience)=>new OAuth2Client().verifyIdToken({idToken:token,audience}).then(ticket=>ticket.getPayload()||{})){
 const email=process.env.VELOXA_SCHEDULER_EMAIL;const audience=process.env.VELOXA_SCHEDULER_AUDIENCE;const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
 if(!email||!audience)throw new ApiError(503,'Penjadwal server belum dikonfigurasi.');
 if(!token)throw new ApiError(401,'Autentikasi penjadwal diperlukan.');
 try{const payload=await verify(token,audience);if(payload.email!==email||payload.email_verified!==true)throw new Error();}catch{throw new ApiError(403,'Identitas penjadwal tidak diizinkan.');}
}
