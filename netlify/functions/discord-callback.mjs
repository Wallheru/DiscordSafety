import { cookieMap, sessionCookie } from './_shared.mjs';
export default async (event) => {
  const params=new URLSearchParams(event.rawQuery || new URLSearchParams(event.queryStringParameters || {}).toString()); const code=params.get('code'), state=params.get('state'); const cookies=cookieMap(event);
  if (!code || !state || !cookies.flowstate_oauth_state || state!==cookies.flowstate_oauth_state) return new Response('Invalid OAuth state. Please try signing in again.', { status: 400 });
  const redirect=`${(process.env.SITE_URL || 'https://flowstate-dev.netlify.app').replace(/\/$/,'')}/.netlify/functions/discord-callback`;
  const form=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:redirect});
  const tokenRes=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); if(!tokenRes.ok) return new Response('Discord sign-in failed. Try again.', { status: 502 }); const token=await tokenRes.json();
  const userRes=await fetch('https://discord.com/api/users/@me',{headers:{authorization:`Bearer ${token.access_token}`}}); if(!userRes.ok) return new Response('Could not read your Discord account.', { status: 502 }); const user=await userRes.json();
  return new Response(null, { status: 302, headers: { Location: '/', 'cache-control':'no-store', 'Set-Cookie': [sessionCookie(user), 'flowstate_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'] } });
};
