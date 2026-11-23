import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
export const store = getStore({ name: 'flowstate-secure-data', consistency: 'strong' });
export const json = (statusCode, data, headers={}) => ({ statusCode, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }, body: JSON.stringify(data) });
export function sign(value) { return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('base64url'); }
export function makeCookie(name, value, maxAge) { return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`; }
export function cookieMap(event) { return Object.fromEntries((event.headers.cookie || '').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]})); }
export async function getSession(event) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return null;
  const raw = cookieMap(event).flowstate_session; if (!raw) return null;
  const i=raw.lastIndexOf('.'); if(i<1) return null; const payload=raw.slice(0,i), mac=raw.slice(i+1);
  const expected=sign(payload); const a=Buffer.from(mac), b=Buffer.from(expected); if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  try { const session=JSON.parse(Buffer.from(payload,'base64url').toString()); return session.exp>Date.now() ? session : null; } catch { return null; }
}
export function sessionCookie(user) { const payload=Buffer.from(JSON.stringify({ id:user.id, username:user.username, avatar:user.avatar || null, exp:Date.now()+7*24*60*60*1000 })).toString('base64url'); const value=`${payload}.${sign(payload)}`; return makeCookie('flowstate_session',value,7*24*60*60); }
export async function subscriptionFor(userId) { return await store.get(`subscription:${userId}`, { type:'json' }) || null; }
export function activePlan(sub) { if (!sub || !['active','trialing'].includes(sub.status)) return 'starter'; return sub.plan === 'team' ? 'team' : 'pro'; }
