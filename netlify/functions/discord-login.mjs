import crypto from 'node:crypto';
import { makeCookie } from './_shared.mjs';
export default async (event) => {
  const { DISCORD_CLIENT_ID, SITE_URL } = process.env; if (!DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.SESSION_SECRET) return { statusCode:500, body:'Discord OAuth is not configured.' };
  const state=crypto.randomBytes(24).toString('base64url'); const redirect=`${(SITE_URL || 'https://flowstate-dev.netlify.app').replace(/\/$/,'')}/.netlify/functions/discord-callback`;
  const url=new URL('https://discord.com/oauth2/authorize'); url.searchParams.set('client_id',DISCORD_CLIENT_ID); url.searchParams.set('redirect_uri',redirect); url.searchParams.set('response_type','code'); url.searchParams.set('scope','identify email'); url.searchParams.set('state',state);
  return { statusCode:302, headers:{ Location:url.toString(), 'Set-Cookie':makeCookie('flowstate_oauth_state',state,600), 'cache-control':'no-store' }, body:'' };
};
