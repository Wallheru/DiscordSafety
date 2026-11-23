
import Stripe from 'stripe';
import crypto from 'node:crypto';
import { store } from './_shared.mjs';

const TEAM_LINK_URLS = new Set([
  'https://buy.stripe.com/test_00wbIUefccpD9i321Bd7q01',
  'https://buy.stripe.com/test_28E7sE9YWdtHfGr9u3d7q00'
]);

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find(
    k => k.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : undefined;
}

function getId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function validUserId(value) {
  return typeof value === 'string' &&
    /^[0-9]{5,30}$/.test(value);
}

function verifyTeamReference(value) {
  if (typeof value !== 'string') return null;

  const split = value.lastIndexOf('.');
  if (split < 1 || !process.env.SESSION_SECRET) return null;

  const userId = value.slice(0, split);
  const signature = value.slice(split + 1);

  if (!validUserId(userId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return null;
  }

  const supplied = Buffer.from(signature, 'base64url');

  const expected = Buffer.from(
    crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(`team-checkout:${userId}`)
      .digest('base64url'),
    'base64url'
  );

  if (supplied.length !== expected.length) return null;

  return crypto.timingSafeEqual(supplied, expected)
    ? userId
    : null;
}

async function getTeam(userId) {
  const teamId = `team_${userId}`;

  return {
    teamId,
    team: await store.get(`team:${teamId}`, { type: 'json' })
  };
}

async function updateTeam(userId, status) {
  const { teamId, team: existing } = await getTeam(userId);

  let team = existing;

  if (!team && ACTIVE_STATUSES.has(status)) {
    team = {
      id: teamId,
      name: 'Flowstate Team',
      ownerId: userId,
      members: {
        [userId]: {
          role: 'owner',
          joinedAt: Date.now()
        }
      },
      createdAt: Date.now()
    };
  }

  if (!team) return;

  team.status = ACTIVE_STATUSES.has(status)
    ? 'active'
    : 'suspended';

  await store.setJSON(`team:${teamId}`, team);

  if (ACTIVE_STATUSES.has(status)) {
    await store.set(`teamMembership:${userId}`, teamId);
  }
}

async function saveSubscription(subscription, eventCreated, paymentStatus) {
  const userId = subscription.metadata?.discord_user_id;
  const plan = subscription.metadata?.plan || 'pro';

  if (!validUserId(userId)) {
    console.error('Subscription has no valid Discord user ID:', subscription.id);
    return;
  }

  if (!['pro', 'team'].includes(plan)) {
    console.error('Invalid subscription plan:', plan);
    return;
  }

  const key = `subscription:${userId}`;
  const existing = await store.get(key, { type: 'json' });

  // Ignore older subscription events.
  if (
    existing?.subscription_id === subscription.id &&
    Number(existing.last_event_created || 0) > eventCreated
  ) {
    return;
  }

  const record = {
    plan,
    status: subscription.status,
    subscription_id: subscription.id,
    customer_id: getId(subscription.customer),
    current_period_end: subscription.current_period_end,
    last_event_created: eventCreated
  };

  if (paymentStatus) {
    record.payment_status = paymentStatus;
  } else if (existing?.subscription_id === subscription.id) {
    record.payment_status = existing.payment_status;
  }

  await store.setJSON(key, record);

  if (plan === 'team') {
    await updateTeam(userId, subscription.status);
  }
}

async function handleCheckout(stripe, session, eventCreated) {
  if (session.mode !== 'subscription') return;

  let userId = session.metadata?.discord_user_id ||
    session.client_reference_id;

  let plan = session.metadata?.plan || 'pro';

  // Team purchases must use one of our verified Team Payment Links.
  if (session.payment_link) {
    const paymentLink = await stripe.paymentLinks.retrieve(
      getId(session.payment_link)
    );

    if (TEAM_LINK_URLS.has(paymentLink.url)) {
      userId = verifyTeamReference(session.client_reference_id);
      plan = 'team';
    } else {
      // Never trust a client-supplied Team plan.
      if (plan === 'team') {
        throw new Error('Unrecognized Team Payment Link');
      }
    }
  } else if (plan === 'team') {
    throw new Error('Team checkout did not use a verified Payment Link');
  }

  if (!validUserId(userId)) {
    throw new Error('Invalid or missing Discord user ID');
  }

  const subscriptionId = getId(session.subscription);

  if (!subscriptionId) {
    throw new Error('Checkout session has no subscription');
  }

  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId
  );

  // Attach verified ownership to the Stripe subscription.
  const updatedSubscription = await stripe.subscriptions.update(
    subscription.id,
    {
      metadata: {
        ...subscription.metadata,
        discord_user_id: userId,
        plan
      }
    }
  );

  await saveSubscription(
    updatedSubscription,
    eventCreated,
    session.payment_status || null
  );
}

async function handleInvoice(stripe, invoice, eventCreated, paid) {
  const subscriptionId =
    getId(invoice.subscription) ||
    getId(invoice.parent?.subscription_details?.subscription);

  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId
  );

  await saveSubscription(
    subscription,
    eventCreated,
    paid ? 'paid' : 'payment_failed'
  );
}

export default async event => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: 'Method not allowed'
    };
  }

  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET ||
    !process.env.SESSION_SECRET
  ) {
    return {
      statusCode: 503,
      body: 'Webhook configuration incomplete'
    };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      getHeader(event.headers, 'stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Stripe signature verification failed');
    return {
      statusCode: 400,
      body: 'Invalid webhook signature'
    };
  }

  try {
    // Prevent processing the same Stripe event more than once.
    const eventKey = `stripeEvent:${stripeEvent.id}`;
    const alreadyProcessed = await store.get(eventKey);

    if (alreadyProcessed) {
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true })
      };
    }

    const obj = stripeEvent.data.object;
    const created = Number(stripeEvent.created || 0);

    switch (stripeEvent.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckout(stripe, obj, created);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await saveSubscription(obj, created);
        break;

      case 'invoice.paid':
        await handleInvoice(stripe, obj, created, true);
        break;

      case 'invoice.payment_failed':
        await handleInvoice(stripe, obj, created, false);
        break;

      default:
        // Other events are safely acknowledged.
        break;
    }

    // Mark only after successful processing so Stripe can retry failures.
    await store.set(eventKey, '1');

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Stripe webhook processing failed:', error);

    return {
      statusCode: 500,
      body: 'Webhook processing failed'
    };
  }
};
