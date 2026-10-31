import type { Env, ProductionJob } from './types';
import { hash } from './feed';
const MODEL='@cf/deepgram/aura-2-en';
const SPEAKERS=new Set(['athena','luna','orion','asteria']);
export class PilotError extends Error { constructor(public status:number,message:string){super(message);} }
const invalid=(message:string):never=>{throw new PilotError(400,message);};
export interface PilotSegment { title:string; text:string; evidenceIds:string[] }
interface PilotInput { title:string; reviewed:boolean; reviewNotes:string; sourceChecks:unknown[]; speaker?:string; segments:PilotSegment[] }
interface Pilot { id:string; title:string; status:string; script_key:string; audio_key:string|null; model:string; speaker:'athena'|'luna'|'orion'|'asteria'; chunk_count:number; duration_seconds:number|null }
interface Chunk { pilot_id:string; ordinal:number; text:string; text_hash:string; status:string; audio_key:string|null; duration_seconds:number|null; attempts:number }
export function splitNarration(text:string,max=1800):string[] {
  const out:string[]=[];let current='';
  // Sentence boundaries keep narration coherent; hard limits still handle a very long sentence.
  const sentences=text.match(/[^.!?]+(?:[.!?]+(?:[”"'])?|$)/gu)??[text];
  for(let sentence of sentences){sentence=sentence.trim();while(sentence.length>max){if(current){out.push(current);current='';}const space=sentence.lastIndexOf(' ',max);const end=space>max/2?space:max;out.push(sentence.slice(0,end).trim());sentence=sentence.slice(end).trim();}if(!sentence)continue;if(current.length+sentence.length+1>max){out.push(current);current='';}current+=(current?' ':'')+sentence;}
  if(current)out.push(current);return out;
}
// Aura's pinned output is CBR MPEG-2 Layer III, mono, 24 kHz, 48 kbit/s.
// Frame validation prevents concatenating JSON/error bodies or files with misleading per-chunk duration headers.
export function mp3Duration(bytes:Uint8Array):number {
  let offset=0,frames=0;
  while(offset<bytes.length){
    if(offset+4>bytes.length)throw new Error('Truncated MP3 frame');
    const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2],d=bytes[offset+3];
    if(a!==255||(b&0xe0)!==0xe0||((b>>3)&3)!==2||((b>>1)&3)!==1||(c>>4)!==6||((c>>2)&3)!==1||(d>>6)!==3)throw new Error('Unexpected speech audio format');
    const size=144+((c>>1)&1);
    if(offset+size>bytes.length)throw new Error('Truncated MP3 payload');
    // No Xing/Info/VBR duration header: the full file must be measured from its actual frames.
    const tag=new TextDecoder().decode(bytes.subarray(offset+13,offset+17));
    if(tag==='Xing'||tag==='Info')throw new Error('Unexpected MP3 duration metadata');
    offset+=size;frames++;
  }
  if(!frames)throw new Error('Empty speech audio');return frames*576/24000;
}
async function getPilot(env:Env,id:string){const p=await env.DB.prepare('SELECT * FROM pilots WHERE id=?').bind(id).first<Pilot>();if(!p)throw new PilotError(404,'Pilot not found');return p;}
export async function createPilot(env:Env,input:PilotInput,now:string){
  if(!input||input.reviewed!==true||typeof input.title!=='string'||!input.title.trim()||input.title.length>200||typeof input.reviewNotes!=='string'||input.reviewNotes.trim().length<40||!Array.isArray(input.sourceChecks)||input.sourceChecks.length>30||!Array.isArray(input.segments)||input.segments.length<1||input.segments.length>20)invalid('Reviewed script, review notes, source checks, and 1–20 segments required');
  const speaker=input.speaker??'athena';if(!SPEAKERS.has(speaker))invalid('Unsupported pilot voice');
  let characters=0;const evidenceIds=new Set<string>();const chunks:{text:string;segment:number}[]=[];
  input.segments.forEach((s,index)=>{
    if(!s||typeof s.title!=='string'||s.title.length>200||typeof s.text!=='string'||!s.text.trim()||!Array.isArray(s.evidenceIds)||s.evidenceIds.length>30||s.evidenceIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))invalid('Invalid segment or evidence IDs');
    characters+=s.text.length;for(const id of s.evidenceIds)evidenceIds.add(id);
    for(const text of splitNarration(s.text))chunks.push({text,segment:index});
  });
  if(characters>65000||characters<100||chunks.length>64||!evidenceIds.size)invalid('Pilot must contain 100–65,000 characters, at most 64 chunks, and linked evidence');
  const links:{id:string;story_id:string;canonical_url:string;title:string;raw_key:string}[]=[];
  for(const id of evidenceIds){const row=await env.DB.prepare('SELECT e.id,a.story_id,a.canonical_url,e.title,e.raw_key FROM evidence e JOIN articles a ON a.id=e.article_id WHERE e.id=?').bind(id).first<typeof links[number]>();if(!row)invalid('Unknown ledger evidence');links.push(row!);}
  const id=crypto.randomUUID(),key=`pilots/${id}/script.json`;
  const words=input.segments.map(s=>s.text).join(' ').trim().split(/\s+/).length;
  const script={id,title:input.title.trim(),createdAt:now,writer:'editor-written with Codex assistance',reviewed:true,reviewNotes:input.reviewNotes,sourceChecks:input.sourceChecks,segments:input.segments,provenance:links,model:MODEL,speaker,words,characters,chunks:chunks.map((c,ordinal)=>({ordinal,segment:c.segment,text:c.text})),disclosure:'AI-generated narration. Private editorial pilot; no publication or coverage confirmation.'};
  await env.EVIDENCE.put(key,JSON.stringify(script),{httpMetadata:{contentType:'application/json'}});
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pilots(id,title,created_at,status,script_key,model,speaker,word_count,character_count,chunk_count) VALUES(?,?,?,'draft',?,?,?,?,?,?)").bind(id,input.title.trim(),now,key,MODEL,speaker,words,characters,chunks.length),
    ...await Promise.all(chunks.map(async(c,i)=>env.DB.prepare("INSERT INTO pilot_chunks(pilot_id,ordinal,text,text_hash,status) VALUES(?,?,?,?,'pending')").bind(id,i,c.text,await hash(c.text)))),
    ...links.map(e=>env.DB.prepare('INSERT INTO pilot_evidence(pilot_id,story_id,evidence_id) VALUES(?,?,?)').bind(id,e.story_id,e.id)),
  ]);
  return {id,status:'draft',wordCount:words,characterCount:characters,chunks:chunks.length,estimatedMinutes:Math.round(words/150),estimatedSpeechCostUsd:Math.round(characters/1000*.03*100)/100,scriptUrl:`/api/pilots/${id}/script`};
}
async function enqueueRender(env:Env,id:string){
  if(!env.PRODUCE||!env.AI)throw new PilotError(503,'Speech production is not configured');
  const pilot=await getPilot(env,id);if(pilot.status==='ready')return {id,status:'ready'};
  const {results}=await env.DB.prepare("SELECT ordinal FROM pilot_chunks WHERE pilot_id=? AND status!='ready' ORDER BY ordinal").bind(id).all<{ordinal:number}>();
  // Requeue is intentionally safe after a lost queue send. The serial consumer checks immutable completed chunks.
  await env.DB.prepare("UPDATE pilots SET status='queued',last_error=NULL WHERE id=?").bind(id).run();
  try{if(results.length)await env.PRODUCE.sendBatch(results.map(c=>({body:{pilotId:id,ordinal:c.ordinal},contentType:'json' as const})));else await env.PRODUCE.send({pilotId:id,assemble:true});}
  catch{await env.DB.prepare("UPDATE pilots SET status='failed',last_error='Queue dispatch failed' WHERE id=?").bind(id).run();throw new PilotError(503,'Pilot queue dispatch failed; render can be retried');}
  return {id,status:'queued',queued:results.length};
}
async function assemble(env:Env,pilot:Pilot){
  const {results}=await env.DB.prepare("SELECT * FROM pilot_chunks WHERE pilot_id=? AND status='ready' ORDER BY ordinal").bind(pilot.id).all<Chunk>();
  if(results.length!==pilot.chunk_count)return;
  const parts:Uint8Array[]=[];let size=0,duration=0;
  for(const c of results){const object=await env.EVIDENCE.get(c.audio_key!);if(!object)throw new Error('Completed audio chunk missing');const bytes=new Uint8Array(await object.arrayBuffer());size+=bytes.length;if(size>24*1024*1024)throw new Error('Pilot exceeds assembly size limit');duration+=mp3Duration(bytes);parts.push(bytes);}
  const full=new Uint8Array(size);let offset=0;for(const part of parts){full.set(part,offset);offset+=part.length;}
  const key=`pilots/${pilot.id}/episode.mp3`;
  await env.EVIDENCE.put(key,full,{httpMetadata:{contentType:'audio/mpeg'}});
  await env.DB.prepare("UPDATE pilots SET status='ready',audio_key=?,duration_seconds=?,last_error=NULL WHERE id=?").bind(key,duration,pilot.id).run();
}
export async function produceChunk(env:Env,job:ProductionJob){
  const pilot=await getPilot(env,job.pilotId);if(pilot.status==='ready')return;
  if(job.assemble){await assemble(env,pilot);return;}
  if(!Number.isInteger(job.ordinal))throw new Error('Invalid pilot chunk');
  const chunk=await env.DB.prepare('SELECT * FROM pilot_chunks WHERE pilot_id=? AND ordinal=?').bind(pilot.id,job.ordinal!).first<Chunk>();if(!chunk)throw new Error('Pilot chunk missing');
  try{
    if(chunk.status!=='ready'){
      if(!env.AI)throw new Error('AI binding missing');
      await env.DB.prepare("UPDATE pilots SET status='rendering' WHERE id=?").bind(pilot.id).run();
      const key=`pilots/${pilot.id}/chunks/${chunk.ordinal}-${chunk.text_hash}.mp3`;
      // Recover the R2 write if D1 failed before the ready transition; never bill speech twice for an already stored chunk.
      let object=await env.EVIDENCE.get(key);let bytes:Uint8Array;
      if(object)bytes=new Uint8Array(await object.arrayBuffer());
      else{
        const response=await env.AI.run(MODEL,{text:chunk.text,speaker:pilot.speaker,encoding:'mp3',bit_rate:48000},{returnRawResponse:true,signal:AbortSignal.timeout(90000)});
        if(!response.ok){const detail=await response.json().catch(()=>null) as {errors?:{message?:string}[]}|null;throw new Error(`Speech provider returned non-audio response (HTTP ${response.status}): ${detail?.errors?.[0]?.message?.slice(0,120)??'request rejected'}`);}
        bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>2*1024*1024)throw new Error('Speech chunk exceeds size limit');
        try{mp3Duration(bytes);}catch{throw new Error(`Invalid speech payload (HTTP ${response.status}; type ${response.headers.get('content-type')??'unspecified'}; ${bytes.length} bytes; prefix ${[...bytes.subarray(0,4)].join(',')})`);}
        await env.EVIDENCE.put(key,bytes,{httpMetadata:{contentType:'audio/mpeg'}});
      }
      const duration=mp3Duration(bytes);
      await env.DB.prepare("UPDATE pilot_chunks SET status='ready',audio_key=?,duration_seconds=?,byte_count=?,attempts=attempts+1,last_error=NULL WHERE pilot_id=? AND ordinal=?").bind(key,duration,bytes.length,pilot.id,chunk.ordinal).run();
    }
    await assemble(env,pilot);
  }catch(error){
    const message=error instanceof Error?error.message.slice(0,150):'Speech generation failed';
    await env.DB.batch([
      env.DB.prepare("UPDATE pilot_chunks SET status=CASE WHEN status='ready' THEN status ELSE 'failed' END,attempts=attempts+1,last_error=? WHERE pilot_id=? AND ordinal=?").bind(message,pilot.id,chunk.ordinal),
      env.DB.prepare("UPDATE pilots SET status='failed',last_error=? WHERE id=?").bind(message,pilot.id),
    ]);throw error;
  }
}
export async function pilotRoute(request:Request,env:Env,path:string,now:string):Promise<Response|null>{
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(path==='/api/pilots'&&request.method==='POST'){
    const raw=await request.text();if(raw.length>120000)throw new PilotError(413,'Pilot packet exceeds size limit');
    let input;try{input=JSON.parse(raw);}catch{throw new PilotError(400,'Expected pilot JSON');}
    return json(await createPilot(env,input,now),201);
  }
  if(path==='/api/pilots'&&request.method==='GET')return json((await env.DB.prepare('SELECT * FROM pilots ORDER BY created_at DESC LIMIT 50').all()).results);
  const match=path.match(/^\/api\/pilots\/([a-f0-9-]{36})(?:\/(script|audio|render))?$/);if(!match)return null;
  const pilot=await getPilot(env,match[1]);
  if(request.method==='POST'&&match[2]==='render')return json(await enqueueRender(env,pilot.id),202);
  if(request.method==='GET'&&!match[2])return json({...pilot,chunks:(await env.DB.prepare('SELECT ordinal,status,duration_seconds,byte_count,attempts,last_error FROM pilot_chunks WHERE pilot_id=? ORDER BY ordinal').bind(pilot.id).all()).results,scriptUrl:`/api/pilots/${pilot.id}/script`,audioUrl:pilot.status==='ready'?`/api/pilots/${pilot.id}/audio`:null});
  if(request.method==='GET'&&(match[2]==='script'||match[2]==='audio')){
    const audio=match[2]==='audio';if(audio&&pilot.status!=='ready')throw new PilotError(409,'Pilot audio is not ready');
    const key=audio?pilot.audio_key:pilot.script_key;const object=key?await env.EVIDENCE.get(key):null;if(!object)throw new PilotError(404,'Pilot object not found');
    return new Response(object.body,{headers:{'Content-Type':audio?'audio/mpeg':'application/json','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`${audio?'attachment':'inline'}; filename="${pilot.id}.${audio?'mp3':'json'}"`}});
  }
  return null;
}
