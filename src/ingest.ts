import { domainFor } from './topics';
import { canonicalize, hash, parseFeed, similarity } from './feed';
import { relevant, seedSources } from './sources';
import type { Env, FeedItem, Source } from './types';

export async function enqueueSources(env:Env) {
  await seedSources(env);
  const {results}=await env.DB.prepare('SELECT id FROM sources WHERE enabled=1').all<{id:string}>();
  await env.INGEST.sendBatch(results.map(s=>({body:{sourceId:s.id},contentType:'json' as const})));
  return results.length;
}
export async function boundedText(response:Response,limit=2_000_000) {
  if(!response.body) throw new Error('Empty response');
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  try {
    while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>limit) throw new Error('Feed exceeds size limit'); chunks.push(value); }
  } catch(e) { await reader.cancel(); throw e; }
  const merged=new Uint8Array(size); let offset=0; for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(merged);
}
export async function storeItem(env:Env, source:Source, item:FeedItem, rawKey:string, now:string) {
  const canonical=canonicalize(item.url);
  const articleId=await hash(canonical);
  const existing=await env.DB.prepare('SELECT story_id FROM articles WHERE id=?').bind(articleId).first<{story_id:string}>();
  let storyId=existing?.story_id;
  if(!storyId) {
    const {results}=await env.DB.prepare('SELECT s.id,a.title FROM stories s JOIN articles a ON a.story_id=s.id WHERE s.last_seen>=? AND ABS(julianday(COALESCE(a.published_at,a.first_seen))-julianday(?))<=3 ORDER BY s.last_seen DESC LIMIT 1500').bind(new Date(Date.parse(now)-7*86400000).toISOString(),item.publishedAt??now).all<{id:string;title:string}>();
    let best=0.58;
    for(const candidate of results){const score=similarity(item.title,candidate.title);if(score>=best){best=score;storyId=candidate.id;}}
    storyId??=await hash(`story:${canonical}`);
  }
  const contentHash=await hash(`${item.title}\n${item.summary}`);
  const evidenceId=await hash(`${articleId}:${source.id}:${contentHash}`);
  // One atomic D1 batch: a queue retry can never leave a half-written ledger item.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO stories(id,title,category,first_seen,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').bind(storyId,item.title,domainFor(item.title,source.category),now,now),
    env.DB.prepare('INSERT INTO articles(id,story_id,canonical_url,title,summary,published_at,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,last_seen=excluded.last_seen').bind(articleId,storyId,canonical,item.title,item.summary,item.publishedAt,now,now),
    env.DB.prepare('INSERT OR IGNORE INTO evidence(id,article_id,source_id,content_hash,title,summary,observed_at,published_at,raw_key,guid) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(evidenceId,articleId,source.id,contentHash,item.title,item.summary,now,item.publishedAt,rawKey,item.guid),
  ]);
  return storyId;
}
export async function ingestSource(env:Env,sourceId:string,now=new Date().toISOString(),fetcher:typeof fetch=fetch) {
  const source=await env.DB.prepare('SELECT * FROM sources WHERE id=?').bind(sourceId).first<Source>();
  if(!source)throw new Error('Unknown source');
  if(source.enabled===0)return {sourceId,skipped:true,items:0};
  const fetchId=crypto.randomUUID(); let status=0;
  try {
    const headers:Record<string,string>={'User-Agent':'Esemplastify/0.1 (RSS discovery; source links retained)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'};
    if(source.etag) headers['If-None-Match']=source.etag;
    if(source.modified) headers['If-Modified-Since']=source.modified;
    const response=await fetcher(source.url,{headers,signal:AbortSignal.timeout(20000),redirect:'follow'});status=response.status;
    if(status===304){await env.DB.batch([
      env.DB.prepare('INSERT INTO fetches(id,source_id,fetched_at,status) VALUES(?,?,?,?)').bind(fetchId,sourceId,now,status),
      env.DB.prepare('UPDATE sources SET last_success=?,last_error=NULL WHERE id=?').bind(now,sourceId),
    ]);return {sourceId,notModified:true,items:0};}
    if(!response.ok) throw new Error(`Feed HTTP ${status}`);
    const xml=await boundedText(response);
    const items=parseFeed(xml,source.url).filter(i=>relevant(source,`${i.title} ${i.summary}`)).filter(i=>!i.publishedAt||(Date.parse(i.publishedAt)<=Date.parse(now)+3600000&&Date.parse(i.publishedAt)>=Date.parse(now)-7*86400000));
    const key=`feeds/${sourceId}/${await hash(xml)}.xml`;
    await env.EVIDENCE.put(key,xml,{httpMetadata:{contentType:'application/xml'}});
    for(const item of items) await storeItem(env,source,item,key,now);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO fetches(id,source_id,fetched_at,status,raw_key,item_count) VALUES(?,?,?,?,?,?)').bind(fetchId,sourceId,now,status,key,items.length),
      env.DB.prepare('UPDATE sources SET last_success=?,last_error=NULL,etag=?,modified=? WHERE id=?').bind(now,response.headers.get('etag'),response.headers.get('last-modified'),sourceId),
    ]);
    return {sourceId,items:items.length};
  }catch(error){
    // Error details contain no feed content or credentials.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO fetches(id,source_id,fetched_at,status) VALUES(?,?,?,?)').bind(fetchId,sourceId,now,status),
      env.DB.prepare('UPDATE sources SET last_error=? WHERE id=?').bind(error instanceof Error?error.message.slice(0,180):'Fetch failed',sourceId),
    ]);
    throw error;
  }
}
