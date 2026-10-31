import { EDITORIAL_POLICY,MAX_LINEUP_ITEMS } from './editorial-policy';
import { assessStory,storyClock } from './newsworthiness';
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
    const age=Date.parse(now)-storyClock(c).time;
    return age<=72*HOUR&&age>=-HOUR?'initial':null;
  }
  if(c.completed||!c.followup||c.followup.state!=='pending'||now<c.followup.due_at||now>c.followup.expires_at||!c.verification) return null;
  const ids: string[]=JSON.parse(c.verification.evidence_ids);
  return freshEvidence(c,ids).length===ids.length&&ids.length>0?'followup':null;
}
export function rank(pool:Candidate[],now:string,targetMinutes=45) {
  const remaining=pool.flatMap(candidate=>{
    const kind=eligibility(candidate,now);if(!kind)return [];
    const c={...candidate,category:domainFor(candidate.title,candidate.category)};
    const ids=kind==='followup'?new Set<string>(JSON.parse(c.verification!.evidence_ids)):null;
    const evidence=ids?c.evidence.filter(e=>ids.has(e.id)):c.evidence;
    if(!evidence.length)return [];
    return [{c,kind,evidence,ai:isAIStory(c.title,evidence.map(e=>e.summary).join(' ')),assessment:assessStory(c,kind,now,evidence),publishers:[...new Set(evidence.map(e=>e.publisher))]}];
  });
  const selected=[];const publisherMinutes=new Map<string,number>();let minutes=0,aiCount=0;
  const publisherLimit=Math.max(4,targetMinutes*EDITORIAL_POLICY.maxPublisherMinutesFraction);
  while(remaining.length&&selected.length<MAX_LINEUP_ITEMS){
    const scored=remaining.filter(x=>x.assessment.score>=28&&(!x.ai||aiCount<EDITORIAL_POLICY.maxAIStories)&&minutes+x.assessment.minutes<=targetMinutes&&x.publishers.every(p=>(publisherMinutes.get(p)??0)+x.assessment.minutes<=publisherLimit)).map(x=>{
      // Concentration is a small penalty; subject and region labels never earn a slot.
      const publisherConcentration=-Math.min(12,Math.max(...x.publishers.map(p=>publisherMinutes.get(p)??0))*2);
      return {...x,score:x.assessment.score+publisherConcentration,components:{...x.assessment.components,publisherConcentration}};
    }).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id));
    const best=scored[0];if(!best)break;
    remaining.splice(remaining.findIndex(x=>x.c.id===best.c.id),1);
    const {c,kind,ai,evidence,assessment}=best;
    selected.push({storyId:c.id,title:c.title,category:c.category,aiTopic:ai,kind,format:assessment.format,minutes:assessment.minutes,wordBudget:assessment.wordBudget,score:best.score,components:best.components,selectionReasons:assessment.selectionReasons,depthReason:assessment.depthReason,reviewFlags:assessment.reviewFlags,reportedAt:assessment.reportedAt,timestampBasis:assessment.timestampBasis,evidenceIds:evidence.map(e=>e.id),verificationNote:kind==='followup'?c.verification!.note:undefined,sources:evidence.map(e=>({evidenceId:e.id,publisher:e.publisher,url:e.canonical_url,observedAt:e.observed_at,publishedAt:e.published_at,primary:!!e.primary_source,rawKey:e.raw_key}))});
    if(ai)aiCount++;
    minutes+=assessment.minutes;for(const p of best.publishers)publisherMinutes.set(p,(publisherMinutes.get(p)??0)+assessment.minutes);
  }
  return {editorialPolicyVersion:EDITORIAL_POLICY.version,editorialScope:EDITORIAL_POLICY.purpose,scriptGuidance:EDITORIAL_POLICY.scriptGuidance,diversity:{domains:[...new Set(selected.map(i=>i.category))],aiStories:aiCount,maxAIStories:EDITORIAL_POLICY.maxAIStories,topicQuotas:false,maxPublisherMinutes:publisherLimit},formats:{brief:selected.filter(i=>i.format==='brief').length,report:selected.filter(i=>i.format==='report').length,explainer:selected.filter(i=>i.format==='explainer').length},generatedAt:now,targetMinutes,estimatedMinutes:minutes,shortfallMinutes:Math.max(0,30-minutes),status:minutes<30?'insufficient_material':'editorial_draft',items:selected,notice:'Estimated editorial budgets, not generated scripts or measured audio. Headline cues are provisional and source claims require review. No story is stretched, repeated, or added merely to fill runtime.'};
}
export async function lineup(env:Env,now:string,target=45){return rank(await candidates(env,now),now,target);}
export async function snapshot(env:Env,now:string) {
  const id=pacificClock(new Date(now)).date;
  const existing=await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(id).first();if(existing) return existing;
  const draft=await lineup(env,now);
  await env.DB.prepare('INSERT OR IGNORE INTO episodes(id,created_at,target_minutes,lineup_json) VALUES(?,?,?,?)').bind(id,now,45,JSON.stringify(draft)).run();
  return {id,...draft};
}
