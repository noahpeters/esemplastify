import { describe,it,expect } from 'vitest';
import { canonicalize,parseFeed,similarity,substantive,plain } from '../src/feed';
import { pacificClock,rank,eligibility,HOUR } from '../src/editorial';
import { DOMAINS,domainFor,isAIStory } from '../src/topics';
import { SOURCES,relevant } from '../src/sources';
import type { Candidate } from '../src/types';
const now='2026-10-29T13:00:00.000Z';
function candidate(id:string,category='science',publisher='a'):Candidate {
  return {id,title:`Important discovery ${id}`,category,first_seen:now,last_seen:now,completed:false,evidence:[{id:`e${id}`,article_id:id,source_id:publisher,content_hash:'hash',title:'A new model',summary:'summary',observed_at:now,published_at:now,raw_key:'feed.xml',publisher,primary_source:1,region:'US',canonical_url:`https://example.org/${id}`}]};
}
describe('RSS/Atom and conservative clustering',()=>{
  it('canonicalizes trackers and fragments but preserves meaningful identifiers',()=>{
    expect(canonicalize('https://Example.com/story/?utm_source=x&model=2#top')).toBe('https://example.com/story?model=2');
    expect(canonicalize('https://example.com/?model=2')).not.toBe(canonicalize('https://example.com/?model=3'));
  });
  it('parses RSS with CDATA and missing dates',()=>{
    const items=parseFeed('<rss><channel><item><title>AI &amp; science</title><link>https://example.org/a</link><description><![CDATA[<p>Model details</p>]]></description><guid>one</guid></item></channel></rss>','https://example.org');
    expect(items[0]).toMatchObject({title:'AI & science',summary:'Model details',publishedAt:null,guid:'one'});
  });
  it('decodes nested numeric entities in publisher titles',()=>{expect(plain('South Korea&#8217;s AI')).toBe('South Korea’s AI');});
  it('uses Atom alternate link instead of self link and handles relative links',()=>{
    expect(parseFeed('<feed><entry><title>New AI</title><link rel="self" href="/atom"/><link rel="alternate" href="/article"/><updated>2026-10-29T12:00:00Z</updated></entry></feed>','https://example.org/feed')[0].url).toBe('https://example.org/article');
  });
  it('rejects non-feeds, malformed XML, entities and unsafe article schemes',()=>{
    expect(()=>parseFeed('<html/>','https://x.test')).toThrow();
    expect(()=>parseFeed('<rss><broken>','https://x.test')).toThrow();
    expect(()=>parseFeed('<!DOCTYPE rss><rss/>','https://x.test')).toThrow();
    expect(parseFeed('<rss><channel><item><title>AI</title><link>javascript:alert(1)</link></item></channel></rss>','https://x.test')).toEqual([]);
  });
  it('clusters close paraphrases but separates numerical event changes',()=>{
    expect(similarity('NIST releases artificial intelligence safety framework','NIST releases new artificial intelligence safety framework')).toBeGreaterThan(.58);
    expect(similarity('Model 2 improves reasoning performance','Model 3 improves reasoning performance')).toBe(0);
    expect(similarity('New AI model','New AI policy')).toBeLessThan(.58);
  });
  it('requires material new text, not syndicated repetition',()=>{
    const text='Independent researchers measured reliability across several benchmarks and discovered important limitations affecting medical applications and training data.';
    expect(substantive(text,text)).toBe(false);
    expect(substantive('A company announces a model.',text)).toBe(true);
  });
});
describe('editorial rules',()=>{
  it('resolves 6 AM Pacific in summer and winter, including DST boundary dates',()=>{
    expect(pacificClock(new Date('2026-07-01T13:00:00Z'))).toEqual({date:'2026-07-01',hour:6,minute:0});
    expect(pacificClock(new Date('2026-12-01T14:00:00Z'))).toEqual({date:'2026-12-01',hour:6,minute:0});
    expect(pacificClock(new Date('2026-11-01T14:00:00Z')).hour).toBe(6);
    expect(pacificClock(new Date('2026-03-08T13:00:00Z')).hour).toBe(6);
  });
  it('excludes covered initial stories without an approved follow-up',()=>{
    const c=candidate('a');c.initial={covered_at:now,evidence_ids:'["ea"]'};
    expect(eligibility(c,now)).toBeNull();
  });
  it('never pads a sparse day or exceeds requested runtime',()=>{
    expect(rank([candidate('a')],now,45)).toMatchObject({estimatedMinutes:1,shortfallMinutes:29,status:'insufficient_material'});
    expect(rank(Array.from({length:80},(_,i)=>candidate(`${i}`,DOMAINS[i%DOMAINS.length],`publisher${i}`)),now,60).estimatedMinutes).toBeLessThanOrEqual(60);
  });
  it('reduces publisher concentration for otherwise equally fresh reporting',()=>{
    const ranked=rank([candidate('1'),candidate('2'),candidate('3','policy','b')],now);
    expect(ranked.items.slice(0,2).map(x=>x.category).sort()).toEqual(['science','world']);
  });
  it('ranks newly discovered articles by publication freshness',()=>{const older=candidate('a');older.evidence[0].published_at=new Date(Date.parse(now)-60*HOUR).toISOString();expect(rank([older,candidate('z')],now).items[0].storyId).toBe('z');});
  it('does not treat old articles refreshed in a feed as new',()=>{
    const c=candidate('old');c.evidence[0].published_at=new Date(Date.parse(now)-100*HOUR).toISOString();
    expect(eligibility(c,now)).toBeNull();
  });
});

