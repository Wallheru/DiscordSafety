import { json, getSession, store } from './_shared.mjs';
const MAX_BYTES=2*1024*1024;
export default async event=>{
 const user=await getSession(event); if(!user)return json(401,{error:'Sign in first.'});
 const teamId=await store.get(`teamMembership:${user.id}`); if(!teamId)return json(403,{error:'Join a Team workspace to use shared workflows.'});
 const team=await store.get(`team:${teamId}`,{type:'json'}); if(!team||team.status==='suspended')return json(403,{error:'This Team workspace is not active.'});
 const key=`teamWorkflows:${teamId}`;
 if(event.httpMethod==='GET')return json(200,{workflows:await store.get(key,{type:'json'})||[],team:{id:team.id,name:team.name}});
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 const role=team.members?.[user.id]?.role; if(!role)return json(403,{error:'You are not a member of this team.'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid JSON'});}
 if(!Array.isArray(body.workflows))return json(400,{error:'Expected workflows array.'});
 const ids=new Set();for(const item of body.workflows){if(!item||typeof item!=='object'||typeof item.id!=='string'||ids.has(item.id)||item.id.length>120)return json(400,{error:'Every shared workflow needs a unique ID.'});ids.add(item.id);}
 const serialized=JSON.stringify(body.workflows);if(Buffer.byteLength(serialized,'utf8')>MAX_BYTES)return json(413,{error:'Team shared workflow storage limit is 2 MB.'});
 const current=await store.get(key,{type:'json'})||[];const merged=new Map(current.map(item=>[item.id,item]));for(const item of body.workflows)merged.set(item.id,item);const next=[...merged.values()];if(Buffer.byteLength(JSON.stringify(next),'utf8')>MAX_BYTES)return json(413,{error:'Team shared workflow storage is full (2 MB).'});await store.setJSON(key,next);return json(200,{ok:true,count:body.workflows.length,total:next.length});
};
