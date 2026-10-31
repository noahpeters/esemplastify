import { EDITORIAL_POLICY,MAX_LINEUP_ITEMS } from './editorial-policy';
import { pilotRoute, PilotError, produceChunk } from './production';
import type { Env, IngestJob, Candidate, ProductionJob } from './types';
import { enqueueSources, ingestSource } from './ingest';
import { candidates, eligibility, freshEvidence, HOUR, lineup, pacificClock, snapshot } from './editorial';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
async function body(request:Request) {
  const text=await request.text();if(text.length>32000) fail(413,'Body too large');
  try{const value=JSON.parse(text);if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'Expected JSON object');return value;}catch{fail(400,'Expected JSON object');}
}
async function authorized(request:Request,env:Env) {
  if(!env.ADMIN_TOKEN) fail(503,'Editorial access is not configured');
  // Compare fixed length digests so the shared editorial secret is not compared prefix-by-prefix.
  const digest=(s:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  const [a,b]=await Promise.all([digest(request.headers.get('authorization')??''),digest(`Bearer ${env.ADMIN_TOKEN}`)]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let mismatch=0;for(let i=0;i<x.length;i++)mismatch|=x[i]^y[i];
  if(mismatch) fail(401,'Editorial bearer token required');
}
async function recordCoverage(env:Env,episodeId:string,data:any,now:string) {
  if(data.confirmCovered!==true||!Array.isArray(data.items)||!data.items.length||data.items.length>MAX_LINEUP_ITEMS) fail(400,`confirmCovered and 1–${MAX_LINEUP_ITEMS} lineup items required`);
  const episode=await env.DB.prepare('SELECT lineup_json FROM episodes WHERE id=?').bind(episodeId).first<{lineup_json:string}>();
  if(!episode) fail(404,'Episode draft not found');
  const draft=JSON.parse(episode!.lineup_json);
  const pool=await candidates(env,now);const statements:D1PreparedStatement[]=[];const seen=new Set<string>();
  for(const item of data.items){
    if(!item||typeof item.storyId!=='string'||!['initial','followup'].includes(item.kind)||seen.has(item.storyId)) fail(400,'Invalid or duplicate story');
    seen.add(item.storyId);
    const planned=draft.items.find((i:any)=>i.storyId===item.storyId&&i.kind===item.kind);
    if(!planned) fail(409,'Story and coverage kind must occur in this episode snapshot');
    const previous=await env.DB.prepare('SELECT episode_id FROM coverage WHERE story_id=? AND kind=?').bind(item.storyId,item.kind).first<{episode_id:string}>();
    if(previous){if(previous.episode_id!==episodeId)fail(409,'Story was already covered');continue;}
    const candidate=pool.find(c=>c.id===item.storyId);if(!candidate||eligibility(candidate,now)!==item.kind) fail(409,'Story is no longer eligible for this coverage');
    if(item.kind==='followup'&&freshEvidence(candidate!,planned.evidenceIds).length!==planned.evidenceIds.length)fail(409,'Follow-up snapshot lacks fresh approved evidence');
    statements.push(env.DB.prepare('INSERT INTO coverage(story_id,kind,episode_id,covered_at,evidence_ids) VALUES(?,?,?,?,?)').bind(item.storyId,item.kind,episodeId,now,JSON.stringify(planned.evidenceIds)));
    if(item.kind==='initial') statements.push(env.DB.prepare("INSERT INTO followups(story_id,due_at,expires_at,state) VALUES(?,?,?,'pending')").bind(item.storyId,new Date(Date.parse(now)+24*HOUR).toISOString(),new Date(Date.parse(now)+48*HOUR).toISOString()));
    else statements.push(env.DB.prepare("UPDATE followups SET state='completed' WHERE story_id=?").bind(item.storyId));
  }
  if(statements.length) await env.DB.batch(statements);
  return {recorded:true,episodeId};
}
async function verifyStory(env:Env,storyId:string,data:any,now:string) {
  if(data.reviewed!==true||typeof data.note!=='string'||data.note.trim().length<40||!Array.isArray(data.evidenceIds)||!data.evidenceIds.length||data.evidenceIds.length>10||data.evidenceIds.some((x:unknown)=>typeof x!=='string')||new Set(data.evidenceIds).size!==data.evidenceIds.length) fail(400,'Explicit reviewed attestation, a substantive note (40+ characters), and unique evidenceIds required');
  const candidate=(await candidates(env,now)).find(c=>c.id===storyId);
  if(!candidate?.initial||candidate.completed||candidate.followup?.state!=='pending'||now>candidate.followup.expires_at)fail(409,'No pending follow-up in its verification window');
  const c=candidate as Candidate;
  const fresh=freshEvidence(c,data.evidenceIds);
  if(fresh.length!==data.evidenceIds.length)fail(409,'Every item must provide substantive evidence observed after initial coverage');
  const original=new Set(c.evidence.filter(e=>JSON.parse(c.initial!.evidence_ids).includes(e.id)).map(e=>e.publisher));
  if(!fresh.some(e=>e.primary_source||!original.has(e.publisher)))fail(409,'Follow-up needs a primary source or an independent publisher');
  await env.DB.prepare('INSERT INTO verifications(story_id,evidence_ids,note,created_at) VALUES(?,?,?,?) ON CONFLICT(story_id) DO UPDATE SET evidence_ids=excluded.evidence_ids,note=excluded.note,created_at=excluded.created_at').bind(storyId,JSON.stringify(data.evidenceIds),data.note.trim().slice(0,3000),now).run();
  return {storyId,verificationRecorded:true};
}
export async function handle(request:Request,env:Env,now=new Date().toISOString()):Promise<Response> {
  try{
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='GET'&&(path==='/health'||path==='/'))return json({service:'Esemplastify',milestone:'discovery-ledger',audioGeneration:!!env.AI,automaticScriptWriting:false,editorialApi:'/api/lineup',requires:'Authorization: Bearer <editorial token>'});
    await authorized(request,env);
    if(path.startsWith('/api/pilots')){const response=await pilotRoute(request,env,path,now);if(response)return response;}
    if(request.method==='GET'&&path==='/api/editorial-policy')return json(EDITORIAL_POLICY);
    if(request.method==='GET'&&path==='/api/lineup'){
      const target=Number(url.searchParams.get('minutes')??45);if(!Number.isInteger(target)||target<30||target>60)fail(400,'minutes must be an integer from 30 to 60');
      return json(await lineup(env,now,target));
    }
    if(request.method==='GET'&&path==='/api/sources')return json((await env.DB.prepare('SELECT * FROM sources ORDER BY id').all()).results);
    if(request.method==='GET'&&path==='/api/followups')return json((await env.DB.prepare('SELECT f.*,s.title,v.note AS verification_note FROM followups f JOIN stories s ON s.id=f.story_id LEFT JOIN verifications v ON v.story_id=f.story_id ORDER BY f.due_at').all()).results);
    if(request.method==='POST'&&path==='/api/ingest')return json({queued:await enqueueSources(env)},202);
    if(request.method==='POST'&&path==='/api/episodes/today')return json(await snapshot(env,now),201);
    let match=path.match(/^\/api\/episodes\/(\d{4}-\d{2}-\d{2})\/coverage$/);
    if(request.method==='POST'&&match)return json(await recordCoverage(env,match[1],await body(request),now));
    match=path.match(/^\/api\/episodes\/(\d{4}-\d{2}-\d{2})$/);
    if(request.method==='GET'&&match){const e=await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(match[1]).first<any>();return e?json({...e,lineup:JSON.parse(e.lineup_json),lineup_json:undefined}):json({error:'Episode not found'},404);}
    match=path.match(/^\/api\/stories\/([a-f0-9]{64})\/verification$/);
    if(request.method==='POST'&&match)return json(await verifyStory(env,match[1],await body(request),now));
    match=path.match(/^\/api\/stories\/([a-f0-9]{64})$/);
    if(request.method==='GET'&&match){
      const story=await env.DB.prepare('SELECT * FROM stories WHERE id=?').bind(match[1]).first();if(!story)fail(404,'Story not found');
      const evidence=await env.DB.prepare('SELECT e.*,a.canonical_url,s.name,s.publisher,s.primary_source FROM evidence e JOIN articles a ON a.id=e.article_id JOIN sources s ON s.id=e.source_id WHERE a.story_id=? ORDER BY e.observed_at').bind(match[1]).all();
      return json({story,evidence:evidence.results,coverage:(await env.DB.prepare('SELECT * FROM coverage WHERE story_id=?').bind(match[1]).all()).results});
    }
    return json({error:'Route not found'},404);
  }catch(error){if(error instanceof HttpError||error instanceof PilotError)return json({error:error.message},error.status);console.error('Editorial request failed',error instanceof Error?error.name:'UnknownError');return json({error:'Internal service error'},500);}
}
export async function runScheduled(env:Env,date:Date) {
  const now=date.toISOString();
  await env.DB.prepare("UPDATE followups SET state='expired' WHERE state='pending' AND expires_at<?").bind(now).run();
  await enqueueSources(env);
  const local=pacificClock(date);
  // Cron is UTC; the IANA clock handles both PST and PDT. Snapshot once per Pacific date.
  // Ingestion is asynchronous: the 06:00 draft uses completed polls, generally the 05:30 poll.
  if(local.hour===6&&local.minute===0)await snapshot(env,now);
}
export default {
  fetch(request:Request,env:Env){return handle(request,env);},
  async scheduled(controller:ScheduledController,env:Env){await runScheduled(env,new Date(controller.scheduledTime));},
  async queue(batch:MessageBatch<IngestJob|ProductionJob>,env:Env){
    for(const message of batch.messages){
      try{if('pilotId' in message.body)await produceChunk(env,message.body);else await ingestSource(env,message.body.sourceId);message.ack();}
      catch{console.error('Queue job failed',{kind:'pilotId' in message.body?'production':'ingestion',attempts:message.attempts});message.retry({delaySeconds:Math.min(60*2**message.attempts,3600)});}
    }
  },
} satisfies ExportedHandler<Env,IngestJob|ProductionJob>;
