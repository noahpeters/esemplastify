import { domainFor, isAIStory } from './topics';
import { substantive } from './feed';
import type { Candidate, Env, Evidence } from './types';
export const HOUR=3600000;
export function pacificClock(date:Date) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour')),minute:Number(get('minute'))};
}
export async function candidates(env:Env,now:string):Promise<Candidate[]> {
  // Keep the full provenance available at /api/stories/:id; rank a bounded recent pool.
  const {results:stories}=await env.DB.prepare(`SELECT s.*,c.covered_at,c.evidence_ids,f.due_at,f.expires_at,f.state,v.evidence_ids AS verified_ids,v.note,EXISTS(SELECT 1 FROM coverage c2 WHERE c2.story_id=s.id AND c2.kind='followup') AS completed FROM stories s LEFT JOIN coverage c ON c.story_id=s.id AND c.kind='initial' LEFT JOIN followups f ON f.story_id=s.id LEFT JOIN verifications v ON v.story_id=s.id WHERE s.first_seen>=? OR (f.state='pending' AND f.expires_at>=?) ORDER BY s.first_seen DESC LIMIT 1000`).bind(new Date(Date.parse(now)-7*24*HOUR).toISOString(),now).all<any>();
  // D1 bound parameter limits make one query per story expensive; load evidence in a single indexed join.
  const {results:evidence}=await env.DB.prepare(`SELECT e.*,a.canonical_url,a.story_id,s.publisher,s.primary_source,s.region,s.enabled AS source_enabled FROM evidence e JOIN articles a ON a.id=e.article_id JOIN sources s ON s.id=e.source_id WHERE a.story_id IN (SELECT id FROM stories WHERE first_seen>=? UNION SELECT story_id FROM followups WHERE state='pending' AND expires_at>=?)`).bind(new Date(Date.parse(now)-7*24*HOUR).toISOString(),now).all<Evidence&{story_id:string;source_enabled:number}>();
  const grouped=new Map<string,Evidence[]>(); for(const e of evidence){const list=grouped.get(e.story_id)??[];list.push(e);grouped.set(e.story_id,list);}
  return stories.map(s=>({...s,evidence:grouped.get(s.id)??[],activeSources:(grouped.get(s.id)??[]).some(e=>(e as Evidence&{source_enabled:number}).source_enabled===1),initial:s.covered_at?{covered_at:s.covered_at,evidence_ids:s.evidence_ids}:undefined,followup:s.due_at?{due_at:s.due_at,expires_at:s.expires_at,state:s.state}:undefined,verification:s.verified_ids?{evidence_ids:s.verified_ids,note:s.note}:undefined,completed:!!s.completed}));
}
export function freshEvidence(c:Candidate,ids:string[]) {
  if(!c.initial) return [];
  const covered=new Set<string>(JSON.parse(c.initial.evidence_ids));
  const old=c.evidence.filter(e=>covered.has(e.id)).map(e=>`${e.title} ${e.summary}`).join(' ');
  return c.evidence.filter(e=>ids.includes(e.id)&&!covered.has(e.id)&&e.observed_at>c.initial!.covered_at&&(!e.published_at||e.published_at>=c.initial!.covered_at)&&substantive(old,`${e.title} ${e.summary}`));
}
export function eligibility(c:Candidate,now:string):'initial'|'followup'|null {
  if(!c.initial) {
    if(c.activeSources===false)return null;
    // Publication age, not a repeatedly refreshed feed's last_seen, controls initial novelty.
    const age=Date.parse(now)-Math.max(...c.evidence.map(e=>Date.parse(e.published_at??e.observed_at)));
    return age<=72*HOUR&&age>=-HOUR?'initial':null;
  }
  if(c.completed||!c.followup||c.followup.state!=='pending'||now<c.followup.due_at||now>c.followup.expires_at||!c.verification) return null;
  const ids: string[]=JSON.parse(c.verification.evidence_ids);
  return freshEvidence(c,ids).length===ids.length&&ids.length>0?'followup':null;
}
export function rank(pool:Candidate[],now:string,targetMinutes=45) {
  const remaining=pool.map(c=>({c:{...c,category:domainFor(c.title,c.category)},kind:eligibility(c,now),ai:isAIStory(c.title,c.evidence.map(e=>e.summary).join(' '))})).filter(x=>x.kind!==null);
  const selected:any[]=[];const publishers=new Map<string,number>(),categories=new Map<string,number>(),regions=new Set<string>();let minutes=0,aiCount=0;
  const availableDomains=new Set(remaining.map(x=>x.c.category)).size;
  const desiredDomains=Math.min(5,availableDomains,Math.floor(targetMinutes/5));
  while(remaining.length&&minutes+5<=targetMinutes){
    const scored=remaining.filter(x=>(!x.ai||aiCount<1)&&(categories.get(x.c.category)??0)<2).map(({c,kind,ai})=>{
      const uniquePublishers=[...new Set(c.evidence.map(e=>e.publisher))];
      const published=c.evidence.flatMap(e=>e.published_at?[Date.parse(e.published_at)]:[]);
      const age=Math.max(0,(Date.parse(now)-Math.min(Date.parse(c.first_seen),...published))/HOUR);
      const components={novelty:kind==='initial'?Math.max(0,30-age/3):12,provenance:Math.min(15,uniquePublishers.length*5),primary:c.evidence.some(e=>e.primary_source)?10:0,categoryDiversity:categories.size<desiredDomains&&!categories.has(c.category)?35:14/(1+(categories.get(c.category)??0)),publisherDiversity:12/(1+Math.min(...uniquePublishers.map(p=>publishers.get(p)??0))),regionalDiversity:c.evidence.some(e=>!regions.has(e.region))?7:0,verificationFollowup:kind==='followup'?18:0};
      return {c,kind,ai,components,score:Object.values(components).reduce((a,b)=>a+b,0),uniquePublishers};
    }).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id));
    const best=scored[0];if(!best) break;
    remaining.splice(remaining.findIndex(x=>x.c.id===best.c.id),1);
    // Publisher breadth is a hard cap; sparse days report a shortfall.
    if(best.uniquePublishers.some(p=>(publishers.get(p)??0)>=2)) continue;
    const evidenceIds=best.kind==='followup'?JSON.parse(best.c.verification!.evidence_ids):best.c.evidence.map(e=>e.id);
    selected.push({storyId:best.c.id,title:best.c.title,category:best.c.category,aiTopic:best.ai,kind:best.kind,minutes:5,score:Math.round(best.score*100)/100,components:best.components,evidenceIds,verificationNote:best.kind==='followup'?best.c.verification!.note:undefined,sources:best.c.evidence.filter(e=>evidenceIds.includes(e.id)).map(e=>({evidenceId:e.id,publisher:e.publisher,url:e.canonical_url,observedAt:e.observed_at,publishedAt:e.published_at,primary:!!e.primary_source,rawKey:e.raw_key}))});
    if(best.ai)aiCount++;
    minutes+=5;categories.set(best.c.category,(categories.get(best.c.category)??0)+1);for(const p of best.uniquePublishers) publishers.set(p,(publishers.get(p)??0)+1);for(const e of best.c.evidence) regions.add(e.region);
  }
  return {editorialScope:'curiosity-led: creation, living, learning, and world context',diversity:{domains:[...categories.keys()],aiStories:aiCount,maxAIStories:1,maxStoriesPerDomain:2,maxStoriesPerPublisher:2},generatedAt:now,targetMinutes,estimatedMinutes:minutes,shortfallMinutes:Math.max(0,30-minutes),status:minutes<30?'insufficient_material':'editorial_draft',items:selected,notice:'Estimated discussion slots, not generated audio. Source claims and research are unverified until editorial review. No filler is added to meet runtime.'};
}
export async function lineup(env:Env,now:string,target=45){return rank(await candidates(env,now),now,target);}
export async function snapshot(env:Env,now:string) {
  const id=pacificClock(new Date(now)).date;
  const existing=await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(id).first();if(existing) return existing;
  const draft=await lineup(env,now);
  await env.DB.prepare('INSERT OR IGNORE INTO episodes(id,created_at,target_minutes,lineup_json) VALUES(?,?,?,?)').bind(id,now,45,JSON.stringify(draft)).run();
  return {id,...draft};
}
