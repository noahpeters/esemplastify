import type { Candidate,Evidence } from './types';
import { EDITORIAL_POLICY } from './editorial-policy';
const HOUR=3600000;
// These are transparent triage cues, not judgments that a source's claims are true.
const signals:[string,number,RegExp][]=[
  ['public safety or accountability',16,/\b(recall(?:ed|s)?|outbreak|evacuat\w*|contaminat\w*|wildfires?|flood\w*|earthquake|police|officers?|assault\w*|raped?|arrest\w*|investigat\w*|civil rights|court|ruling|lawsuit|ceasefire|elections?|ballot|vot(?:e|ed|es|ing)|candidates?)\b/i],
  ['everyday costs, work, or public services',12,/\b(prices?|costs?|wages?|jobs?|workers?|layoffs?|housing|rent|benefits|schools?|hospitals?|transit|merger|acqui(?:re|res|red|sition)|buys?|rates?|tariffs?|billion|million|ban(?:s|ned)?)\b/i],
  ['new knowledge or a concrete discovery',8,/\b(discover\w*|research\w*|study|studies|trial|scientists?|engineers?|nanoparticles|findings?|unearth\w*|evidence|rescue\w*)\b/i],
  ['a cultural or human development',8,/\b(dies|died|obituary|tribute|memorial|opens?|unveil\w*|exhibition)\b/i],
];
export function storyClock(c:Candidate,evidence=c.evidence){
  const published=evidence.flatMap(e=>{const time=Date.parse(e.published_at??'');return Number.isFinite(time)?[time]:[];});
  // Another outlet repeating an old event must not reset its publication clock.
  const observed=evidence.map(e=>Date.parse(e.observed_at)).filter(Number.isFinite);
  const time=published.length?Math.min(...published):Math.min(Date.parse(c.first_seen),...observed);
  return {time,basis:published.length?'publication':'observation'} as const;
}
export function assessStory(c:Candidate,kind:'initial'|'followup',now:string,evidence:Evidence[]){
  const clock=storyClock(c,evidence),ageHours=Math.max(0,(Date.parse(now)-clock.time)/HOUR);
  const matched=signals.filter(([, ,pattern])=>pattern.test(c.title));
  const publicInterest=Math.min(24,matched.reduce((sum,[,weight])=>sum+weight,0));
  const freshness=clock.basis==='observation'?14:ageHours<=6?42:ageHours<=24?34:ageHours<=48?18:8;
  const publishers=new Set(evidence.map(e=>e.publisher));
  const recurringFeature=/^(?:APOD:|.*Night Sky Notes:|Your (?:daily|weekly) horoscope\b)/i.test(c.title)?-12:0;
  const components={freshness,publicInterest,recurringFeature,publisherSupport:Math.min(8,Math.max(0,publishers.size-1)*4),primaryEvidence:evidence.some(e=>e.primary_source)?2:0,verifiedFollowup:kind==='followup'?10:0};
  const score=Object.values(components).reduce((sum,n)=>sum+n,0);
  // Count each article once: repeated feed revisions do not buy more discussion time.
  const articles=new Map<string,string>();
  for(const e of evidence)if((articles.get(e.article_id)?.length??0)<e.summary.length)articles.set(e.article_id,e.summary);
  const words=[...articles.values()].join(' ').trim().split(/\s+/).filter(Boolean).length;
  const format=kind==='followup'?'report':score>=58&&publishers.size>=2&&words>=160?'explainer':score>=48&&words>=60?'report':'brief';
  const minutes=EDITORIAL_POLICY.formats[format];
  const reviewFlags=['Source claims require editorial verification before narration.'];
  if(clock.basis==='observation')reviewFlags.push('Publication date unknown: observation time is not an event date. Verify timeliness.');
  if(/\b(alleg\w*|accus\w*|police|officers?|assault\w*|raped?|candidates?)\b/i.test(c.title))reviewFlags.push('Verify allegations and official responses; do not infer links between separate incidents.');
  if(/\b(research\w*|study|studies|trial|vaccine|cancer)\b/i.test(c.title))reviewFlags.push('Check study status and limitations; distinguish preliminary research from established outcomes.');
  return {score,components,format,minutes,wordBudget:minutes*EDITORIAL_POLICY.wordsPerMinute,ageHours:Math.round(ageHours*10)/10,reportedAt:new Date(clock.time).toISOString(),timestampBasis:clock.basis,selectionReasons:[`${clock.basis==='publication'?'Earliest reported publication':'First observation'}: ${Math.round(ageHours)} hours ago.`,...matched.map(([label])=>`Headline cue: ${label}.`)],depthReason:format==='explainer'?'Multiple publishers and substantive source summaries support a longer review.':format==='report'?'A substantive development or approved follow-up supports a focused report.':'A bounded update: keep concise unless editorial review finds more to explain.',reviewFlags};
}
