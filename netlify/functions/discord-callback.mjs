import { cookieMap, sessionCookie } from './_shared.mjs';

export default async function discordCallback(request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const cookies = cookieMap(request);

  if (!code || !state || !cookies.flowstate_oauth_state ||
      state !== cookies.flowstate_oauth_state) {
    return new Response('Invalid OAuth state. Please try signing in again.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  const redirectUri = `${(process.env.SITE_URL || 'https://flowstate-dev.netlify.app').replace(/\/$/, '')}/.netlify/functions/discord-callback`;
  const form = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  });

  if (!tokenResponse.ok) {
    return new Response('Discord sign-in failed. Try again.', { status: 502 });
  }

  const token = await tokenResponse.json();
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${token.access_token}` }
  });

  if (!userResponse.ok) {
    return new Response('Could not read your Discord account.', { status: 502 });
  }

  const user = await userResponse.json();
  const headers = new Headers();
  headers.set('Location', '/');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', sessionCookie(user));
  headers.append('Set-Cookie', 'flowstate_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');

  return new Response(null, { status: 302, headers });
}
