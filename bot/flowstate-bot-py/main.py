import os
import re
import time
from pathlib import Path

import aiohttp
import discord
from discord import app_commands

try:  # optional, only needed for local .env files
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# The host stores the token in a variable called DISCORD; DISCORD_TOKEN also works.
TOKEN = os.environ.get("DISCORD") or os.environ.get("DISCORD_TOKEN")
GUILD_ID = os.environ.get("GUILD_ID")  # optional: makes commands appear instantly
SITE_URL = os.environ.get("SITE_URL") or "https://flowstate-dev.netlify.app"
INVITE_SYNC_URL = os.environ.get("INVITE_SYNC_URL")
INVITE_SYNC_SECRET = os.environ.get("INVITE_SYNC_SECRET")

DEFAULT_COLOR = 0x5B6CFF
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB


class FlowstateBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        # Register the slash commands automatically on every start.
        try:
            if GUILD_ID:
                guild = discord.Object(id=int(GUILD_ID))
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                # Remove any older global copies so commands are not duplicated
                self.tree.clear_commands(guild=None)
                await self.tree.sync()
            else:
                synced = await self.tree.sync()
            print(f"Registered {len(synced)} command(s).")
        except Exception as err:  # noqa: BLE001
            print(f"Could not register commands: {err}")

    async def on_ready(self):
        print(f"Flowstate Bot online as {self.user}")


client = FlowstateBot()
tree = client.tree


def parse_color(value):
    if not value:
        return DEFAULT_COLOR
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value.strip())
    return int(match.group(1), 16) if match else None


def validate_image(attachment, label):
    if attachment is None:
        return None
    if not (attachment.content_type or "").startswith("image/"):
        return f"The {label} must be an image file."
    if attachment.size > MAX_IMAGE_BYTES:
        return f"The {label} must be smaller than 8 MB."
    return None


async def to_file(attachment, base_name):
    ext = Path(attachment.filename or "").suffix.lower() or ".png"
    name = f"{base_name}{ext}"
    return await attachment.to_file(filename=name), name


# ---------------------------------------------------------------- /embed
@tree.command(name="embed", description="Send a custom embed message")
@app_commands.describe(
    title="Embed title",
    description="Main text. Type \\n for a new line",
    channel="Channel to send to (default: this channel)",
    color="Hex color, for example #5B6CFF",
    footer="Footer text",
    banner="Banner image (upload a file)",
    thumbnail="Small image in the top right (upload a file)",
    timestamp="Show the current time in the footer",
)
@app_commands.guild_only()
@app_commands.default_permissions(administrator=True)
@app_commands.checks.has_permissions(administrator=True)
async def embed_command(
    interaction: discord.Interaction,
    title: app_commands.Range[str, 1, 256],
    description: app_commands.Range[str, 1, 4000],
    channel: discord.TextChannel | None = None,
    color: str | None = None,
    footer: app_commands.Range[str, 1, 2048] | None = None,
    banner: discord.Attachment | None = None,
    thumbnail: discord.Attachment | None = None,
    timestamp: bool = False,
):
    await interaction.response.defer(ephemeral=True)

    parsed_color = parse_color(color)
    if parsed_color is None:
        return await interaction.followup.send(
            "Invalid color. Use a 6-digit hex code, for example `#5B6CFF`."
        )

    error = validate_image(banner, "banner") or validate_image(thumbnail, "thumbnail")
    if error:
        return await interaction.followup.send(error)

    target = channel or interaction.channel
    if not isinstance(target, discord.abc.Messageable) or not hasattr(target, "permissions_for"):
        return await interaction.followup.send("I cannot send messages in that channel.")

    perms = target.permissions_for(interaction.guild.me)
    needs_files = banner is not None or thumbnail is not None
    if not (perms.view_channel and perms.send_messages and perms.embed_links) or (
        needs_files and not perms.attach_files
    ):
        return await interaction.followup.send(
            f"I am missing permissions in {target.mention}. I need View Channel, "
            f"Send Messages, Embed Links{', and Attach Files' if needs_files else ''}."
        )

    embed = discord.Embed(
        title=title,
        description=description.replace("\\n", "\n"),
        color=parsed_color,
    )
    if footer:
        embed.set_footer(text=footer)
    if timestamp:
        embed.timestamp = discord.utils.utcnow()

    files = []
    try:
        if banner:
            file, name = await to_file(banner, "banner")
            files.append(file)
            embed.set_image(url=f"attachment://{name}")
        if thumbnail:
            file, name = await to_file(thumbnail, "thumbnail")
            files.append(file)
            embed.set_thumbnail(url=f"attachment://{name}")
    except discord.HTTPException as err:
        return await interaction.followup.send(f"Could not download the image: {err}")

    await target.send(embed=embed, files=files)
    await interaction.followup.send(f"Embed sent to {target.mention}.")


