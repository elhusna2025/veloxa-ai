import{requireScheduler}from'@/lib/server/autonomy-auth';
import{tickAutonomy}from'@/lib/server/autonomy-worker';
import{tickYouTubeUploads}from'@/lib/server/youtube-upload-jobs';
import{tickYouTubeProductions}from'@/lib/server/youtube-production-jobs';
import{errorResponse,noStoreJson}from'@/lib/server/http';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){
 try{
  await requireScheduler(request);
  // Separate bounded work lanes: a YouTube outage cannot block existing social publication.
  const [social,youtube,production]=await Promise.allSettled([tickAutonomy(),tickYouTubeUploads({budgetMs:20_000}),tickYouTubeProductions()]);
  if(social.status==='rejected')throw social.reason;
  return noStoreJson({...social.value,youtubeUploads:youtube.status==='fulfilled'?youtube.value:{retryPending:true},youtubeProduction:production.status==='fulfilled'?production.value:{retryPending:true}});
 }catch(error){return errorResponse(error);}
}
