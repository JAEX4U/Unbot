require('dotenv').config({ path: 'un.env' });
const { Bot, InlineKeyboard } = require('grammy');
const mongoose = require('mongoose');
const express = require('express');

// 1. Connect to MongoDB Atlas
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error('CRITICAL: MONGO_URI is missing from environment variables!');
  process.exit(1);
}

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Successfully connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Define Schemas
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  points: { type: Number, default: 0 },
  accessCode: { type: String, required: true },
  referredBy: { type: Number, default: null },
  lastDailyClaim: { type: Date, default: null },
  isBanned: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false }
}, { timestamps: true });

const codeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  isUsed: { type: Boolean, default: false },
  createdBy: { type: Number, required: true },
  usedByTelegramId: { type: Number, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const AccessCode = mongoose.model('AccessCode', codeSchema);

// 3. Initialize Telegram Bot
const botToken = process.env.BOT_TOKEN;
const adminId = Number(process.env.ADMIN_TELEGRAM_ID || 0);

if (!botToken) {
  console.error('CRITICAL: BOT_TOKEN is missing!');
  process.exit(1);
}

const bot = new Bot(botToken);

bot.catch((err) => {
  console.error(`Error while handling update ${err.ctx.update.update_id}:`);
  console.error(err.error);
});

// --- ANTI-SPAM SYSTEM ---
const userCooldowns = new Map(); // Stores timestamp & warning status per user ID
const RATE_LIMIT_MS = 1500;       // Minimum time between requests (1.5 seconds)
const LOCKOUT_MS = 5000;          // Lockout penalty duration if spamming (5 seconds)

bot.use(async (ctx, next) => {
  if (!ctx.from) return await next();

  const userId = ctx.from.id;
  const now = Date.now();
  const userState = userCooldowns.get(userId) || { lastTime: 0, warned: false, lockUntil: 0 };

  // 1. Check if user is currently locked out for spamming
  if (now < userState.lockUntil) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }
    return; // Silently ignore rapid spammed requests
  }

  // 2. Check if request came too fast
  if (now - userState.lastTime < RATE_LIMIT_MS) {
    userState.lockUntil = now + LOCKOUT_MS; // Lockout user for 5s

    if (!userState.warned) {
      userState.warned = true;
      userCooldowns.set(userId, userState);

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: "⚠️ Please slow down! Don't spam buttons.",
          show_alert: true
        }).catch(() => {});
      } else {
        await ctx.reply('⚠️ <b>Slow down!</b> Please wait a few seconds before sending another request.', {
          parse_mode: 'HTML'
        }).catch(() => {});
      }
    }
    return;
  }

  // Reset state if valid request speed
  userCooldowns.set(userId, { lastTime: now, warned: false, lockUntil: 0 });

  await next();
});

// --- GLOBAL BAN / SUSPEND CHECK ---
bot.use(async (ctx, next) => {
  if (!ctx.from) return await next();

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user) {
    if (user.isBanned) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: '🚫 Account Banned.', show_alert: true });
      else await ctx.reply('⛔ <b>Your account has been permanently banned from using this bot.</b>', { parse_mode: 'HTML' });
      return;
    }
    if (user.isSuspended) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: '⚠️ Account Suspended.', show_alert: true });
      else await ctx.reply('⚠️ <b>Your account is currently suspended. Please contact support.</b>', { parse_mode: 'HTML' });
      return;
    }
  }
  await next();
});

// Helper: Main Menu Inline Keyboard
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .row()
    .text('🎁 Daily Bonus', 'btn_daily')
    .text('👥 Referral Link', 'btn_referral');
}

// Helper: Back Button Keyboard
function getBackKeyboard() {
  return new InlineKeyboard()
    .text('🔙 Back to Main Menu', 'btn_back');
}

// Helper: Find User by ID, Username, or Access Code
async function findUserByQuery(query) {
  const cleanQuery = query.trim().replace(/^@/, '');
  
  if (!isNaN(cleanQuery)) {
    const num = Number(cleanQuery);
    let u = await User.findOne({ telegramId: num });
    if (u) return u;
    u = await User.findOne({ accessCode: cleanQuery });
    if (u) return u;
  }
  
  return await User.findOne({
    $or: [
      { username: new RegExp(`^${cleanQuery}$`, 'i') },
      { accessCode: cleanQuery }
    ]
  });
}

