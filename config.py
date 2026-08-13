# --------------------------------------------------------------------------
# Bot configuration
# --------------------------------------------------------------------------
import os

# Get this from @BotFather on Telegram after creating your bot.
# Set as an environment variable named BOT_TOKEN on your host (Railway, etc.)
# rather than hardcoding it here -- keeps it out of GitHub.
BOT_TOKEN = os.environ.get("BOT_TOKEN", "PUT_YOUR_BOT_TOKEN_HERE")

# Telegram user IDs allowed to run /gencode.
# Set as an environment variable named ADMIN_IDS -- comma-separated if more than one,
# e.g. ADMIN_IDS=123456789,987654321
# Don't know your ID? Message your bot with /whoami once it's running.
_admin_ids_raw = os.environ.get("ADMIN_IDS", "")
ADMIN_IDS = [int(x.strip()) for x in _admin_ids_raw.split(",") if x.strip()]
