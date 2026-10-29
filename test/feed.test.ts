import { describe,it,expect } from 'vitest';
import { canonicalize,parseFeed,similarity,substantive,plain } from '../src/feed';
import { pacificClock,rank,eligibility,HOUR } from '../src/editorial';
import type { Candidate } from '../src/types';
const now='2026-10-29T13:00:00.000Z';
function candidate(id:string,category='science',publisher='a'):Candidate {
  return {id,title:`Important AI story ${id}`,category,first_seen:now,last_seen:now,completed:false,evidence:[{id:`e${id}`,article_id:id,source_id:publisher,content_hash:'hash',title:'A new model',summary:'summary',observed_at:now,published_at:now,raw_key:'feed.xml',publisher,primary_source:1,region:'US',canonical_url:`https://example.org/${id}`}]};
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
    expect(rank([candidate('a')],now,45)).toMatchObject({estimatedMinutes:5,shortfallMinutes:25,status:'insufficient_material'});
    expect(rank(Array.from({length:30},(_,i)=>candidate(`${i}`,`category${i}`,`publisher${i}`)),now,60).estimatedMinutes).toBe(60);
  });
  it('rewards topic and publisher diversity over equally fresh repetition',()=>{
    const ranked=rank([candidate('1'),candidate('2'),candidate('3','policy','b')],now);
    expect(ranked.items.slice(0,2).map(x=>x.category).sort()).toEqual(['policy','science']);
  });
  it('ranks newly discovered articles by publication freshness',()=>{const older=candidate('a');older.evidence[0].published_at=new Date(Date.parse(now)-60*HOUR).toISOString();expect(rank([older,candidate('z')],now).items[0].storyId).toBe('z');});
  it('does not treat old articles refreshed in a feed as new',()=>{
    const c=candidate('old');c.evidence[0].published_at=new Date(Date.parse(now)-100*HOUR).toISOString();
    expect(eligibility(c,now)).toBeNull();
  });
});
