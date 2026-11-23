import Stripe from 'stripe';
import crypto from 'node:crypto';
import { store } from './_shared.mjs';
const TEAM_LINK_URLS = new Set(['https://buy.stripe.com/test_00wbIUefccpD9i321Bd7q01', 'https://buy.stripe.com/test_28E7sE9YWdtHfGr9u3d7q00']);
function verifyTeamReference(value) {
  if(typeof value!=='string') return null;
  const split=value.lastIndexOf('.'); if(split<1) return null;
  const userId=value.slice(0,split), supplied=Buffer.from(value.slice(split+1));
  if(!/^[0-9]{5,30}$/.test(userId) || !process.env.SESSION_SECRET) return null;
  const expected=Buffer.from(crypto.createHmac('sha256',process.env.SESSION_SECRET).update(`team-checkout:${userId}`).digest('base64url'));
  return supplied.length===expected.length && crypto.timingSafeEqual(supplied,expected) ? userId : null;
}
export default async event => {
  if(event.httpMethod!=='POST') return {statusCode:405,body:'Method not allowed'};
  if(!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return {statusCode:503,body:'Stripe webhook not configured'};
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):(event.body || ''); let evt;
  try{evt=stripe.webhooks.constructEvent(raw,event.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch(err){return {statusCode:400,body:`Webhook signature invalid: ${err.message}`}}
  const obj=evt.data.object;
  if(evt.type==='checkout.session.completed' && obj.mode==='subscription') {
    let userId=obj.metadata?.discord_user_id || obj.client_reference_id;
    let plan=obj.metadata?.plan || 'pro';
    if(obj.payment_link) {
      try { const paymentLink=await stripe.paymentLinks.retrieve(obj.payment_link); if(TEAM_LINK_URLS.has(paymentLink.url)) { userId=verifyTeamReference(obj.client_reference_id); plan='team'; } } catch(err) { console.error('Could not verify Payment Link:',err); userId=null; }
    }
    if(userId && obj.subscription) {
      const sub=await stripe.subscriptions.retrieve(obj.subscription);
      await stripe.subscriptions.update(sub.id,{metadata:{discord_user_id:userId,plan}});
      await store.setJSON(`subscription:${userId}`,{plan,status:sub.status,subscription_id:sub.id,customer_id:obj.customer,current_period_end:sub.current_period_end});
      if(plan==='team' && ['active','trialing'].includes(sub.status)) {
        const teamId=`team_${userId}`;
        const existing=await store.get(`team:${teamId}`,{type:'json'});
        if(!existing) await store.setJSON(`team:${teamId}`,{id:teamId,name:'Flowstate Team',ownerId:userId,members:{[userId]:{role:'owner',joinedAt:Date.now()}},createdAt:Date.now()});
        await store.set(`teamMembership:${userId}`,teamId);
      }
    }
  }
  if(evt.type==='customer.subscription.updated' || evt.type==='customer.subscription.deleted') {
    const userId=obj.metadata?.discord_user_id;
    if(userId) {
      await store.setJSON(`subscription:${userId}`,{plan:obj.metadata?.plan || 'pro',status:obj.status,subscription_id:obj.id,customer_id:obj.customer,current_period_end:obj.current_period_end});
      if(obj.metadata?.plan==='team' && !['active','trialing'].includes(obj.status)) {
        const teamId=await store.get(`teamMembership:${userId}`);
        if(teamId) { const team=await store.get(`team:${teamId}`,{type:'json'}); if(team) {team.status='suspended'; await store.setJSON(`team:${teamId}`,team);} }
      }
      if(obj.metadata?.plan==='team' && ['active','trialing'].includes(obj.status)) {
        const teamId=`team_${userId}`; let team=await store.get(`team:${teamId}`,{type:'json'});
        if(!team) team={id:teamId,name:'Flowstate Team',ownerId:userId,members:{[userId]:{role:'owner',joinedAt:Date.now()}},createdAt:Date.now()};
        team.status='active'; await store.setJSON(`team:${teamId}`,team); await store.set(`teamMembership:${userId}`,teamId);
      }
    }
  }
  return {statusCode:200,body:JSON.stringify({received:true})};
};
