# Flowstate Discord bot

## Commands
- `/status` checks the Flowstate website.
- `/embed` posts a custom embed (administrator only).
- `/invite` creates a non-expiring Discord invite and publishes it to the Flowstate website, updating its Questions/Help/Discord links.

## Setup
1. Install Python 3.10+ and run `pip install -r requirements.txt`.
2. Copy `.env.example` to `.env` and set `DISCORD` to your bot token.
3. Set `INVITE_SYNC_URL` to `https://YOUR-SITE.netlify.app/api/discord-invite`.
4. Set `INVITE_SYNC_SECRET` to the same long random secret configured in Netlify.
5. Invite the bot with Manage Server / Create Invite permission for the channel you will use.
6. Run `python main.py`. In your server, run `/invite` and choose the channel.

Keep `.env` private. The invite sync secret must match the Netlify environment variable exactly.
