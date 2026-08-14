"""
Telegram Verification Bot
--------------------------
Flow:
  1. An admin opens /admin (or runs /gencode) to generate a unique code
     in a randomly-varied format, cryptographically random, with an
     expiry time.
  2. The bot sends back a ready-to-forward message with the code and
     "valid until" time -- the admin just forwards it to the user.
  3. The user opens the bot and runs /link <code> before it expires.
  4. If the code is valid, unused, and not expired, the user is marked
     verified and shown the main menu.
  5. Verified users can return any time with /start and land straight
     on the main menu (no need to /link again).

Storage: a local SQLite database (verify_bot.db), created automatically.
"""

import logging
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
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

# Characters used when building codes -- visually-confusing characters
# removed (0/O, 1/I/L) so codes are easy to read and type correctly.
LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"
DIGITS = "23456789"
LOWER = "abcdefghjkmnpqrstuvwxyz"
ALNUM_UPPER = LETTERS + DIGITS
ALNUM_MIXED = LETTERS + LOWER + DIGITS


def _style_alnum8() -> str:
    """8 random upper-case letters/digits, no separators. e.g. 7XQKM9PZ"""
    return "".join(secrets.choice(ALNUM_UPPER) for _ in range(8))


def _style_letters6() -> str:
    """6 random upper-case letters only. e.g. QVXKRT"""
    return "".join(secrets.choice(LETTERS) for _ in range(6))


def _style_grouped() -> str:
    """Two groups of 4, dash-separated. e.g. AB3D-9XQP"""
    g1 = "".join(secrets.choice(ALNUM_UPPER) for _ in range(4))
    g2 = "".join(secrets.choice(ALNUM_UPPER) for _ in range(4))
    return f"{g1}-{g2}"

def _style_mixedcase() -> str:
    """9 characters, mixed upper/lower/digits -- no fixed casing pattern. e.g. k7QmZ2xPb"""
    return "".join(secrets.choice(ALNUM_MIXED) for _ in range(9))


def _style_triplets() -> str:
    """Three groups of 3, dash-separated. e.g. K7M-2Q9-XZ4"""
    groups = [
        "".join(secrets.choice(ALNUM_UPPER) for _ in range(3)) for _ in range(3)
    ]
    return "-".join(groups)


# Every /gencode call picks one of these at random, so there's no single
# fixed length/format/character-set to learn or predict.
CODE_STYLES = [_style_alnum8, _style_letters6, _style_grouped, _style_mixedcase, _style_triplets]


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
                expires_at  TEXT,
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
                verified_at TEXT,
                banned      INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.commit()

        # Migration: add `banned` column if this DB was created before it existed.
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        if "banned" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0")
            conn.commit()


def generate_unique_code(conn: sqlite3.Connection) -> str:
    """Generate a code using a randomly-chosen style, guaranteed not to already exist."""
    while True:
        style = secrets.choice(CODE_STYLES)
        code = style()
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


