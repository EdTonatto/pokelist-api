import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { env } from './config.js';
import { hashToken,newToken,accessToken,verifyAccess,publicUser } from './security.js';
import { catalog } from './catalog.js';
import { sendLink } from './mail.js';
import { closeCache } from './cache.js';
import { operationEvent, safePath } from './logging.js';

const app=Fastify({
 logger: {
  level: env.LOG_LEVEL,
  redact: {
   paths: ['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]',
    'password','token','accessToken','refreshToken','DATABASE_URL','REDIS_URL'],
   censor: '[REDACTED]'
  }
 },
 disableRequestLogging: true,
 trustProxy: true
});
app.addHook('onResponse', async (req, reply) => {
 const route = req.routeOptions.url ?? safePath(req.url);
 const event = operationEvent(req.method,route,reply.statusCode);
 const fields = {event: event ?? 'http.request', method:req.method,route:safePath(route),
  statusCode:reply.statusCode,durationMs:Math.round(reply.elapsedTime),requestId:req.id};
 if(reply.statusCode >= 500) req.log.error(fields,'request failed');
 else if(reply.statusCode >= 400) req.log.warn(fields,'request rejected');
 else if(event) req.log.info(fields,'operation completed');
 else req.log.debug(fields,'request completed');
});
app.addHook('onError', async (req, _reply, error) => {
 req.log.error({event:'http.error',route:safePath(req.routeOptions.url ?? req.url),method:req.method,
  errorType:error.name,statusCode:error.statusCode ?? 500,requestId:req.id},'request error');
});
await app.register(helmet);
await app.register(cors,{origin:env.CORS_ORIGIN,credentials:true});
await app.register(cookie);
await app.register(rateLimit,{max:100,timeWindow:'1 minute'});
app.setErrorHandler((error,request,reply)=>{
 if(error instanceof ZodError)return reply.status(400).send({error:'VALIDATION_ERROR',issues:error.issues});
 const failure = error as Error & {statusCode?: number};
 const status=Number(failure.statusCode)||500;
 // Error details may include upstream payloads or secrets. The onError hook logs only safe metadata.
 return reply.status(status).send({error:status>=500?'INTERNAL_ERROR':failure.message});
});
const body=<T extends z.ZodTypeAny>(schema:T,req:FastifyRequest):z.infer<T>=>schema.parse(req.body);
const emailSchema=z.email().transform(v=>v.trim().toLowerCase());
const signup=z.object({email:emailSchema,password:z.string().min(12).max(128),displayName:z.string().trim().min(1).max(100)});
const credentials=z.object({email:emailSchema,password:z.string()});
const uuid=z.uuid();
const toDate=(ms:number)=>new Date(Date.now()+ms);
const cookieName='pokelist_refresh';
const cookieOptions={httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'none' as const,path:'/api/v1/auth',maxAge:30*24*3600};
function assertOrigin(req:FastifyRequest){
 const origin=req.headers.origin;
 if(origin!==env.CORS_ORIGIN)throw Object.assign(new Error('Invalid request origin'),{statusCode:403});
}
async function currentUser(req:FastifyRequest){
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!token)throw Object.assign(new Error('Unauthorized'),{statusCode:401});
 try {
  const id=await verifyAccess(token);
  const user=await db.user.findUnique({where:{id}});
  if(!user)throw new Error();
  return user;
 }catch {throw Object.assign(new Error('Unauthorized'),{statusCode:401});}
}
async function session(userId:string,reply:any){
 const token=newToken();
 await db.session.create({data:{userId,tokenHash:hashToken(token),expiresAt:toDate(30*86400000)}});
 reply.setCookie(cookieName,token,cookieOptions);
 return accessToken(userId);
}
async function createOneTime(userId:string,purpose:string,ttl:number){
 const token=newToken();
 await db.oneTimeToken.create({data:{userId,purpose,tokenHash:hashToken(token),expiresAt:toDate(ttl)}});
 return token;
}
async function consumeOneTime(token:string,purpose:string){
 const record=await db.oneTimeToken.findUnique({where:{tokenHash:hashToken(token)}});
 if(!record||record.purpose!==purpose||record.consumedAt||record.expiresAt<new Date())throw Object.assign(new Error('Invalid or expired token'),{statusCode:400});
 const update=await db.oneTimeToken.updateMany({where:{id:record.id,consumedAt:null},data:{consumedAt:new Date()}});
 if(update.count!==1)throw Object.assign(new Error('Token already used'),{statusCode:400});
 return record.userId;
}
app.get('/health',async()=>({status:'ok'}));
app.get('/ready',async()=>{await db.$queryRaw`SELECT 1`;return {status:'ready'};});

