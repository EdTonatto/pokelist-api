import { env } from './config.js';

/** Never log raw URLs, query strings, request bodies, headers or cache keys. */
export function safePath(input: string): string {
 return input.split(/[?#]/,1)[0] ?? '/';
}
const events: Record<string,string> = {
 'POST /api/v1/auth/register':'auth.register',
 'POST /api/v1/auth/login':'auth.login',
 'POST /api/v1/auth/verify-email':'auth.verify_email',
 'POST /api/v1/auth/resend-verification':'auth.resend_verification',
 'POST /api/v1/auth/refresh':'auth.refresh',
 'POST /api/v1/auth/logout':'auth.logout',
 'POST /api/v1/auth/forgot-password':'auth.forgot_password',
 'POST /api/v1/auth/reset-password':'auth.reset_password',
 'PATCH /api/v1/users/me':'user.update',
 'POST /api/v1/spaces':'space.create',
 'POST /api/v1/wishlists':'wishlist.create',
 'PATCH /api/v1/wishlists/:id':'wishlist.update',
 'DELETE /api/v1/wishlists/:id':'wishlist.delete',
 'POST /api/v1/wishlists/:id/items':'wishlist_item.create',
 'POST /api/v1/wishlists/:id/items/bulk':'wishlist_item.create_bulk',
 'PATCH /api/v1/wishlists/:id/items/:itemId':'wishlist_item.update',
 'DELETE /api/v1/wishlists/:id/items/:itemId':'wishlist_item.delete',
 'GET /api/v1/cards':'catalog.search',
 'GET /api/v1/cards/printed-number':'catalog.number_search',
 'GET /api/v1/cards/:id':'catalog.card',
 'GET /api/v1/sets':'catalog.sets',
 'GET /api/v1/sets/:id':'catalog.set',
 'GET /api/v1/sets/:id/cards':'catalog.set_cards'
};
export function operationEvent(method:string,route:string,statusCode:number):string|null {
 const key=method.toUpperCase()+' '+safePath(route);
 const event=events[key];
 if(!event)return null;
 return event+(statusCode>=400?'.failed':'.succeeded');
}
/** Cache keys can contain encoded search terms. Log category only. */
export function cacheCategory(key:string):string {
 const type=key.split(':')[3] ?? 'unknown';
 return /^[a-z_]+$/.test(type)?type:'unknown';
}
export function logCache(outcome:string,key?:string):void {
 if(env.LOG_LEVEL!=='debug' && env.LOG_LEVEL!=='trace') {
  if(outcome==='read_failed'||outcome==='write_failed'||outcome==='connection_error') {
   console.warn(JSON.stringify({event:'cache.'+outcome,category:key?cacheCategory(key):'connection'}));
  }
  return;
 }
 console.debug(JSON.stringify({event:'cache.'+outcome,category:key?cacheCategory(key):'connection'}));
}
