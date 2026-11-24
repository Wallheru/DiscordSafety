import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const store = getStore({ name: 'flowstate-secure-data', consistency: 'strong' });

export const json = (statusCode, data, headers = {}) => new Response(
  JSON.stringify(data),
  {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  }
);

export function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('base64url');
}

export function makeCookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function cookieMap(request) {
  const cookieHeader = typeof request?.headers?.get === 'function'
    ? request.headers.get('cookie')
    : request?.headers?.cookie;

  return Object.fromEntries(
    (cookieHeader || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        return [part.slice(0, index), part.slice(index + 1)];
      })
  );
}

export async function getSession(request) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return null;

  const raw = cookieMap(request).flowstate_session;
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator < 1) return null;

  const payload = raw.slice(0, separator);
  const mac = raw.slice(separator + 1);
  const expected = sign(payload);
  const suppliedBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);

  if (suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString('base64url');

  return makeCookie('flowstate_session', `${payload}.${sign(payload)}`, 7 * 24 * 60 * 60);
}

export async function subscriptionFor(userId) {
  return await store.get(`subscription:${userId}`, { type: 'json' }) || null;
}

export function activePlan(sub) {
  if (!sub || !['active', 'trialing'].includes(sub.status)) return 'starter';
  return sub.plan === 'team' ? 'team' : 'pro';
}
