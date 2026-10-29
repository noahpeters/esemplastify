import { it,expect } from 'vitest';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSources,SOURCES } from '../src/sources';
import { storeItem } from '../src/ingest';
import type { Env } from '../src/types';
it('retains story and raw provenance across a complete runtime shutdown and restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'esemplastify-persistence-'));
  const options={...convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-29',d1Databases:{DB:'persistent-ledger'},r2Buckets:{EVIDENCE:'persistent-evidence'}}),resourcePersistencePath:dir};
  let mf=new Miniflare(options);
  try{
    await mf.ready;
    const db=await mf.getD1Database('DB');
    for(const sql of (await readFile('migrations/0001_ledger.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
    const env={DB:db,EVIDENCE:await mf.getR2Bucket('EVIDENCE')} as Env;
    await seedSources(env);await env.EVIDENCE.put('proof.xml','<rss/>');
    const id=await storeItem(env,SOURCES[0],{title:'An artificial intelligence evaluation',url:'https://example.org/persistent',summary:'Findings',publishedAt:null,guid:'persistent'},'proof.xml',new Date().toISOString());
    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    const restored=await mf.getD1Database('DB');
    expect((await restored.prepare('SELECT id FROM stories WHERE id=?').bind(id).first<any>()).id).toBe(id);
    expect((await restored.prepare('SELECT raw_key FROM evidence').first<any>()).raw_key).toBe('proof.xml');
    expect(await (await (await mf.getR2Bucket('EVIDENCE')).get('proof.xml'))!.text()).toBe('<rss/>');
  }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
},20000);
