# Flowstate deployment (Netlify)

## What is now connected
- Discord OAuth sign-in with a signed, HttpOnly session cookie.
- Server-side plan lookup; the old `?plan=pro` and localStorage unlock have been removed.
- Stripe Checkout sessions created server-side and subscriptions updated only from signature-verified Stripe webhooks.
- Netlify Blobs stores subscription status, signed-in users’ workflows, and the Discord invite URL.
- Signed-in Starter accounts are limited to 3 server-synced workflows; active Pro subscriptions can sync up to 1,000 (a safety ceiling).
- The bot `/invite` command creates an invite and publishes it to the website buttons.

## Netlify settings
Keep the site publish directory at the project root (`.`). Commit `netlify.toml`, `package.json`, and the `netlify/functions` folder with the site. Netlify installs the function dependencies from `package.json`.

Add these environment variables in Netlify site settings (Functions scope):
- `SITE_URL` = `https://flowstate-dev.netlify.app` (or your actual custom domain)
- `SESSION_SECRET` = a random secret of at least 32 characters
- `DISCORD_CLIENT_ID` = OAuth2 application client ID
- `DISCORD_CLIENT_SECRET` = OAuth2 application client secret
- `STRIPE_SECRET_KEY` = Stripe secret key (start with test mode)
- `STRIPE_WEBHOOK_SECRET` = Stripe webhook signing secret
- `STRIPE_PRO_MONTHLY_PRICE_ID` = Stripe recurring monthly Pro Price ID
- `STRIPE_PRO_YEARLY_PRICE_ID` = Stripe recurring yearly Pro Price ID
- `INVITE_SYNC_SECRET` = a second random secret shared with the bot host

After changing environment variables, redeploy the site.

## Discord OAuth setup
In the Discord Developer Portal, open your bot/application, OAuth2 settings, and add this exact redirect URI: `https://YOUR-SITE.netlify.app/.netlify/functions/discord-callback`. Enable the `identify` and `email` scopes (the flow requests them). Replace YOUR-SITE with your real Netlify domain.

## Stripe setup
Create recurring Products/Prices in Stripe test mode. Use Price IDs (they start with `price_`), not Payment Link URLs. Add a webhook endpoint: `https://YOUR-SITE.netlify.app/api/stripe-webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`. After testing, create live-mode prices and set the live secret key/webhook secret. Do not paste secrets into website code or chat.

## Bot host setup
The Discord bot must run on a persistent Python host (not a static Netlify site). Install `requirements.txt`, set `DISCORD`, `GUILD_ID` (optional), `SITE_URL`, `INVITE_SYNC_URL=https://YOUR-SITE.netlify.app/api/discord-invite`, and `INVITE_SYNC_SECRET` (same value as Netlify), then start `python main.py`. Give it Create Invite permission in the chosen channel. Run `/invite` once after deploy.

## Team plan

The Team card uses the two existing test Payment Links from the original HTML. After the first successful Team subscription, the signed webhook provisions the owner workspace. Members join through the invite URL while signed in with Discord. Team API routes: `/api/teams` and `/api/team-workflows`.

## Important current product limitations
Signed-in users’ workflow lists are stored in Netlify Blobs and the Starter/Pro workflow-count rule is checked by the server on every cloud save. Guest drafts remain local to their browser. Preview Run is still a local simulation; there is no hosted workflow execution engine or server-side run metering yet. Team workspaces now support owner/admin/member roles, 7-day invite links (10 uses by default), member removal/role changes, Team entitlements for members, and a shared workflow collection. The website panel supports invite creation, publishing workflows, and loading shared workflows. This is a collaboration MVP; it does not yet include simultaneous live editing, per-workflow permissions, or app-connection credential storage. Do not describe Preview Run as a real hosted execution.
