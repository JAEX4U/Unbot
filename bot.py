"""
Telegram Verification Bot
--------------------------
Flow:
  1. An admin runs /gencode to generate a unique 8-digit code.
  2. The admin gives that code to a user (outside the bot, e.g. in person / DM).
  3. The user opens the bot and runs /link <code>.
  4. If the code is valid and unused, the user is marked verified and
     shown the main menu.
  5. Verified users can return any time with /start and land straight
     on the main menu (no need to /link again).

Storage: a local SQLite database (verify_bot.db), created automatically.
"""

import logging
import random
import sqlite3
from contextlib import closing

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

import config

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

DB_PATH = "verify_bot.db"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def init_db() -> None:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS codes (
                code        TEXT PRIMARY KEY,
                used        INTEGER NOT NULL DEFAULT 0,
                used_by     INTEGER,
                created_by  INTEGER,
                created_at  TEXT DEFAULT (datetime('now')),
                used_at     TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id     INTEGER PRIMARY KEY,
                username    TEXT,
                verified    INTEGER NOT NULL DEFAULT 0,
                code        TEXT,
                verified_at TEXT
            )
            """
        )
        conn.commit()


def generate_unique_code(conn: sqlite3.Connection) -> str:
    """Generate an 8-digit numeric code guaranteed not to already exist."""
    while True:
        code = str(random.randint(0, 99_999_999)).zfill(8)
        exists = conn.execute(
            "SELECT 1 FROM codes WHERE code = ?", (code,)
        ).fetchone()
        if not exists:
            return code


def is_user_verified(user_id: int) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute(
            "SELECT verified FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        return bool(row and row[0] == 1)


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------
def main_menu_keyboard() -> InlineKeyboardMarkup:
    # Placeholder buttons -- wire these up to real features later.
    keyboard = [
        [InlineKeyboardButton("📋 My Account", callback_data="menu_account")],
        [InlineKeyboardButton("ℹ️ Help", callback_data="menu_help")],
    ]
    return InlineKeyboardMarkup(keyboard)


async def send_main_menu(update: Update) -> None:
    text = (
        "✅ *Welcome!*\n\n"
        "You're verified and logged in. Choose an option below:"
    )
    await update.effective_message.reply_text(
        text, parse_mode=ParseMode.MARKDOWN, reply_markup=main_menu_keyboard()
    )


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if is_user_verified(user.id):
        await send_main_menu(update)
    else:
        await update.effective_message.reply_text(
            "👋 Welcome! This account isn't linked yet.\n\n"
            "Ask an admin for your 8-digit access code, then run:\n"
            "`/link 12345678`",
            parse_mode=ParseMode.MARKDOWN,
        )


async def gencode(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    admin = update.effective_user
    if admin.id not in config.ADMIN_IDS:
        await update.effective_message.reply_text(
            "⛔ You're not authorized to use this command."
        )
        return

    with closing(sqlite3.connect(DB_PATH)) as conn:
        code = generate_unique_code(conn)
        conn.execute(
            "INSERT INTO codes (code, created_by) VALUES (?, ?)",
            (code, admin.id),
        )
        conn.commit()

    await update.effective_message.reply_text(
        f"✅ New code generated:\n\n`{code}`\n\nGive this to the user you want to verify.",
        parse_mode=ParseMode.MARKDOWN,
    )
    logger.info("Admin %s generated code %s", admin.id, code)


async def link(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user

    if is_user_verified(user.id):
        await update.effective_message.reply_text("You're already verified. ✅")
        await send_main_menu(update)
        return

    if not context.args or len(context.args) != 1:
        await update.effective_message.reply_text(
            "Usage: `/link 12345678`", parse_mode=ParseMode.MARKDOWN
        )
        return

    code = context.args[0].strip()
    if not (code.isdigit() and len(code) == 8):
        await update.effective_message.reply_text(
            "That doesn't look like a valid 8-digit code. Please double-check and try again."
        )
        return

    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute(
            "SELECT used FROM codes WHERE code = ?", (code,)
        ).fetchone()

        if row is None:
            await update.effective_message.reply_text("❌ Invalid code. Please check with your admin.")
            return

        if row[0] == 1:
            await update.effective_message.reply_text("❌ This code has already been used.")
            return

        # Mark code used, mark user verified — do both atomically.
        conn.execute(
            "UPDATE codes SET used = 1, used_by = ?, used_at = datetime('now') WHERE code = ?",
            (user.id, code),
        )
        conn.execute(
            """
            INSERT INTO users (user_id, username, verified, code, verified_at)
            VALUES (?, ?, 1, ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                verified = 1, code = excluded.code, verified_at = excluded.verified_at
            """,
            (user.id, user.username, code),
        )
        conn.commit()

    logger.info("User %s verified with code %s", user.id, code)
    await update.effective_message.reply_text("✅ Code accepted! You're now verified.")
    await send_main_menu(update)


async def whoami(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Small utility: shows the user their own Telegram ID (handy for admin setup)."""
    user = update.effective_user
    await update.effective_message.reply_text(f"Your Telegram user ID is: `{user.id}`", parse_mode=ParseMode.MARKDOWN)


# ---------------------------------------------------------------------------
# Callback query handler (main menu button presses)
# ---------------------------------------------------------------------------
async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    if not is_user_verified(query.from_user.id):
        await query.edit_message_text("⛔ You need to /link your code first.")
        return

    if query.data == "menu_account":
        await query.edit_message_text(
            f"📋 *My Account*\n\nUser ID: `{query.from_user.id}`\nStatus: Verified ✅",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=main_menu_keyboard(),
        )
    elif query.data == "menu_help":
        await query.edit_message_text(
            "ℹ️ *Help*\n\nThis is a placeholder menu — add your real features here.",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=main_menu_keyboard(),
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    init_db()

    app = Application.builder().token(config.BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("gencode", gencode))
    app.add_handler(CommandHandler("link", link))
    app.add_handler(CommandHandler("whoami", whoami))
    app.add_handler(CallbackQueryHandler(menu_callback))

    logger.info("Bot starting...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
