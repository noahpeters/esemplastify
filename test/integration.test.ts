import { afterAll,beforeAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { seedSources,SOURCES } from '../src/sources';
import { ingestSource,storeItem,boundedText } from '../src/ingest';
import { handle,runScheduled } from '../src/index';
import worker from '../src/index';
import { candidates,lineup,HOUR } from '../src/editorial';
import type { Env,FeedItem } from '../src/types';
const t0='2026-10-28T13:00:00.000Z',t1='2026-10-29T13:00:00.000Z';
let mf:Miniflare, env:Env;
let outboundXml='';
const note='Reviewed the independent evaluation and compared the measured failures with the original announcement.';
const original:FeedItem={title:'NIST releases artificial intelligence safety framework',url:'https://example.org/announcement',summary:'The agency announced its artificial intelligence framework.',publishedAt:t0,guid:'initial'};
const updated:FeedItem={...original,url:'https://example.org/verification',publishedAt:t1,guid:'verification',summary:'Independent researchers measured reliability across twelve benchmarks and discovered important limitations affecting medical applications. The evaluation identifies previously unreported failures in multilingual reasoning, financial calculations, accessibility, training data and reproducibility, with published experimental methods and detailed evidence.'};
const source=(id:string)=>SOURCES.find(s=>s.id===id)!;
const request=(path:string,method='GET',data?:unknown)=>new Request(`http://localhost${path}`,{method,headers:{authorization:'Bearer test-secret',...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
const call=(path:string,method='GET',data?:unknown,at=t0)=>handle(request(path,method,data),env,at);
async function count(table:string){return Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<any>())!.n);}
async function coverInitial(){
  const id=await storeItem(env,source('guardian-culture'),original,'fixtures/initial.xml',t0);
  await call('/api/episodes/today','POST');
  const response=await call('/api/episodes/2026-10-28/coverage','POST',{confirmCovered:true,items:[{storyId:id,kind:'initial'}]});
  expect(response.status).toBe(200);return id;
}
beforeAll(async()=>{
  const bundled=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-29',d1Databases:{DB:'test-ledger'},r2Buckets:{EVIDENCE:'test-evidence'},queueProducers:{INGEST:'ingestion'},queueConsumers:{ingestion:{maxBatchSize:1,maxBatchTimeout:0,maxRetries:0,deadLetterQueue:'dlq'}},bindings:{ADMIN_TOKEN:'test-secret'},outboundService:async(request:Request)=>{if(request.url==='https://www.quantamagazine.org/feed/'&&outboundXml)return new Response(outboundXml);throw new Error('Unexpected outbound request');}}));
  await mf.ready;
  const db=await mf.getD1Database('DB');
  const sql=await readFile('migrations/0001_ledger.sql','utf8');
  for(const statement of sql.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={DB:db,EVIDENCE:await mf.getR2Bucket('EVIDENCE'),INGEST:{sendBatch:vi.fn(async()=>{})} as any,ADMIN_TOKEN:'test-secret'} as Env;
},30000);
beforeEach(async()=>{
  for(const table of ['verifications','followups','coverage','episodes','fetches','evidence','articles','stories','sources'])await env.DB.prepare(`DELETE FROM ${table}`).run();
  await seedSources(env);
});
afterAll(async()=>{await mf?.dispose();});
describe('actual D1/R2 ledger and editorial API',()=>{
  it('ingests RSS with immutable raw provenance and is replay-safe',async()=>{
    const rss=`<rss><channel><item><title>${original.title}</title><link>${original.url}?utm_source=a</link><description>${original.summary}</description><pubDate>${t0}</pubDate></item></channel></rss>`;
    const fetcher=vi.fn(async()=>new Response(rss,{headers:{etag:'"v1"'}}));
    await ingestSource(env,'nist',t0,fetcher as any);await ingestSource(env,'nist',t0,fetcher as any);
    expect(await count('stories')).toBe(1);expect(await count('articles')).toBe(1);expect(await count('evidence')).toBe(1);
    const e=await env.DB.prepare('SELECT raw_key FROM evidence').first<any>();expect(await (await env.EVIDENCE.get(e.raw_key))!.text()).toBe(rss);
    expect(await count('fetches')).toBe(2);
    expect(fetcher.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"');
  });
  it('preserves article revisions without inventing a second story',async()=>{
    const id=await storeItem(env,source('nist'),original,'a.xml',t0);
    const again=await storeItem(env,source('nist'),{...updated,url:original.url},'b.xml',t1);
    expect(again).toBe(id);expect(await count('articles')).toBe(1);expect(await count('evidence')).toBe(2);
  });
  it('clusters equivalent headlines from distinct publishers and retains both provenance records',async()=>{
    const a=await storeItem(env,source('nist'),original,'a.xml',t0);
    const b=await storeItem(env,source('guardian-culture'),{...original,title:'NIST releases new artificial intelligence safety framework',url:'https://news.test/report'},'b.xml',t0);
    expect(a).toBe(b);expect(await count('stories')).toBe(1);expect(await count('articles')).toBe(2);
    const story=await (await call(`/api/stories/${a}`)).json() as any;expect(story.evidence).toHaveLength(2);
  });
  it('does not cluster numerically different model releases',async()=>{
    await storeItem(env,source('nist'),{...original,title:'Company releases Model 2 advanced reasoning',url:'https://example.org/model2'},'a',t0);
    await storeItem(env,source('nist'),{...original,title:'Company releases Model 3 advanced reasoning',url:'https://example.org/model3'},'b',t0);
    expect(await count('stories')).toBe(2);
  });
  it('records source failures, then clears the error after a valid 304',async()=>{
    await expect(ingestSource(env,'nist',t0,async()=>new Response('Unavailable',{status:503}))).rejects.toThrow('503');
    expect((await env.DB.prepare("SELECT last_error FROM sources WHERE id='nist'").first<any>()).last_error).toContain('503');
    await ingestSource(env,'nist',t1,async()=>new Response(null,{status:304}));
    expect((await env.DB.prepare("SELECT last_error FROM sources WHERE id='nist'").first<any>()).last_error).toBeNull();
  });
  it('rejects malformed feed data without advancing conditional validators',async()=>{
    await expect(ingestSource(env,'nist',t0,async()=>new Response('<html>oops</html>',{headers:{etag:'bad'}}))).rejects.toThrow();
    expect((await env.DB.prepare("SELECT etag FROM sources WHERE id='nist'").first<any>()).etag).toBeNull();expect(await count('stories')).toBe(0);
  });
  it('admits non-AI stories while filtering future dates and stale publications',async()=>{
    const item=(title:string,date:string,slug:string)=>`<item><title>${title}</title><link>https://example.org/${slug}</link><pubDate>${date}</pubDate></item>`;
    const rss=`<rss><channel>${item('A new space mission',t0,'a')}${item('AI from the future','2028-01-01','b')}${item('AI old news','2020-01-01','c')}${item('AI new research',t0,'d')}</channel></rss>`;
    await ingestSource(env,'nist',t0,async()=>new Response(rss));expect(await count('articles')).toBe(2);
  });
  it('acknowledges queued disabled sources without fetching or deleting provenance',async()=>{
    await storeItem(env,source('nist'),original,'original.xml',t0);
    await env.DB.prepare("UPDATE sources SET enabled=0 WHERE id='nist'").run();
    const fetcher=vi.fn();
    expect(await ingestSource(env,'nist',t1,fetcher)).toMatchObject({skipped:true});
    expect(fetcher).not.toHaveBeenCalled();expect(await count('evidence')).toBe(1);
    await seedSources(env);
    expect((await env.DB.prepare("SELECT enabled FROM sources WHERE id='nist'").first<any>()).enabled).toBe(0);
  });
  it('retires narrow AI feeds without deleting their ledger or blocking reviewed follow-ups',async()=>{
    await env.DB.prepare("INSERT INTO sources(id,name,url,publisher,category,region,primary_source) VALUES('arxiv-ai','Old AI feed','https://example.org/old','arxiv','science','global',1)").run();
    const oldSource={...source('quanta'),id:'arxiv-ai'};
    const id=await storeItem(env,oldSource,original,'old.xml',t0);
    await call('/api/episodes/today','POST');
    expect((await call('/api/episodes/2026-10-28/coverage','POST',{confirmCovered:true,items:[{storyId:id,kind:'initial'}]})).status).toBe(200);
    await storeItem(env,oldSource,updated,'update.xml',t1);
    await seedSources(env);
    expect((await env.DB.prepare("SELECT enabled FROM sources WHERE id='arxiv-ai'").first<any>()).enabled).toBe(0);
    const c=(await candidates(env,t1))[0];expect(c.activeSources).toBe(false);
    const e=c.evidence.find(e=>e.raw_key==='update.xml')!;
    expect((await call(`/api/stories/${id}/verification`,'POST',{evidenceIds:[e.id],note,reviewed:true},t1)).status).toBe(200);
    expect((await lineup(env,t1)).items[0].kind).toBe('followup');
    expect(await count('evidence')).toBe(2);
  });
  it('limits downloaded feeds',async()=>{
    await expect(boundedText(new Response('123456'),5)).rejects.toThrow('size limit');
  });
  it('protects all editorial data and mutations, including when no token is configured',async()=>{
    expect((await handle(new Request('http://localhost/api/lineup'),env,t0)).status).toBe(401);
    expect((await handle(request('/api/lineup'),{...env,ADMIN_TOKEN:undefined},t0)).status).toBe(503);
    expect((await mf.dispatchFetch('http://localhost/health')).status).toBe(200);
    expect((await mf.dispatchFetch('http://localhost/api/lineup')).status).toBe(401);
    expect((await call('/api/lineup?minutes=999')).status).toBe(400);
    expect((await call('/api/lineup?minutes=NaN')).status).toBe(400);
  });
  it('keeps proposal creation separate from coverage and records initial coverage idempotently',async()=>{
    const id=await storeItem(env,source('guardian-culture'),original,'a',t0);
    await call('/api/episodes/today','POST');await call('/api/episodes/today','POST');
    expect(await count('coverage')).toBe(0);expect(await count('episodes')).toBe(1);
    const data={confirmCovered:true,items:[{storyId:id,kind:'initial'}]};
    expect((await call('/api/episodes/2026-10-28/coverage','POST',{...data,confirmCovered:false})).status).toBe(400);
    expect((await call('/api/episodes/2026-10-28/coverage','POST',data)).status).toBe(200);
    expect((await call('/api/episodes/2026-10-28/coverage','POST',data)).status).toBe(200);
    expect(await count('coverage')).toBe(1);expect(await count('followups')).toBe(1);
    expect((await lineup(env,t0)).items).toHaveLength(0);
  });
  it('exposes shared script guidance and confirms coverage for a briefing with more than twelve items',async()=>{
    const policy=await (await call('/api/editorial-policy')).json() as any;
    expect(policy.overarchingThemeRequired).toBe(false);expect(policy.topicQuotas).toBe(false);
    for(let i=0;i<13;i++)await storeItem(env,SOURCES[i],{...original,title:`Regional report ${i}`,summary:"A short regional news report.",url:`https://example.org/brief/${i}`},'brief.xml',t0);
    await call('/api/episodes/today','POST');
    const saved=await (await call('/api/episodes/2026-10-28')).json() as any;
    expect(saved.lineup.items).toHaveLength(13);
    expect(saved.lineup.editorialPolicyVersion).toBe(policy.version);
    expect(saved.lineup.items.every((i:any)=>i.minutes===1)).toBe(true);
    expect((await call('/api/episodes/2026-10-28/coverage','POST',{confirmCovered:true,items:saved.lineup.items.map((i:any)=>({storyId:i.storyId,kind:i.kind}))})).status).toBe(200);
    expect(await count('coverage')).toBe(13);expect(await count('followups')).toBe(13);
    await storeItem(env,SOURCES[0],{...original,title:'Another regional report 99',url:'https://example.org/later'},'later.xml',t0);
    await call('/api/episodes/today','POST');
    const again=await (await call('/api/episodes/2026-10-28')).json() as any;
    expect(again.lineup).toEqual(saved.lineup);
  });
  it('requires substantive new reviewed evidence, enforces 24–48h and permits only one follow-up',async()=>{
    const id=await coverInitial();
    await storeItem(env,source('nist'),updated,'b',t1);
    const c=(await candidates(env,t1))[0],e=c.evidence.find(e=>e.source_id==='nist')!;
    expect((await lineup(env,t1)).items).toHaveLength(0);
    expect((await call(`/api/stories/${id}/verification`,'POST',{evidenceIds:[e.id],note,reviewed:false},t1)).status).toBe(400);
    expect((await call(`/api/stories/${id}/verification`,'POST',{evidenceIds:[e.id],note,reviewed:true},t1)).status).toBe(200);
    expect((await lineup(env,new Date(Date.parse(t0)+23*HOUR).toISOString())).items).toHaveLength(0);
    expect((await lineup(env,t1)).items[0].kind).toBe('followup');
    expect((await lineup(env,new Date(Date.parse(t0)+49*HOUR).toISOString())).items).toHaveLength(0);
    await call('/api/episodes/today','POST',undefined,t1);
    expect((await call('/api/episodes/2026-10-29/coverage','POST',{confirmCovered:true,items:[{storyId:id,kind:'followup'}]},t1)).status).toBe(200);
    expect((await lineup(env,t1)).items).toHaveLength(0);
    expect((await env.DB.prepare('SELECT state FROM followups WHERE story_id=?').bind(id).first<any>()).state).toBe('completed');
  });
  it('rejects another outlet merely repeating the original announcement',async()=>{
    const id=await coverInitial();await storeItem(env,source('nist'),{...original,url:'https://other.test/repeat',publishedAt:t1},'b',t1);
    const e=(await candidates(env,t1))[0].evidence.find(e=>e.source_id==='nist')!;
    expect((await call(`/api/stories/${id}/verification`,'POST',{evidenceIds:[e.id],note,reviewed:true},t1)).status).toBe(409);
  });
  it('expires unfulfilled follow-ups and snapshots only at 6 AM Pacific',async()=>{
    await coverInitial();
    await runScheduled(env,new Date('2026-10-29T12:30:00Z'));expect(await count('episodes')).toBe(1);
    await runScheduled(env,new Date(t1));expect(await count('episodes')).toBe(2);
    await runScheduled(env,new Date(t1));expect(await count('episodes')).toBe(2);
    await runScheduled(env,new Date('2026-10-31T13:00:00Z'));
    expect((await env.DB.prepare('SELECT state FROM followups').first<any>()).state).toBe('expired');
  });
  it('processes a real producer→queue→consumer→D1/R2 round trip',async()=>{
    await env.DB.prepare("UPDATE sources SET enabled=0 WHERE id!='quanta'").run();
    const now=new Date().toISOString();
    const xml=`<rss><channel><item><title>New artificial intelligence evaluation benchmarks</title><link>https://arxiv.org/abs/test</link><description>Evaluation findings</description><pubDate>${now}</pubDate></item></channel></rss>`;
    outboundXml=xml;
    const response=await mf.dispatchFetch('http://localhost/api/ingest',{method:'POST',headers:{authorization:'Bearer test-secret'}});
    expect(response.status).toBe(202);
    await vi.waitFor(async()=>expect(await count('articles')).toBe(1),{timeout:10000,interval:100});
    expect(await count('evidence')).toBe(1);
  },15000);
  it('retries individual failed queue messages without acknowledging them',async()=>{
    const message={body:{sourceId:'missing'},attempts:2,ack:vi.fn(),retry:vi.fn()};
    await worker.queue({messages:[message]} as any,env);
    expect(message.ack).not.toHaveBeenCalled();expect(message.retry).toHaveBeenCalledWith({delaySeconds:240});
  });
});
