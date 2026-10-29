// Broad subject labels are editorial heuristics, not an AI model or a claim of verified facts.
export const DOMAINS=['world','science','nature','design','culture','history','ideas','economy','health','life','technology'] as const;
export type Domain=typeof DOMAINS[number];
export function isAIStory(title:string,summary='') {
  const text=title.replace(/\bAi Weiwei\b/gi,'');
  const terms=/\b(artificial intelligence|machine learning|large language models?|LLMs?|ChatGPT|OpenAI|Anthropic|DeepMind|generative AI)\b/i;
  return /\bAI\b/.test(text)||terms.test(text)||/\bai[- ](?:generated|models?|agents?|tools?|systems?|powered)\b/i.test(text)||terms.test(summary.slice(0,500));
}
export function domainFor(title:string,fallback:string):Domain {
  const rules:[Domain,RegExp][]=[
    ['design',/\b(architect(?:ure|ural|s)?|furniture|cabinet(?:ry|s)?|craft(?:s|smanship)?|typography|woodwork(?:ing)?|design(?:er|ers|s)?|construction|ceramics?|textiles?|reading kiosk)\b/i],
    ['history',/\b(archaeolog\w*|ancient|medieval|histor\w*|fossils?|dinosaur\w*|renaissance|gulliver|centur(?:y|ies)|antiqu\w*)\b/i],
    ['culture',/\b(artists?|paintings?|sculptur\w*|music|theat(?:re|er)|cinema|films?|literature|novels?|poetry|danc(?:e|ing)|exhibition|art[- ]filled)\b/i],
    ['nature',/\b(climate|wildfires?|ecosystems?|species|orangutans?|coral|biodiversity|drought|rivers?|forests?|spiders?|birds?|whales?|oceans?|wildlife|conservation)\b/i],
    ['health',/\b(medic(?:al|ine)|health|clinical|disease|cancer|vaccin\w*|surger\w*|prosthetic|aging|mental health|ferritin)\b/i],
    ['economy',/\b(inflation|econom(?:y|ic|ics)|tariffs?|wages?|interest rates?|central bank|employment|trade deal|pensions?)\b/i],
    ['science',/\b(physics|quantum|mathematic\w*|black holes?|telescope\w*|astronom\w*|galax\w*|spacecraft|jupiter|chemistry|embryonic|magnetic|klein bottle)\b/i],
    ['ideas',/\b(philosoph\w*|ethics|consciousness|free will|freedom|education|learning)\b/i],
    ['life',/\b(cooking|recipes?|gardening|repairing|habits?|friendship|sleep|paperwork|organizing|parenting)\b/i],
    ['world',/\b(elections?|parliament|ceasefire|refugees?|diplomacy|geopolitic\w*|sanctions?)\b/i],
  ];
  for(const [domain,pattern] of rules)if(pattern.test(title))return domain;
  if(isAIStory(title))return 'technology';
  if((DOMAINS as readonly string[]).includes(fallback))return fallback as Domain;
  return ({policy:'world',society:'world',industry:'technology','open-source':'technology'} as Record<string,Domain>)[fallback]??'ideas';
}
