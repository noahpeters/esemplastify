import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { FeedItem } from './types';
export function plain(value: unknown): string {
  if (value && typeof value === 'object') return plain((value as Record<string,unknown>)['#text'] ?? '');
  return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'\"').replace(/&apos;/g,"'").replace(/\s+/g,' ').trim();
}
export function canonicalize(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Unsupported article URL');
  u.hash=''; u.hostname=u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  if(u.pathname !== '/') u.pathname=u.pathname.replace(/\/+$/,'');
  return u.href;
}
export async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function parseFeed(xml: string, base: string): FeedItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,''))) throw new Error('Feed entities prohibited');
  if(XMLValidator.validate(xml)!==true) throw new Error('Invalid XML');
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:true}).parse(xml);
  const entries=parsed.rss?.channel?.item ?? parsed.feed?.entry ?? parsed['rdf:RDF']?.item;
  if(!parsed.rss && !parsed.feed && !parsed['rdf:RDF']) throw new Error('Not an RSS/Atom feed');
  if(!entries) return [];
  return (Array.isArray(entries)?entries:[entries]).slice(0,150).flatMap(e=>{
    try {
      const links=Array.isArray(e.link)?e.link:[e.link];
      const link=links.find((l:any)=>typeof l==='string'||!l?.['@_rel']||l?.['@_rel']==='alternate');
      const rawLink=typeof link==='string'?link:link?.['@_href'];
      if(!rawLink) return [];
      const title=plain(e.title).slice(0,600); if(!title) return [];
      const date=Date.parse(plain(e.pubDate??e.published??e.updated??e['dc:date']));
      return [{title,url:canonicalize(new URL(rawLink,base).href),summary:plain(e.description??e.summary??e.content??e['content:encoded']).slice(0,6000),publishedAt:Number.isFinite(date)?new Date(date).toISOString():null,guid:plain(e.guid??e.id)||null}];
    } catch { return []; }
  });
}
const stop=new Set('a an the in on of to for is are and or with from at as by new how why what this that it its has have will can'.split(' '));
export function tokens(title:string) { return new Set(title.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.filter(t=>t.length>1&&!stop.has(t))??[]); }
export function similarity(a:string,b:string) {
  const x=tokens(a),y=tokens(b); if(x.size<3||y.size<3) return a.toLowerCase()===b.toLowerCase()?1:0;
  // Different model versions, dates or amounts are often different events.
  const nums=(s:string)=>s.match(/\b\d+(?:\.\d+)*\b/g)?.sort().join(',')??'';
  if(nums(a)!==nums(b)) return 0;
  const overlap=[...x].filter(t=>y.has(t)).length;
  return overlap/(x.size+y.size-overlap);
}
export function substantive(oldText:string,newText:string) {
  const before=tokens(oldText),after=tokens(newText);
  return newText.length>=120 && [...after].filter(t=>!before.has(t)).length>=12;
}