// Helper: Format User Profile/Info Output (HTML Mode - Safe against underscores)
function formatUserInfo(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
  const usernameDisplay = user.username && user.username !== 'No Username' ? `@${user.username}` : 'Not set';
  const registeredDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
  
  let statusText = '🟢 Active';
  if (user.isBanned) statusText = '🔴 Banned';
  else if (user.isSuspended) statusText = '🟡 Suspended';

  return `<b>👤 USER PROFILE DETAILS</b>\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `📛 <b>Name:</b> ${fullName}\n` +
         `🆔 <b>ID (Access Code):</b> <code>${user.accessCode}</code>\n` +
         `📲 <b>Telegram ID:</b> <code>${user.telegramId}</code>\n` +
         `🏷️ <b>Username:</b> ${usernameDisplay}\n` +
         `🪙 <b>Points Balance:</b> <b>${user.points} points</b>\n` +
         `📊 <b>Status:</b> ${statusText}\n` +
         `📅 <b>Registered:</b> ${registeredDate}\n` +
         `━━━━━━━━━━━━━━━━━━━━`;
}

// Command: /start
bot.command('start', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });

  if (user) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
    return ctx.reply(
      `Welcome back, ${fullName}! 👋\nSelect an option from the menu below:`,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  await ctx.reply(
    `👋 Hello ${ctx.from.first_name}!\n\n` +
    `🔒 This bot requires an official invite code to activate your account.\n\n` +
    `Please type: <code>/login &lt;6-digit-code&gt;</code> to sign in.\n` +
    `Example: <code>/login 888888</code>`,
    { parse_mode: 'HTML' }
  );
});

// Public Command: /info <accessCode | telegramId | @username>
bot.command('info', async (ctx) => {
  const query = ctx.match.trim();

  if (!query) {
    const selfUser = await User.findOne({ telegramId: ctx.from.id });
    if (!selfUser) return ctx.reply('⚠️ Please provide an Access Code, Telegram ID, or Username.\nExample: `/info 888888` or `/info @username`', { parse_mode: 'Markdown' });
    return ctx.reply(formatUserInfo(selfUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
  }

  const targetUser = await findUserByQuery(query);
  if (!targetUser) {
    return ctx.reply('❌ User not found in database.', { parse_mode: 'Markdown' });
  }

  await ctx.reply(formatUserInfo(targetUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
});

// --- ADMIN COMMANDS ---

function isAdmin(ctx) {
  if (ctx.from.id !== adminId && adminId !== 0) {
    ctx.reply('❌ Unauthorized: Admin access only.');
    return false;
  }
  return true;
}

// Admin Panel Dashboard: /admin
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const totalUsers = await User.countDocuments();
  const totalCodes = await AccessCode.countDocuments();
  const unusedCodes = await AccessCode.countDocuments({ isUsed: false });
  const bannedUsers = await User.countDocuments({ isBanned: true });
  const suspendedUsers = await User.countDocuments({ isSuspended: true });

  const adminText = 
    `🛠️ <b>ADMIN PANEL DASHBOARD</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 <b>Total Users:</b> ${totalUsers}\n` +
    `🔴 <b>Banned:</b> ${bannedUsers} | 🟡 <b>Suspended:</b> ${suspendedUsers}\n` +
    `🔑 <b>Total Codes:</b> ${totalCodes} (🟢 <b>Unused:</b> ${unusedCodes})\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>Admin Commands:</b>\n` +
    `• <code>/val &lt;6-digit-code&gt;</code> - Create access code\n` +
    `• <code>/codes</code> - View generated codes\n` +
    `• <code>/ban &lt;id|code|@user&gt;</code> - Ban a user\n` +
    `• <code>/unban &lt;id|code|@user&gt;</code> - Unban/Unsuspend user\n` +
    `• <code>/suspend &lt;id|code|@user&gt;</code> - Suspend a user\n` +
    `• <code>/addpoints &lt;id&gt; &lt;amount&gt;</code> - Add points\n` +
    `• <code>/removepoints &lt;id&gt; &lt;amount&gt;</code> - Deduct points\n` +
    `• <code>/broadcast &lt;message&gt;</code> - Send message to all`;

  await ctx.reply(adminText, { parse_mode: 'HTML' });
});

// Admin Command: /ban <id | code | @username>
bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: <code>/ban &lt;telegram_id | access_code | @username&gt;</code>', { parse_mode: 'HTML' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isBanned = true;
  user.isSuspended = false;
  await user.save();

  await ctx.reply(`🔴 User <b>${user.firstName}</b> (<code>${user.telegramId}</code>) is now <b>BANNED</b>.`, { parse_mode: 'HTML' });
});

// Admin Command: /unban <id | code | @username>
bot.command('unban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: <code>/unban &lt;telegram_id | access_code | @username&gt;</code>', { parse_mode: 'HTML' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isBanned = false;
  user.isSuspended = false;
  await user.save();

  await ctx.reply(`🟢 User <b>${user.firstName}</b> (<code>${user.telegramId}</code>) has been <b>UNBANNED / RESTORED</b>.`, { parse_mode: 'HTML' });
});

// Admin Command: /suspend <id | code | @username>
bot.command('suspend', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: <code>/suspend &lt;telegram_id | access_code | @username&gt;</code>', { parse_mode: 'HTML' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isSuspended = true;
  user.isBanned = false;
  await user.save();

  await ctx.reply(`🟡 User <b>${user.firstName}</b> (<code>${user.telegramId}</code>) is now <b>SUSPENDED</b>.`, { parse_mode: 'HTML' });
});

// Admin Command: /val 888888
bot.command('val', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const codeArg = ctx.match.trim();
  if (!codeArg || codeArg.length !== 6 || isNaN(codeArg)) {
    return ctx.reply('⚠️ Please specify a valid 6-digit numeric code. Example: <code>/val 888888</code>', { parse_mode: 'HTML' });
  }

  try {
    const existingCode = await AccessCode.findOne({ code: codeArg });
    if (existingCode) {
      return ctx.reply('⚠️ This code already exists in the database.');
    }

    await AccessCode.create({ code: codeArg, createdBy: ctx.from.id });
    await ctx.reply(`✅ <b>Access Code Created:</b> <code>${codeArg}</code>\nUsers can now register using <code>/login ${codeArg}</code>`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply('❌ Error generating access code.');
  }
});

// Admin Command: /codes
bot.command('codes', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const codes = await AccessCode.find().sort({ createdAt: -1 }).limit(20);
  if (codes.length === 0) return ctx.reply('No access codes found.');

  let message = `🔑 <b>Access Codes List (Latest 20):</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  codes.forEach(c => {
    const status = c.isUsed ? `🔴 Used (by <code>${c.usedByTelegramId}</code>)` : `🟢 Unused`;
    message += `• Code: <code>${c.code}</code> | ${status}\n`;
  });

  await ctx.reply(message, { parse_mode: 'HTML' });
});

