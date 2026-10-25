import { randomBytes, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './config.js';
const secret = new TextEncoder().encode(env.JWT_SECRET);
export function newToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export async function accessToken(userId: string) {
  return new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setIssuedAt().setExpirationTime('15m').sign(secret);
}
export async function verifyAccess(token: string) {
  const {payload} = await jwtVerify(token,secret,{algorithms:['HS256']});
  if (!payload.sub) throw new Error('Invalid token');
  return payload.sub;
}
export function publicUser(user: {id:string;email:string;displayName:string;emailVerifiedAt:Date|null}) {
  return {id:user.id,email:user.email,displayName:user.displayName,emailVerified:!!user.emailVerifiedAt};
}
