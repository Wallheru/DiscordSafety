import crypto from 'node:crypto';
import { makeCookie } from './_shared.mjs';

export default async function discordLogin(_request) {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, SITE_URL } = process.env;

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !SESSION_SECRET) {
    return new Response('Discord OAuth is not configured.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const redirectUri = `${(SITE_URL || 'https://flowstate-dev.netlify.app').replace(/\/$/, '')}/.netlify/functions/discord-callback`;

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify email');
  authorizeUrl.searchParams.set('state', state);

  const headers = new Headers();
  headers.set('Location', authorizeUrl.toString());
  headers.set('Set-Cookie', makeCookie('flowstate_oauth_state', state, 600));
  headers.set('Cache-Control', 'no-store');

  return new Response(null, { status: 302, headers });
}
