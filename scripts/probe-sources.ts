import { SOURCES, relevant } from '../src/sources';
import { parseFeed } from '../src/feed';
import { boundedText } from '../src/ingest';
const results=await Promise.all(SOURCES.map(async source=>{
  try {
    const response=await fetch(source.url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Esemplastify/0.1 RSS verification'}});
    if(!response.ok)return {id:source.id,status:response.status,error:'HTTP failure'};
    const items=parseFeed(await boundedText(response),source.url);
    return {id:source.id,status:response.status,items:items.length,relevant:items.filter(i=>relevant(source,`${i.title} ${i.summary}`)).length,newest:items[0]?.publishedAt??null};
  }catch(e){return {id:source.id,status:0,error:e instanceof Error?e.message:'Unknown failure'};}
}));
console.log(JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