def is_user_banned(user_id: int) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute(
            "SELECT banned FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        return bool(row and row[0] == 1)


def set_ban(user_id: int, banned: bool) -> bool:
    """Ban or unban a user. Creates a banned-only record if the user doesn't exist yet
    (lets an admin pre-emptively ban an ID before that user ever messages the bot).
    Returns True if a row was updated or created, False for unban of an unknown user."""
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cur = conn.execute(
            "UPDATE users SET banned = ? WHERE user_id = ?", (1 if banned else 0, user_id)
        )
        if cur.rowcount == 0:
            if not banned:
                conn.commit()
                return False
            conn.execute(
                "INSERT INTO users (user_id, verified, banned) VALUES (?, 0, 1)",
                (user_id,),
            )
        conn.commit()
        return True


def get_verified_user_ids() -> list[int]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        rows = conn.execute(
            "SELECT user_id FROM users WHERE verified = 1 AND banned = 0"
        ).fetchall()
        return [r[0] for r in rows]


def create_code(admin_id: int) -> tuple[str, "datetime", "datetime"]:
    """Generate a code, store it, and return (code, created_at, expires_at)."""
    created_at = datetime.now(timezone.utc)
    expires_at = created_at + timedelta(minutes=config.CODE_EXPIRY_MINUTES)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        code = generate_unique_code(conn)
        conn.execute(
            "INSERT INTO codes (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (code, admin_id, created_at.isoformat(), expires_at.isoformat()),
        )
        conn.commit()
    logger.info("Admin %s generated code %s (expires %s)", admin_id, code, expires_at.isoformat())
    return code, created_at, expires_at


def forwardable_code_message(code: str, admin_user, created_at: datetime, expires_at: datetime) -> str:
    """The exact message text an admin can forward straight to a user."""
    admin_label = admin_user.username and f"@{admin_user.username}" or admin_user.full_name
    return (
        "🔐 *Your Access Code*\n\n"
        f"Code: `{code}`\n"
        f"Generated by: {admin_label} (ID: {admin_user.id})\n"
        f"Generated at: {created_at.strftime('%I:%M%p UTC')}\n"
        f"Valid until: *{expires_at.strftime('%I:%M%p UTC')}* "
        f"({config.CODE_EXPIRY_MINUTES} min)\n\n"
        "To activate, open the bot and send:\n"
        f"`/link {code}`"
    )


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
    if is_user_banned(user.id):
        await update.effective_message.reply_text("⛔ You've been banned from using this bot.")
        return
    if is_user_verified(user.id):
        await send_main_menu(update)
    else:
        await update.effective_message.reply_text(
            "👋 Welcome! This account isn't linked yet.\n\n"
            "Ask an admin for your access code, then run:\n"
            "`/link YOUR-CODE`",
            parse_mode=ParseMode.MARKDOWN,
        )


async def gencode(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    admin = update.effective_user
    if admin.id not in config.ADMIN_IDS:
        await update.effective_message.reply_text(
            "⛔ You're not authorized to use this command."
        )
        return

    code, created_at, expires_at = create_code(admin.id)

    await update.effective_message.reply_text(
        forwardable_code_message(code, admin, created_at, expires_at),
        parse_mode=ParseMode.MARKDOWN,
    )


async def link(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user

    if is_user_banned(user.id):
        await update.effective_message.reply_text("⛔ You've been banned from using this bot.")
        return

    if is_user_verified(user.id):
        await update.effective_message.reply_text("You're already verified. ✅")
        await send_main_menu(update)
        return

    if not context.args or len(context.args) != 1:
        await update.effective_message.reply_text(
            "Usage: `/link YOUR-CODE`", parse_mode=ParseMode.MARKDOWN
        )
        return

    code = context.args[0].strip()
    if not code:
        await update.effective_message.reply_text(
            "That doesn't look like a valid code. Please double-check and try again."
        )
        return

    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute(
            "SELECT used, expires_at FROM codes WHERE code = ?", (code,)
        ).fetchone()

        if row is None:
            await update.effective_message.reply_text("❌ Invalid code. Please check with your admin.")
            return

        used, expires_at_raw = row

        if used == 1:
            await update.effective_message.reply_text("❌ This code has already been used.")
            return

        if expires_at_raw:
            expires_at = datetime.fromisoformat(expires_at_raw)
            if datetime.now(timezone.utc) > expires_at:
                await update.effective_message.reply_text(
                    "⌛ This code has expired. Please ask your admin for a new one."
                )
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
# Admin panel
# ---------------------------------------------------------------------------
def admin_menu_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [InlineKeyboardButton("➕ Generate Code", callback_data="admin_gencode")],
        [InlineKeyboardButton("📄 Active Codes", callback_data="admin_active")],
        [InlineKeyboardButton("📊 Stats", callback_data="admin_stats")],
        [InlineKeyboardButton("📢 Broadcast", callback_data="admin_broadcast")],
        [
            InlineKeyboardButton("🚫 Ban User", callback_data="admin_ban"),
            InlineKeyboardButton("✅ Unban User", callback_data="admin_unban"),
        ],
    ]
    return InlineKeyboardMarkup(keyboard)


async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if user.id not in config.ADMIN_IDS:
        await update.effective_message.reply_text("⛔ You're not authorized to use this command.")
        return

    await update.effective_message.reply_text(
        "🛠 *Admin Panel*\n\nChoose an action:",
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=admin_menu_keyboard(),
    )


async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    admin_user = query.from_user

    if admin_user.id not in config.ADMIN_IDS:
        await query.answer("Not authorized.", show_alert=True)
        return

    await query.answer()

    if query.data == "admin_gencode":
        code, created_at, expires_at = create_code(admin_user.id)
        await query.edit_message_text(
            "🛠 *Admin Panel*\n\nChoose an action:",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=admin_menu_keyboard(),
        )
        # Send the forwardable message as a separate message so it's easy
        # to long-press and hit "Forward" straight to the user.
        await context.bot.send_message(
            chat_id=admin_user.id,
            text=forwardable_code_message(code, admin_user, created_at, expires_at),
            parse_mode=ParseMode.MARKDOWN,
        )

    elif query.data == "admin_active":
        now = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(DB_PATH)) as conn:
            rows = conn.execute(
                "SELECT code, expires_at FROM codes "
                "WHERE used = 0 AND (expires_at IS NULL OR expires_at > ?) "
                "ORDER BY created_at DESC LIMIT 20",
                (now,),
            ).fetchall()

        if not rows:
            text = "📄 *Active Codes*\n\nNone right now."
        else:
            lines = [f"`{c}` — until {datetime.fromisoformat(e).strftime('%I:%M%p UTC')}" for c, e in rows]
            text = "📄 *Active Codes*\n\n" + "\n".join(lines)

        await query.edit_message_text(
            text, parse_mode=ParseMode.MARKDOWN, reply_markup=admin_menu_keyboard()
        )

    elif query.data == "admin_stats":
        with closing(sqlite3.connect(DB_PATH)) as conn:
            total_codes = conn.execute("SELECT COUNT(*) FROM codes").fetchone()[0]
            used_codes = conn.execute("SELECT COUNT(*) FROM codes WHERE used = 1").fetchone()[0]
            verified_users = conn.execute("SELECT COUNT(*) FROM users WHERE verified = 1").fetchone()[0]
            banned_users = conn.execute("SELECT COUNT(*) FROM users WHERE banned = 1").fetchone()[0]

        text = (
            "📊 *Stats*\n\n"
            f"Codes generated: {total_codes}\n"
            f"Codes used: {used_codes}\n"
            f"Verified users: {verified_users}\n"
            f"Banned users: {banned_users}"
        )
        await query.edit_message_text(
            text, parse_mode=ParseMode.MARKDOWN, reply_markup=admin_menu_keyboard()
        )

    elif query.data == "admin_broadcast":
        context.user_data["pending_action"] = "broadcast"
        await query.edit_message_text(
            "📢 *Broadcast*\n\n"
            "Send the message you want to broadcast to all verified users.\n"
            "Send /cancel to abort.",
            parse_mode=ParseMode.MARKDOWN,
        )

    elif query.data == "admin_ban":
        context.user_data["pending_action"] = "ban"
        await query.edit_message_text(
            "🚫 *Ban User*\n\n"
            "Send the Telegram user ID to ban.\n"
            "Send /cancel to abort.",
            parse_mode=ParseMode.MARKDOWN,
        )

    elif query.data == "admin_unban":
        context.user_data["pending_action"] = "unban"
        await query.edit_message_text(
            "✅ *Unban User*\n\n"
            "Send the Telegram user ID to unban.\n"
            "Send /cancel to abort.",
            parse_mode=ParseMode.MARKDOWN,
        )


async def admin_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.user_data.pop("pending_action", None):
        await update.effective_message.reply_text("Cancelled.")


async def admin_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handles the admin's follow-up message after tapping Broadcast/Ban/Unban."""
    user = update.effective_user
    pending = context.user_data.get("pending_action")

    if user.id not in config.ADMIN_IDS or not pending:
        return  # not an admin mid-flow -- ignore, let other handlers (none) apply

    context.user_data.pop("pending_action", None)
    text = update.effective_message.text or ""

    if pending == "broadcast":
        recipients = get_verified_user_ids()
        sent, failed = 0, 0
        for uid in recipients:
            try:
                await context.bot.send_message(chat_id=uid, text=text)
                sent += 1
            except Exception:
                failed += 1
        await update.effective_message.reply_text(
            f"📢 Broadcast sent to {sent} user(s). Failed: {failed}.",
            reply_markup=admin_menu_keyboard(),
        )

    elif pending in ("ban", "unban"):
        target_text = text.strip()
        if not target_text.isdigit():
            await update.effective_message.reply_text(
                "That's not a valid numeric user ID. Please try again from the admin menu."
            )
            return
        target_id = int(target_text)
        found = set_ban(target_id, banned=(pending == "ban"))
        if not found:
            await update.effective_message.reply_text(
                "⚠️ No record of that user — nothing to unban."
            )
            return
        verb = "banned" if pending == "ban" else "unbanned"
        await update.effective_message.reply_text(
            f"✅ User `{target_id}` {verb}.",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=admin_menu_keyboard(),
        )
        logger.info("Admin %s %s user %s", user.id, verb, target_id)


# ---------------------------------------------------------------------------
# Callback query handler (main menu button presses)
# ---------------------------------------------------------------------------
async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    if is_user_banned(query.from_user.id):
        await query.edit_message_text("⛔ You've been banned from using this bot.")
        r