# --------------------------------------------------------------- /status
@tree.command(name="status", description="Check whether the Flowstate website is responding")
@app_commands.guild_only()
@app_commands.default_permissions(administrator=True)
@app_commands.checks.has_permissions(administrator=True)
async def status_command(interaction: discord.Interaction):
    await interaction.response.defer()

    online = False
    status_code = None
    error_text = None
    started = time.perf_counter()

    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(
                SITE_URL, headers={"User-Agent": "FlowstateBot/1.0 (status check)"}
            ) as res:
                status_code = res.status
                online = res.status < 400
    except TimeoutError:
        error_text = "The request timed out after 10 seconds."
    except aiohttp.ClientError as err:
        error_text = str(err) or err.__class__.__name__

    ms = round((time.perf_counter() - started) * 1000)

    embed = discord.Embed(
        title="Flowstate Status",
        description="The website is responding." if online else "The website is not responding correctly.",
        color=0x2ECC71 if online else 0xE74C3C,
        timestamp=discord.utils.utcnow(),
    )
    embed.add_field(name="Status", value="Online" if online else "Offline", inline=True)
    embed.add_field(name="HTTP code", value=str(status_code) if status_code else "No response", inline=True)
    embed.add_field(name="Response time", value=f"{ms} ms", inline=True)
    embed.add_field(name="URL", value=SITE_URL, inline=False)
    if error_text:
        embed.add_field(name="Error", value=error_text[:1000], inline=False)
    embed.set_footer(text="Flowstate Bot")

    await interaction.followup.send(embed=embed)


# --------------------------------------------------------------- /invite
@tree.command(name="invite", description="Create and publish the Flowstate Discord invite to the website buttons")
@app_commands.describe(channel="Channel new members should land in (defaults to this channel)")
@app_commands.guild_only()
@app_commands.default_permissions(administrator=True)
@app_commands.checks.has_permissions(administrator=True, create_instant_invite=True)
async def invite_command(interaction: discord.Interaction, channel: discord.TextChannel | None = None):
    target = channel or interaction.channel
    if not isinstance(target, discord.TextChannel):
        return await interaction.response.send_message("Choose a text channel for the invite.", ephemeral=True)
    perms = target.permissions_for(interaction.guild.me)
    if not perms.create_instant_invite:
        return await interaction.response.send_message(f"I need Create Invite permission in {target.mention}.", ephemeral=True)
    if not INVITE_SYNC_URL or not INVITE_SYNC_SECRET:
        return await interaction.response.send_message("Invite sync is not configured. Add INVITE_SYNC_URL and INVITE_SYNC_SECRET to the bot host environment variables.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    try:
        invite = await target.create_invite(max_age=0, max_uses=0, unique=True, reason="Flowstate website community invite")
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(INVITE_SYNC_URL, json={"url": invite.url}, headers={"x-flowstate-secret": INVITE_SYNC_SECRET}) as response:
                if response.status >= 300:
                    detail = (await response.text())[:500]
                    return await interaction.followup.send(f"Created {invite.url}, but could not update the website (HTTP {response.status}): {detail}", ephemeral=True)
        await interaction.followup.send(f"Website invite updated successfully: {invite.url}\nThe Questions, Help and Discord buttons now use this invite.", ephemeral=True)
    except (discord.HTTPException, aiohttp.ClientError, TimeoutError) as err:
        await interaction.followup.send(f"Could not publish the invite: {str(err)[:500]}", ephemeral=True)


# ------------------------------------------------------------ error hook
@tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.MissingPermissions):
        message = "This command is only available to administrators."
    else:
        print(f"Error in /{interaction.command.name if interaction.command else '?'}: {error!r}")
        message = "Something went wrong while running this command."
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("Missing token. Set the DISCORD variable (or DISCORD_TOKEN) on your host.")
    client.run(TOKEN)
