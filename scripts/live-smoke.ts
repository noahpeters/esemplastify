import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { seedSources,SOURCES } from '../src/sources';
import { ingestSource } from '../src/ingest';
import { lineup } from '../src/editorial';
import type { Env } from '../src/types';
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("Local smoke ledger")}}',compatibilityDate:'2026-10-29',d1Databases:{DB:'smoke-ledger'},r2Buckets:{EVIDENCE:'smoke-evidence'},}),resourcePersistencePath:'.wrangler/smoke'});
try {
  await mf.ready;
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE IF NOT EXISTS smoke_migrations(id TEXT PRIMARY KEY)').run();
  if(!await db.prepare("SELECT id FROM smoke_migrations WHERE id='0001'").first()){
    const sql=await readFile('migrations/0001_ledger.sql','utf8');
    for(const statement of sql.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
    await db.prepare("INSERT INTO smoke_migrations(id) VALUES('0001')").run();
  }
  const env={DB:db,EVIDENCE:await mf.getR2Bucket('EVIDENCE')} as Env;
  await seedSources(env);
  const now=new Date().toISOString();const results=[];
  for(const s of SOURCES){try{results.push(await ingestSource(env,s.id,now));}catch(error){results.push({sourceId:s.id,error:error instanceof Error?error.message:'Unknown failure'});}}
  const counts:Record<string,number>={};
  for(const table of ['sources','stories','articles','evidence','fetches','coverage'])counts[table]=Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<any>())!.n);
  const draft=await lineup(env,now);
  const report={checkedAt:now,environment:'local Cloudflare runtime, live public RSS inputs',results,counts,lineup:{estimatedMinutes:draft.estimatedMinutes,shortfallMinutes:draft.shortfallMinutes,items:draft.items}};
  await mkdir('work',{recursive:true});await writeFile('work/live-smoke.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checkedAt:now,results,counts,lineupMinutes:draft.estimatedMinutes,lineupItems:draft.items.length},null,2));
}finally{await mf.dispose();}
