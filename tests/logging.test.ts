import { test } from 'node:test';
import assert from 'node:assert/strict';
// Configuration is parsed at module load; use safe values for isolated tests.
process.env.DATABASE_URL ||= 'postgresql://local:local@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret-012345678901234567890123456789';
process.env.FRONTEND_URL ||= 'http://localhost:5173';
process.env.CORS_ORIGIN ||= 'http://localhost:5173';
const {operationEvent,safePath,cacheCategory}=await import('../src/logging.js');
test('request URL redacts query string and hash',()=>{
 assert.equal(safePath('/api/v1/auth/verify-email?token=secret#fragment'),'/api/v1/auth/verify-email');
});
test('operation logger labels auth and list mutations',()=>{
 assert.equal(operationEvent('POST','/api/v1/auth/login',200),'auth.login.succeeded');
 assert.equal(operationEvent('DELETE','/api/v1/wishlists/:id',403),'wishlist.delete.failed');
});
test('does not leak card query in cache event',()=>{
 assert.equal(cacheCategory('pokelist:v1:tcgdex:search:UGlrYWNodQ'),'search');
});
