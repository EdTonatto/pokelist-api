import { Redis } from 'ioredis';
import { env } from './config.js';
import { logCache } from './logging.js';
let redis: Redis | null = null;
if (env.REDIS_URL) {
  redis = new Redis(env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:1500});
  redis.on('error',()=> logCache('connection_error'));
  redis.on('ready',()=> logCache('ready'));

}
export async function cached<T>(key:string,ttlSeconds:number,fn:()=>Promise<T>):Promise<T>{
  try {
    if(redis){if(redis.status==='wait') await redis.connect();const value=await redis.get(key);if(value!==null){logCache('hit',key);return JSON.parse(value) as T;}}
  }catch{logCache('read_failed',key);/* cache outage must not break catalog */}
  logCache('miss',key);
  const data=await fn();
  try {if(redis?.status==='ready') await redis.set(key,JSON.stringify(data),'EX',ttlSeconds);}catch{logCache('write_failed',key);/* best effort */}
  return data;
}
export async function closeCache(){if(redis) redis.disconnect();}
