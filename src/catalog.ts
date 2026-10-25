import { env } from './config.js';
import { cached } from './cache.js';
type Json = any;
async function request(path:string,query:Record<string,string>={}):Promise<Json>{
  const url=new URL(env.TCGDEX_BASE_URL.replace(/\/$/,'')+path);
  for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Object.assign(new Error('Catalog upstream unavailable'),{statusCode:502});
  return response.json();
}
function lang(value:string){return value==='en'?'en':'pt-br';}
async function fallback<T>(path:string,language:string,params:Record<string,string>={}):Promise<T>{
  const selected=lang(language);
  try {
    const result=await request('/'+selected+path,params);
    if(Array.isArray(result)&&result.length===0&&selected==='pt-br')return request('/en'+path,params);
    return result;
  }catch(error){if(selected==='pt-br')return request('/en'+path,params);throw error;}
}
function cacheKey(kind:string,parts:unknown){return 'pokelist:v1:tcgdex:'+kind+':'+Buffer.from(JSON.stringify(parts)).toString('base64url');}
export const catalog={
  search:(q:string,language:string,page:number)=>cached(cacheKey('search',{q:q.trim().toLowerCase(),language,page}),21600,()=>fallback('/cards',language,{name:q.trim(),'pagination:page':String(page),'pagination:itemsPerPage':'30'})),
  card:(id:string,language:string)=>cached(cacheKey('card',{id,language}),604800,()=>fallback('/cards/'+encodeURIComponent(id),language)),
  sets:(language:string)=>cached(cacheKey('sets',{language}),86400,()=>fallback('/sets',language)),
  set:(id:string,language:string)=>cached(cacheKey('set',{id,language}),86400,()=>fallback('/sets/'+encodeURIComponent(id),language)),
  async byNumber(localId:string,officialTotal:number,language:string){
    const sets=await this.sets(language) as Json[];
    const candidates=sets.filter(s=>Number(s.cardCount?.official)===officialTotal).slice(0,80);
    const found=await Promise.allSettled(candidates.map(async s=>this.card(s.id+'-'+localId,language)));
    return found.flatMap((f,i)=>f.status==='fulfilled'?[f.value]:[]);
  }
};