app.post('/api/v1/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
 const data=body(signup,req);
 if(await db.user.findUnique({where:{email:data.email}}))return reply.code(409).send({error:'EMAIL_ALREADY_REGISTERED'});
 const user=await db.user.create({
  data:{email:data.email,passwordHash:await argon2.hash(data.password),displayName:data.displayName,
   emailVerifiedAt:new Date(),
   memberships:{create:{role:'OWNER',space:{create:{name:'Meu espaço'}}}}}
 });
 return reply.code(201).send({message:'Account created',accessToken:await session(user.id,reply),user:publicUser(user)});
});
app.post('/api/v1/auth/verify-email',async(req,reply)=>{
 if(env.NODE_ENV==='production')return reply.code(410).send({error:'EMAIL_VERIFICATION_DISABLED'});
 const {token}=body(z.object({token:z.string().min(20)}),req);
 const userId=await consumeOneTime(token,'verify');
 await db.$transaction([
  db.user.update({where:{id:userId},data:{emailVerifiedAt:new Date()}}),
  db.space.create({data:{name:'Meu espaço',members:{create:{userId,role:'OWNER'}}}})
 ]);
 return {message:'Email verified'};
});
app.post('/api/v1/auth/resend-verification',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(req,reply)=>{
 if(env.NODE_ENV==='production')return reply.code(410).send({error:'EMAIL_VERIFICATION_DISABLED'});
 const {email}=body(z.object({email:emailSchema}),req);
 const user=await db.user.findUnique({where:{email}});
 if(user&&!user.emailVerifiedAt){
  const token=await createOneTime(user.id,'verify',86400000);
  await sendLink(email,'Confirme seu e-mail no PokeList','verify-email',token);
 }
 return {message:'If eligible, a verification email was sent'};
});
app.post('/api/v1/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
 const {email,password}=body(credentials,req);
 const user=await db.user.findUnique({where:{email}});
 if(!user||!(await argon2.verify(user.passwordHash,password)))return reply.code(401).send({error:'INVALID_CREDENTIALS'});
 // Previously registered users may not have a space because verification never completed.
 if(!(await db.spaceMember.findFirst({where:{userId:user.id}}))) {
  await db.space.create({data:{name:'Meu espaço',members:{create:{userId:user.id,role:'OWNER'}}}});
 }
 return {accessToken:await session(user.id,reply),user:publicUser(user)};
});
app.post('/api/v1/auth/refresh',async(req,reply)=>{
 assertOrigin(req);
 const token=req.cookies[cookieName];
 const existing=token?await db.session.findUnique({where:{tokenHash:hashToken(token)}}):null;
 if(!existing||existing.revokedAt||existing.expiresAt<new Date())return reply.code(401).send({error:'UNAUTHORIZED'});
 const changed=await db.session.updateMany({where:{id:existing.id,revokedAt:null},data:{revokedAt:new Date()}});
 if(changed.count!==1)return reply.code(401).send({error:'UNAUTHORIZED'});
 const user=await db.user.findUnique({where:{id:existing.userId}});
 if(!user)return reply.code(401).send({error:'UNAUTHORIZED'});
 return {accessToken:await session(user.id,reply),user:publicUser(user)};
});
app.post('/api/v1/auth/logout',async(req,reply)=>{
 assertOrigin(req);
 const token=req.cookies[cookieName];
 if(token)await db.session.updateMany({where:{tokenHash:hashToken(token)},data:{revokedAt:new Date()}});
 reply.clearCookie(cookieName,{path:'/api/v1/auth'});
 return {message:'Logged out'};
});
app.post('/api/v1/auth/forgot-password',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(req)=>{
 const {email}=body(z.object({email:emailSchema}),req);
 const user=await db.user.findUnique({where:{email}});
 if(user){
  const token=await createOneTime(user.id,'reset',30*60000);
  await sendLink(email,'Redefinir senha PokeList','reset-password',token);
 }
 return {message:'If registered, a password reset email was sent'};
});
app.post('/api/v1/auth/reset-password',async(req)=>{
 const {token,password}=body(z.object({token:z.string().min(20),password:z.string().min(12).max(128)}),req);
 const userId=await consumeOneTime(token,'reset');
 await db.$transaction([
  db.user.update({where:{id:userId},data:{passwordHash:await argon2.hash(password)}}),
  db.session.updateMany({where:{userId,revokedAt:null},data:{revokedAt:new Date()}})
 ]);
 return {message:'Password updated'};
});
app.get('/api/v1/auth/me',async req=>publicUser(await currentUser(req)));
app.get('/api/v1/users/me',async req=>publicUser(await currentUser(req)));
app.patch('/api/v1/users/me',async req=>{
 const user=await currentUser(req);
 const {displayName}=body(z.object({displayName:z.string().trim().min(1).max(100)}),req);
 return publicUser(await db.user.update({where:{id:user.id},data:{displayName}}));
});
async function membership(userId:string,spaceId:string){
 const member=await db.spaceMember.findUnique({where:{spaceId_userId:{spaceId,userId}}});
 if(!member)throw Object.assign(new Error('Not found'),{statusCode:404});
 return member;
}
function canEdit(role:string){if(role==='VIEWER')throw Object.assign(new Error('Forbidden'),{statusCode:403});}
async function loadList(userId:string,id:string,edit=false){
 const list=await db.wishlist.findUnique({where:{id}});
 if(!list)throw Object.assign(new Error('Not found'),{statusCode:404});
 const member=await membership(userId,list.spaceId);
 if(edit)canEdit(member.role);
 return list;
}
app.get('/api/v1/spaces',async req=>{
 const user=await currentUser(req);
 return db.space.findMany({where:{members:{some:{userId:user.id}}},include:{members:{select:{userId:true,role:true}}}});
});
app.post('/api/v1/spaces',async(req,reply)=>{
 const user=await currentUser(req);
 const {name}=body(z.object({name:z.string().trim().min(1).max(100)}),req);
 return reply.code(201).send(await db.space.create({data:{name,members:{create:{userId:user.id,role:'OWNER'}}}}));
});
app.get('/api/v1/spaces/:id/members',async req=>{
 const user=await currentUser(req);
 const id=uuid.parse((req.params as any).id);
 await membership(user.id,id);
 return db.spaceMember.findMany({where:{spaceId:id},include:{user:{select:{id:true,displayName:true,email:true}}}});
});
const listInput=z.object({spaceId:uuid,name:z.string().trim().min(1).max(120),description:z.string().max(1000).optional(),type:z.enum(['COLLECTION','POKEMON','CUSTOM']).default('CUSTOM'),setId:z.string().optional(),pokemonName:z.string().optional()});
app.get('/api/v1/wishlists',async req=>{
 const user=await currentUser(req);
 return db.wishlist.findMany({where:{space:{members:{some:{userId:user.id}}}},include:{_count:{select:{items:true}}},orderBy:{updatedAt:'desc'}});
});
app.post('/api/v1/wishlists',async(req,reply)=>{
 const user=await currentUser(req), input=body(listInput,req);
 canEdit((await membership(user.id,input.spaceId)).role);
 return reply.code(201).send(await db.wishlist.create({data:{...input,createdBy:user.id}}));
});
app.get('/api/v1/wishlists/:id',async req=>{
 const user=await currentUser(req),id=uuid.parse((req.params as any).id);
 await loadList(user.id,id);
 return db.wishlist.findUnique({where:{id},include:{items:{orderBy:{createdAt:'desc'}}}});
});
app.patch('/api/v1/wishlists/:id',async req=>{
 const user=await currentUser(req),id=uuid.parse((req.params as any).id);
 await loadList(user.id,id,true);
 const data=body(listInput.omit({spaceId:true}).partial(),req);
 return db.wishlist.update({where:{id},data});
});
app.delete('/api/v1/wishlists/:id',async req=>{
 const user=await currentUser(req),id=uuid.parse((req.params as any).id);
 await loadList(user.id,id,true);
 await db.wishlist.delete({where:{id}});return {deleted:true};
});
const itemSchema=z.object({provider:z.literal('tcgdex').default('tcgdex'),providerCardId:z.string().min(1),cardName:z.string().min(1),localId:z.string().min(1),setId:z.string().min(1),setName:z.string().min(1),setOfficialTotal:z.number().int().positive().nullable().optional(),imageUrl:z.url().nullable().optional(),language:z.string().default('pt-br'),notes:z.string().max(1000).optional()});
app.post('/api/v1/wishlists/:id/items',async(req,reply)=>{
 const user=await currentUser(req),id=uuid.parse((req.params as any).id);
 await loadList(user.id,id,true);
 const data=body(itemSchema,req);
 return reply.code(201).send(await db.wishlistItem.create({data:{...data,wishlistId:id,addedBy:user.id}}));
});
app.post('/api/v1/wishlists/:id/items/bulk',async(req,reply)=>{
 const user=await currentUser(req),id=uuid.parse((req.params as any).id);
 await loadList(user.id,id,true);
 const items=body(z.object({items:z.array(itemSchema).min(1).max(200)}),req).items;
 const result=await db.wishlistItem.createMany({data:items.map(data=>({...data,wishlistId:id,addedBy:user.id})),skipDuplicates:true});
 return reply.code(201).send({created:result.count});
});
app.patch('/api/v1/wishlists/:id/items/:itemId',async req=>{
 const user=await currentUser(req),p=req.params as any,id=uuid.parse(p.id),itemId=uuid.parse(p.itemId);
 await loadList(user.id,id,true);
 const item=await db.wishlistItem.findFirst({where:{id:itemId,wishlistId:id}});
 if(!item)throw Object.assign(new Error('Not found'),{statusCode:404});
 const {status,notes}=body(z.object({status:z.enum(['WANTED','ACQUIRED']).optional(),notes:z.string().max(1000).nullable().optional()}),req);
 return db.wishlistItem.update({where:{id:itemId},data:{status,notes,acquiredAt:status==='ACQUIRED'?new Date():status==='WANTED'?null:undefined}});
});
app.delete('/api/v1/wishlists/:id/items/:itemId',async req=>{
 const user=await currentUser(req),p=req.params as any,id=uuid.parse(p.id),itemId=uuid.parse(p.itemId);
 await loadList(user.id,id,true);
 const removed=await db.wishlistItem.deleteMany({where:{id:itemId,wishlistId:id}});
 if(!removed.count)throw Object.assign(new Error('Not found'),{statusCode:404});
 return {deleted:true};
});
app.get('/api/v1/cards',async req=>{
 const {name,language,page}=z.object({name:z.string().trim().min(1).max(120),language:z.enum(['pt-br','en']).default('pt-br'),page:z.coerce.number().int().min(1).default(1)}).parse(req.query);
 return catalog.search(name,language,page);
});
app.get('/api/v1/cards/printed-number',async req=>{
 const {localId,total,language}=z.object({localId:z.string().min(1).max(10),total:z.coerce.number().int().positive(),language:z.enum(['pt-br','en']).default('pt-br')}).parse(req.query);
 return catalog.byNumber(localId,total,language);
});
app.get('/api/v1/cards/:id',async req=>{
 const {id}=z.object({id:z.string().min(1)}).parse(req.params);
 const {language}=z.object({language:z.enum(['pt-br','en']).default('pt-br')}).parse(req.query);
 return catalog.card(id,language);
});
app.get('/api/v1/sets',async req=>{
 const {language}=z.object({language:z.enum(['pt-br','en']).default('pt-br')}).parse(req.query);
 return catalog.sets(language);
});
app.get('/api/v1/sets/:id',async req=>{
 const {id}=z.object({id:z.string().min(1)}).parse(req.params);
 const {language}=z.object({language:z.enum(['pt-br','en']).default('pt-br')}).parse(req.query);
 return catalog.set(id,language);
});
app.get('/api/v1/sets/:id/cards',async req=>{
 const {id}=z.object({id:z.string().min(1)}).parse(req.params);
 const {language}=z.object({language:z.enum(['pt-br','en']).default('pt-br')}).parse(req.query);
 const set=await catalog.set(id,language) as any;
 return set.cards??[];
});
async function shutdown(){await app.close();await db.$disconnect();await closeCache();}
process.once('SIGINT',()=>void shutdown());
process.once('SIGTERM',()=>void shutdown());
try {await app.listen({port:env.PORT,host:'0.0.0.0'});}
catch(error){app.log.error(error);process.exit(1);}
