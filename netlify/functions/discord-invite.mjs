import { json, store } from './_shared.mjs';
export default async event => {
  if(event.httpMethod==='GET'){const item=await store.get('discord:invite',{type:'json'}); return item?.url ? json(200,{url:item.url}) : json(404,{error:'Discord invite has not been published yet.'});}
  if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
  const expected=process.env.INVITE_SYNC_SECRET, supplied=event.headers['x-flowstate-secret']; if(!expected || !supplied || supplied!==expected) return json(401,{error:'Unauthorized'});
  let body; try{body=JSON.parse(event.body || '{}')}catch{return json(400,{error:'Invalid JSON'});} const url=String(body.url || ''); if(!/^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]+$/.test(url)) return json(400,{error:'Invalid Discord invite URL.'});
  await store.setJSON('discord:invite',{url,updated_at:new Date().toISOString()}); return json(200,{ok:true});
};