// Admin Command: /addpoints <id|code|username> <amount>
bot.command('addpoints', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const args = ctx.match.trim().split(' ');
  const targetQuery = args[0];
  const amount = Number(args[1]);

  if (!targetQuery || isNaN(amount)) {
    return ctx.reply('⚠️ Usage: <code>/addpoints &lt;user_id|code|@username&gt; &lt;amount&gt;</code>\nExample: <code>/addpoints 123456789 500</code>', { parse_mode: 'HTML' });
  }

  const user = await findUserByQuery(targetQuery);
  if (!user) return ctx.reply('❌ User not found.');

  user.points += amount;
  await user.save();

  await ctx.reply(`✅ Added <b>${amount} points</b> to <b>${user.firstName}</b> (<code>${user.telegramId}</code>).\nNew Balance: <b>${user.points} points</b>`, { parse_mode: 'HTML' });
});

// Admin Command: /removepoints <id|code|username> <amount>
bot.command('removepoints', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const args = ctx.match.trim().split(' ');
  const targetQuery = args[0];
  const amount = Number(args[1]);

  if (!targetQuery || isNaN(amount)) {
    return ctx.reply('⚠️ Usage: <code>/removepoints &lt;user_id|code|@username&gt; &lt;amount&gt;</code>\nExample: <code>/removepoints 123456789 200</code>', { parse_mode: 'HTML' });
  }

  const user = await findUserByQuery(targetQuery);
  if (!user) return ctx.reply('❌ User not found.');

  user.points = Math.max(0, user.points - amount);
  await user.save();

  await ctx.reply(`✅ Deducted <b>${amount} points</b> from <b>${user.firstName}</b> (<code>${user.telegramId}</code>).\nNew Balance: <b>${user.points} points</b>`, { parse_mode: 'HTML' });
});

// Admin Command: /broadcast <message>
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const broadcastMsg = ctx.match.trim();
  if (!broadcastMsg) return ctx.reply('⚠️ Usage: <code>/broadcast &lt;your message here&gt;</code>', { parse_mode: 'HTML' });

  const users = await User.find({ isBanned: false }, 'telegramId');
  let successCount = 0;

  for (const u of users) {
    try {
      awaitIt looks like your request was cut off or missing context! To help me send the correct fixed `index` file, could you please provide:

1. **The programming language or framework** (e.g., HTML, JavaScript/React, Express, PHP, Python/Django).
2. **The original code** or a brief summary of the bug/error you're trying to fix.

Once you paste the existing code or describe what went wrong, I'll provide the complete, fully corrected file right away.
