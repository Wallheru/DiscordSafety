import Stripe from 'stripe';
import crypto from 'node:crypto';
import { json, getSession } from './_shared.mjs';
const TEAM_LINKS = { monthly: 'https://buy.stripe.com/test_00wbIUefccpD9i321Bd7q01', yearly: 'https://buy.stripe.com/test_28E7sE9YWdtHfGr9u3d7q00' };
function signedReference(userId) {
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`team-checkout:${userId}`).digest('base64url');
  return `${userId}.${sig}`;
}
export default async event => {
  if(event.httpMethod!=='POST') return json(405,{error:'Method not allowed'});
  const user=await getSession(event); if(!user) return json(401,{error:'Sign in with Discord first.'});
  let body; try{body=JSON.parse(event.body || '{}')}catch{return json(400,{error:'Invalid request.'})}
  const plan=['pro','team'].includes(body.plan)?body.plan:null;
  const interval=['monthly','yearly'].includes(body.interval)?body.interval:'monthly';
  if(!plan) return json(400,{error:'Choose a valid plan.'});
  const base=(process.env.SITE_URL || 'https://flowstate-dev.netlify.app').replace(/\/$/,'');
  if(plan==='team') {
    const link=TEAM_LINKS[interval];
    const url=new URL(link); url.searchParams.set('client_reference_id',signedReference(user.id));
    return json(200,{url:url.toString()});
  }
  if(!process.env.STRIPE_SECRET_KEY) return json(503,{error:'Stripe is not configured yet.'});
  const key=`STRIPE_PRO_${interval.toUpperCase()}_PRICE_ID`, price=process.env[key];
  if(!price) return json(503,{error:`Missing ${key} in Netlify environment variables.`});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  const session=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price,quantity:1}],client_reference_id:user.id,metadata:{discord_user_id:user.id,plan},subscription_data:{metadata:{discord_user_id:user.id,plan}},success_url:`${base}/?checkout=success`,cancel_url:`${base}/#pricing`,allow_promotion_codes:true});
  return json(200,{url:session.url});
};
