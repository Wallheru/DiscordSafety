import { json, getSession, subscriptionFor, activePlan, store } from './_shared.mjs';
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
export default async event => {
  const user = await getSession(event);
  if (!user) return json(401, { error: 'Sign in with Discord to sync workflows.' });
  const key = `workflows:${user.id}`;
  if (event.httpMethod === 'GET') {
    const workflows = await store.get(key, { type: 'json' }) || [];
    const memberTeamId = await store.get(`teamMembership:${user.id}`);
    const memberTeam = memberTeamId ? await store.get(`team:${memberTeamId}`, { type: 'json' }) : null;
    const plan = memberTeam && memberTeam.status !== 'suspended' ? 'team' : activePlan(await subscriptionFor(user.id));
    return json(200, { workflows, plan });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }
  if (!Array.isArray(body.workflows)) return json(400, { error: 'Expected a workflows array.' });
  const memberTeamId = await store.get(`teamMembership:${user.id}`);
  const memberTeam = memberTeamId ? await store.get(`team:${memberTeamId}`, { type: 'json' }) : null;
  const plan = memberTeam && memberTeam.status !== 'suspended' ? 'team' : activePlan(await subscriptionFor(user.id));
  const limit = plan === 'starter' ? 3 : 1000;
  if (body.workflows.length > limit) return json(403, { error: plan === 'starter' ? 'Starter accounts can sync up to 3 workflows. Upgrade to Pro for more.' : 'The safe storage limit is 1,000 workflows per account.' });
  const ids = new Set();
  for (const item of body.workflows) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length > 120 || ids.has(item.id)) return json(400, { error: 'Each workflow needs a unique valid ID.' });
    ids.add(item.id);
  }
  const serialized = JSON.stringify(body.workflows);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKFLOW_BYTES) return json(413, { error: 'Workflow storage limit exceeded (2 MB total).' });
  await store.setJSON(key, body.workflows);
  return json(200, { ok: true, count: body.workflows.length, plan });
};
