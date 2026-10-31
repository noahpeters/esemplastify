import type { Env, Source } from './types';
// Curiosity-led coverage: creation, living, learning, and enough world context to connect them.
export const RETIRED_AI_SOURCE_IDS=['arxiv-ai','huggingface','google-research','deepmind','mit','guardian','techcrunch'];
export const SOURCES:Source[]=[
 {id:'bbc-world',name:'BBC World',url:'https://feeds.bbci.co.uk/news/world/rss.xml',publisher:'bbc',category:'world',region:'global',primary_source:0},
 {id:'aljazeera',name:'Al Jazeera',url:'https://www.aljazeera.com/xml/rss/all.xml',publisher:'aljazeera',category:'world',region:'global-south',primary_source:0},
 {id:'quanta',name:'Quanta Magazine',url:'https://www.quantamagazine.org/feed/',publisher:'quanta',category:'science',region:'global',primary_source:0},
 {id:'nasa',name:'NASA',url:'https://www.nasa.gov/feed/',publisher:'nasa',category:'science',region:'US',primary_source:1},
 {id:'nature',name:'Nature',url:'https://www.nature.com/nature.rss',publisher:'springer-nature',category:'science',region:'global',primary_source:0},
 {id:'mit-all',name:'MIT News',url:'https://news.mit.edu/rss/feed',publisher:'mit',category:'science',region:'US',primary_source:1},
 {id:'bbc-science',name:'BBC Science and Environment',url:'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',publisher:'bbc',category:'nature',region:'global',primary_source:0},
 {id:'physorg',name:'Phys.org',url:'https://phys.org/rss-feed/',publisher:'science-x',category:'science',region:'global',primary_source:0},
 {id:'smithsonian',name:'Smithsonian Magazine',url:'https://www.smithsonianmag.com/rss/latest_articles/',publisher:'smithsonian',category:'history',region:'global',primary_source:0},
 {id:'smithsonian-history',name:'Smithsonian History',url:'https://www.smithsonianmag.com/rss/history/',publisher:'smithsonian',category:'history',region:'global',primary_source:0},
 {id:'dezeen-design',name:'Dezeen Design',url:'https://www.dezeen.com/design/feed/',publisher:'dezeen',category:'design',region:'global',primary_source:0},
 {id:'designboom',name:'Designboom',url:'https://www.designboom.com/feed/',publisher:'designboom',category:'design',region:'global',primary_source:0},
 {id:'colossal',name:'Colossal',url:'https://www.thisiscolossal.com/feed/',publisher:'colossal',category:'culture',region:'global',primary_source:0},
 {id:'npr-culture',name:'NPR Arts and Life',url:'https://feeds.npr.org/1008/rss.xml',publisher:'npr',category:'culture',region:'US',primary_source:0},
 {id:'guardian-culture',name:'The Guardian Culture',url:'https://www.theguardian.com/culture/rss',publisher:'guardian',category:'culture',region:'UK',primary_source:0},
 {id:'npr-economy',name:'NPR Economy',url:'https://feeds.npr.org/1017/rss.xml',publisher:'npr',category:'economy',region:'US',primary_source:0},
 {id:'aeon',name:'Aeon',url:'https://aeon.co/feed.rss',publisher:'aeon',category:'ideas',region:'global',primary_source:0},
 {id:'marginalian',name:'The Marginalian',url:'https://www.themarginalian.org/feed/',publisher:'marginalian',category:'ideas',region:'US',primary_source:0},
 {id:'ars',name:'Ars Technica',url:'https://feeds.arstechnica.com/arstechnica/index',publisher:'ars',category:'technology',region:'US',primary_source:0},
 {id:'restofworld',name:'Rest of World',url:'https://restofworld.org/feed/',publisher:'restofworld',category:'world',region:'global-south',primary_source:0},
 {id:'conversation',name:'The Conversation',url:'https://theconversation.com/global/articles.atom',publisher:'conversation',category:'ideas',region:'global',primary_source:0},
 {id:'nist',name:'NIST',url:'https://www.nist.gov/news-events/news/rss.xml',publisher:'nist',category:'science',region:'US',primary_source:1},
];
export async function seedSources(env:Env){
 await env.DB.batch([
  ...SOURCES.map(s=>env.DB.prepare('INSERT INTO sources(id,name,url,publisher,category,region,primary_source) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,publisher=excluded.publisher,category=excluded.category,region=excluded.region,primary_source=excluded.primary_source').bind(s.id,s.name,s.url,s.publisher,s.category,s.region,s.primary_source)),
  ...RETIRED_AI_SOURCE_IDS.map(id=>env.DB.prepare('UPDATE sources SET enabled=0 WHERE id=?').bind(id)),
 ]);
}
// Breadth is intentional. There is no AI-keyword admission requirement.
export const relevant=(_source:Source,text:string)=>!!text.trim()&&!/^BBC Inside Science(?:\s|$)/i.test(text.trim())&&!/^(?:sponsored\b|advertisement\b|advertorial\b|paid post\b|get featured\b|subscribe now\b)/i.test(text.trim());
