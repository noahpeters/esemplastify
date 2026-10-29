import type { Env, Source } from './types';
// Editorial defaults, not a claim that every feed is available. Health is recorded on every attempt.
export const SOURCES: Source[] = [
  {id:'arxiv-ai',name:'arXiv AI',url:'https://rss.arxiv.org/rss/cs.AI',publisher:'arxiv',category:'science',region:'global',primary_source:1,aiOnly:true},
  {id:'huggingface',name:'Hugging Face',url:'https://huggingface.co/blog/feed.xml',publisher:'huggingface',category:'open-source',region:'global',primary_source:1,aiOnly:true},
  {id:'google-research',name:'Google Research',url:'https://research.google/blog/rss/',publisher:'alphabet',category:'science',region:'US',primary_source:1},
  {id:'deepmind',name:'Google DeepMind',url:'https://deepmind.google/blog/rss.xml',publisher:'alphabet',category:'science',region:'UK',primary_source:1,aiOnly:true},
  {id:'mit',name:'MIT News AI',url:'https://news.mit.edu/rss/topic/artificial-intelligence2',publisher:'mit',category:'science',region:'US',primary_source:1,aiOnly:true},
  {id:'nist',name:'NIST',url:'https://www.nist.gov/news-events/news/rss.xml',publisher:'nist',category:'policy',region:'US',primary_source:1},
  {id:'guardian',name:'The Guardian AI',url:'https://www.theguardian.com/technology/artificialintelligenceai/rss',publisher:'guardian',category:'society',region:'UK',primary_source:0,aiOnly:true},
  {id:'techcrunch',name:'TechCrunch AI',url:'https://techcrunch.com/category/artificial-intelligence/feed/',publisher:'techcrunch',category:'industry',region:'US',primary_source:0,aiOnly:true},
  {id:'ars',name:'Ars Technica',url:'https://feeds.arstechnica.com/arstechnica/index',publisher:'ars',category:'technology',region:'US',primary_source:0},
  {id:'restofworld',name:'Rest of World',url:'https://restofworld.org/feed/',publisher:'restofworld',category:'society',region:'global-south',primary_source:0},
  {id:'conversation',name:'The Conversation',url:'https://theconversation.com/global/articles.atom',publisher:'conversation',category:'society',region:'global',primary_source:0},
];
export async function seedSources(env: Env) {
  await env.DB.batch(SOURCES.map(s => env.DB.prepare('INSERT INTO sources (id,name,url,publisher,category,region,primary_source) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,publisher=excluded.publisher,category=excluded.category,region=excluded.region,primary_source=excluded.primary_source').bind(s.id,s.name,s.url,s.publisher,s.category,s.region,s.primary_source)));
}
export const relevant = (s: Source, text: string) => !!s.aiOnly || /\b(artificial intelligence|AI|LLM|machine learning|neural network|generative|chatgpt|deepmind|anthropic|openai|robotics)\b/i.test(text);
