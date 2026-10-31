import {describe,it,expect} from 'vitest';
import {rank,eligibility,HOUR} from '../src/editorial';
import {EDITORIAL_POLICY,MAX_LINEUP_ITEMS} from '../src/editorial-policy';
import type {Candidate} from '../src/types';
const now='2026-10-30T13:00:00.000Z';
function story(id:string,title:string,age=1,summary='A concise source account.',publisher=id):Candidate{
 const date=new Date(Date.parse(now)-age*HOUR).toISOString();
 return {id,title,category:'world',first_seen:now,last_seen:now,completed:false,evidence:[{id:'e'+id,article_id:id,source_id:publisher,content_hash:'hash',title,summary,observed_at:now,published_at:date,raw_key:'feed.xml',publisher,primary_source:0,region:'US',canonical_url:`https://example.org/${id}`}]};
}
const account='Reporting describes the decision, its timeline, the available documents, the response from the people involved, what happens next, and the questions investigators have yet to answer. '.repeat(4);
describe('timely informative briefing',()=>{
 it('places a recent local accountability development above a fresh recurring feature',()=>{
  const local=story('local','Police officer placed on leave after investigation',3,account);
  const feature=story('feature','APOD: A spectacular view of the sky',0);
  const result=rank([feature,local],now);
  expect(result.items[0].storyId).toBe('local');
  expect(result.items[0].reviewFlags.join(' ')).toContain('do not infer links');
 });
 it('allows several significant stories in the same subject without inventing a theme',()=>{
  const result=rank(['Court rules on ballot access','Police investigation opens','Evacuation order issued','Candidate reports assault'].map((title,i)=>story(String(i),title)),now);
  expect(result.items).toHaveLength(4);
  expect(result.items.every(i=>i.category==='world')).toBe(true);
  expect(result.diversity.topicQuotas).toBe(false);
  expect(result.scriptGuidance.join(' ')).toContain('do not invent a unifying theme');
 });
 it('uses short briefs, focused reports, and evidence-supported explainers',()=>{
  const brief=story('brief','Museum opens a new exhibit');
  const report=story('report','Police investigation opens',1,account);
  const deep=story('deep','Court orders recall of unsafe heaters',1,account);
  deep.evidence.push({...deep.evidence[0],id:'deep2',article_id:'second',publisher:'second',canonical_url:'https://other.org/report'});
  const result=rank([brief,report,deep],now);
  expect(result.items.find(i=>i.storyId==='brief')).toMatchObject({format:'brief',minutes:1,wordBudget:150});
  expect(result.items.find(i=>i.storyId==='report')).toMatchObject({format:'report',minutes:2,wordBudget:300});
  expect(result.items.find(i=>i.storyId==='deep')).toMatchObject({format:'explainer',minutes:4,wordBudget:600});
  expect(result.estimatedMinutes).toBe(7);expect(result.shortfallMinutes).toBe(23);
 });
 it('does not mistake repeated revisions or longer summaries for independent support',()=>{
  const c=story('one','Court orders recall of unsafe heaters',1,account);
  c.evidence.push({...c.evidence[0],id:'revision'});
  expect(rank([c],now).items[0].format).toBe('report');
 });
 it('does not refresh an old event simply because another outlet repeats it today',()=>{
  const c=story('old','Court issues ruling',100,account);
  c.evidence.push({...c.evidence[0],id:'repeat',published_at:now,publisher:'repeat'});
  expect(eligibility(c,now)).toBeNull();
 });
 it('labels unknown publication dates and keeps routine undated material out',()=>{
  const urgent=story('urgent','Police investigation opens');urgent.evidence[0].published_at=null;
  const routine=story('routine','A gallery of pictures');routine.evidence[0].published_at=null;
  const result=rank([urgent,routine],now);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].timestampBasis).toBe('observation');
  expect(result.items[0].reviewFlags.join(' ')).toContain('Publication date unknown');
 });
 it('attributes and budgets a follow-up using only approved new evidence',()=>{
  const c=story('follow','Police investigation publishes findings',24,account,'original');
  c.initial={covered_at:new Date(Date.parse(now)-24*HOUR).toISOString(),evidence_ids:'["efollow"]'};
  c.followup={due_at:now,expires_at:new Date(Date.parse(now)+24*HOUR).toISOString(),state:'pending'};
  const summary='Independent investigators published previously unavailable witness interviews, forensic measurements, detailed timelines, camera recordings, medical records, laboratory findings, dispatch documents, and conclusions that materially change the initial account of what happened.';
  c.evidence.push({...c.evidence[0],id:'new',publisher:'new',observed_at:now,published_at:now,summary});
  c.verification={evidence_ids:'["new"]',note:'Checked the new independent investigation against the initial report.'};
  const item=rank([c],now).items[0];
  expect(item.kind).toBe('followup');expect(item.minutes).toBe(2);
  expect(item.evidenceIds).toEqual(['new']);expect(item.sources.map(s=>s.publisher)).toEqual(['new']);
 });
 it('uses publisher time limits and never lengthens briefs to fill a runtime',()=>{
  const all=Array.from({length:80},(_,i)=>story(String(i),'A small reported update',1,'Short update.',i<40?'same':String(i)));
  for(const target of [30,45,60]){
   const result=rank(all,now,target);
   expect(result.estimatedMinutes).toBeLessThanOrEqual(target);
   expect(result.items.length).toBeLessThanOrEqual(MAX_LINEUP_ITEMS);
   expect(result.items.every(i=>i.minutes===1)).toBe(true);
   expect(result.items.filter(i=>i.sources.some(s=>s.publisher==='same')).length).toBeLessThanOrEqual(result.diversity.maxPublisherMinutes);
  }
  expect(EDITORIAL_POLICY.overarchingThemeRequired).toBe(false);
 });
 it('does not change decisions when only subject and regional labels change',()=>{
  const pool=[story('a','Court issues ruling'),story('b','Museum opens exhibit'),story('c','A small reported update')];
  const relabelled=pool.map((c,i)=>({...c,category:['science','culture','nature'][i],evidence:c.evidence.map(e=>({...e,region:'other'}))}));
  expect(rank(pool,now).items.map(i=>[i.storyId,i.score])).toEqual(rank(relabelled,now).items.map(i=>[i.storyId,i.score]));
 });
});