describe('broad editorial scope',()=>{
  it('admits discoveries, design, culture and world news without an AI keyword',()=>{
    for(const title of ['A new space mission','Furniture made from fallen trees','An exhibition of forgotten paintings','Parliament approves a ceasefire'])expect(relevant(SOURCES[0],title)).toBe(true);
    expect(relevant(SOURCES[0],'Sponsored: buy our product')).toBe(false);
    expect(relevant(SOURCES[0],'BBC Inside Science A link to the recurring programme')).toBe(false);
  });
  it('does not confuse the artist Ai Weiwei with artificial intelligence',()=>{
    expect(isAIStory('Ai Weiwei unveils a new exhibition')).toBe(false);
    expect(isAIStory('AI changes furniture design')).toBe(true);
    expect(domainFor('Ai Weiwei unveils a new exhibition','culture')).toBe('culture');
    expect(domainFor('Dissecting a messy ballot and coalition-building process','ideas')).toBe('world');
  });
  it('limits AI across source categories without subject quotas',()=>{
    const pool=DOMAINS.flatMap((domain,i)=>Array.from({length:3},(_,j)=>candidate(`${i}-${j}`,domain,`p${i}-${j}`)));
    pool.push({...candidate('ai1','science','ai1'),title:'AI research advances'}, {...candidate('ai2','design','ai2'),title:'AI furniture design advances'});
    const result=rank(pool,now,60);
    expect(result.diversity.topicQuotas).toBe(false);
    expect(result.items.filter(i=>i.aiTopic).length).toBeLessThanOrEqual(1);
    expect(result.items.filter(i=>i.category==='world').length).toBeGreaterThan(2);
  });
  it('gives AI no preference over equally fresh evidence',()=>{
    const ai={...candidate('z','technology','z'),title:'AI research advances'};
    expect(rank([ai,candidate('a','technology','a')],now).items[0].storyId).toBe('a');
  });
  it('caps repeated publishers and excludes retired-only stories from initial coverage',()=>{
    const result=rank(DOMAINS.map((domain,i)=>candidate(String(i),domain,'same')),now);
    expect(result.estimatedMinutes).toBeLessThanOrEqual(result.diversity.maxPublisherMinutes);
    const retired={...candidate('retired'),activeSources:false};
    expect(eligibility(retired,now)).toBeNull();
  });
  it('counts every contributing publisher toward its cap',()=>{
    const a=candidate('a','world','same'),b=candidate('b','science','same'),c=candidate('c','culture','same');
    c.evidence.push({...c.evidence[0],id:'other',publisher:'other'});
    const extra=Array.from({length:20},(_,i)=>candidate(`d${i}`,'world','same'));
    const result=rank([a,b,c,...extra],now);
    const sameMinutes=result.items.filter(i=>i.sources.some(s=>s.publisher==='same')).reduce((sum,i)=>sum+i.minutes,0);
    expect(sameMinutes).toBeLessThanOrEqual(result.diversity.maxPublisherMinutes);
  });
  it('permits embedded HTML declarations inside CDATA but rejects XML declarations outside it',()=>{
    expect(parseFeed('<rss><channel><item><title>Space</title><link>https://example.org/a</link><description><![CDATA[<!DOCTYPE html><p>Mission</p>]]></description></item></channel></rss>','https://example.org')).toHaveLength(1);
    expect(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>','https://example.org')).toThrow();
  });
});
