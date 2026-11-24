import crypto from 'node:crypto';
import { json, getSession, subscriptionFor, activePlan, store } from './_shared.mjs';
const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
async function teamFor(userId) { const teamId=await store.get(`teamMembership:${userId}`); if(!teamId) return null; const team=await store.get(`team:${teamId}`,{type:'json'}); return team ? {teamId,team} : null; }
export default async event => {
  const user=await getSession(event); if(!user) return json(401,{error:'Sign in with Discord first.'});
  if(event.httpMethod==='GET') { let found=await teamFor(user.id); if(!found && activePlan(await subscriptionFor(user.id))==='team') { const teamId=`team_${user.id}`; const team={id:teamId,name:'Flowstate Team',ownerId:user.id,members:{[user.id]:{role:'owner',joinedAt:Date.now()}},createdAt:Date.now(),status:'active'}; await store.setJSON(`team:${teamId}`,team); await store.set(`teamMembership:${user.id}`,teamId); found={teamId,team}; } if(!found) return json(200,{team:null}); const members=Object.entries(found.team.members||{}).map(([id,m])=>({id,role:m.role,joinedAt:m.joinedAt})); return json(200,{team:{id:found.team.id,name:found.team.name,ownerId:found.team.ownerId,status:found.team.status||'active',members}}); }
  if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
  let body; try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid JSON'});}
  if(body.action==='create') {
    if(activePlan(await subscriptionFor(user.id))!=='team') return json(403,{error:'An active Team subscription is required to create a workspace.'});
    const existing=await teamFor(user.id); if(existing) return json(200,{team:existing.team});
    const teamId=`team_${user.id}`; const team={id:teamId,name:String(body.name||'Flowstate Team').trim().slice(0,60)||'Flowstate Team',ownerId:user.id,members:{[user.id]:{role:'owner',joinedAt:Date.now()}},createdAt:Date.now(),status:'active'};
    await store.setJSON(`team:${teamId}`,team); await store.set(`teamMembership:${user.id}`,teamId); return json(201,{team});
  }
  if(body.action==='join') {
    const token=String(body.token||''); if(!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return json(400,{error:'Invalid invite link.'});
    const invite=await store.get(`teamInvite:${tokenHash(token)}`,{type:'json'}); if(!invite||invite.expiresAt<Date.now()||invite.uses>=invite.maxUses) return json(410,{error:'This team invite has expired or reached its use limit.'});
    const current=await teamFor(user.id); if(current && current.teamId!==invite.teamId) return json(409,{error:'You already belong to another team. Leave it before joining a different one.'});
    const team=await store.get(`team:${invite.teamId}`,{type:'json'}); if(!team||team.status==='suspended') return json(403,{error:'This team is not active.'});
    team.members=team.members||{}; team.members[user.id]=team.members[user.id]||{role:'member',joinedAt:Date.now()}; invite.uses=(invite.uses||0)+1;
    await store.setJSON(`team:${invite.teamId}`,team); await store.set(`teamMembership:${user.id}`,invite.teamId); await store.setJSON(`teamInvite:${tokenHash(token)}`,invite);
    return json(200,{ok:true,team:{id:team.id,name:team.name}});
  }
  const found=await teamFor(user.id); if(!found) return json(404,{error:'You are not in a team workspace.'});
  const {teamId,team}=found; const myRole=team.members?.[user.id]?.role;
  if(body.action==='invite') {
    if(!['owner','admin'].includes(myRole)) return json(403,{error:'Only team owners and admins can invite members.'});
    const token=crypto.randomBytes(24).toString('base64url'); const maxUses=Math.min(Math.max(Number(body.maxUses)||10,1),50); const invite={teamId,createdBy:user.id,createdAt:Date.now(),expiresAt:Date.now()+7*24*60*60*1000,maxUses,uses:0};
    await store.setJSON(`teamInvite:${tokenHash(token)}`,invite); const base=(process.env.SITE_URL||'https://flowstate-dev.netlify.app').replace(/\/$/,''); return json(201,{url:`${base}/?team_invite=${token}`,expiresAt:invite.expiresAt,maxUses});
  }
  if(body.action==='rename') { if(!['owner','admin'].includes(myRole)) return json(403,{error:'Only owners and admins can rename the workspace.'}); team.name=String(body.name||'').trim().slice(0,60); if(!team.name) return json(400,{error:'Workspace name cannot be empty.'}); await store.setJSON(`team:${teamId}`,team); return json(200,{ok:true,name:team.name}); }
  if(body.action==='role') { if(myRole!=='owner') return json(403,{error:'Only the owner can change member roles.'}); const target=String(body.userId||''); if(target===team.ownerId || !team.members?.[target] || !['admin','member'].includes(body.role)) return json(400,{error:'Invalid member or role.'}); team.members[target].role=body.role; await store.setJSON(`team:${teamId}`,team); return json(200,{ok:true}); }
  if(body.action==='remove') { if(!['owner','admin'].includes(myRole)) return json(403,{error:'Only owners and admins can remove members.'}); const target=String(body.userId||''); if(target===team.ownerId || !team.members?.[target] || (myRole==='admin'&&team.members[target].role==='admin')) return json(400,{error:'Cannot remove this member.'}); delete team.members[target]; await store.delete(`teamMembership:${target}`); await store.setJSON(`team:${teamId}`,team); return json(200,{ok:true}); }
  return json(400,{error:'Unknown team action.'});
};
