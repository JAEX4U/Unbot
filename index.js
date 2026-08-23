// index.js
require('dotenv').config({ path: 'un.env' });
const { Bot } = require('grammy');
const mongoose = require('mongoose');
const express = require('express');

const { User } = require('./models');
const { setupAdminCommands } = require('./admin');
const { setupUserCommands } = require('./user');

// 1. Connect to MongoDB Atlas
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error('CRITICAL: MONGO_URI is missing from environment variables!');
  process.exit(1);
}

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Successfully connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Initialize Telegram Bot
const botToken = process.env.BOT_TOKEN;
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
const userCooldowns = new Map();
const RATE_LIMIT_MS = 1500;
const LOCKOUT_MS = 5000;

bot.use(async (ctx, next) => {
  if (!ctx.from) return await next();

  const userId = ctx.from.id;
  const now = Date.now();
  const userState = userCooldowns.get(userId) || { lastTime: 0, warned: false, lockUntil: 0 };

  if (now < userState.lockUntil) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (now - userState.lastTime < RATE_LIMIT_MS) {
    userState.lockUntil = now + LOCKOUT_MS;

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

// Helper: Query User across modules
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

// index.js

// Add error handling to prevent unhandled crashes
bot.catch((err) => {
  console.error('Bot Error:', err);
});

// Start bot with drop_pending_updates
bot.start({
  drop_pending_updates: true,
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started successfully!`);
  }
});

// --- REGISTER MODULES ---
setupAdminCommands(bot, findUserByQuery);
setupUserCommands(bot, findUserByQuery);

// Start Bot Engine
bot.start({
  drop_pending_updates: true,
  onStart: (botInfo) => console.log(`Telegram Bot @${botInfo.username} engine is running...`)
});

// 3. Express REST API Server
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Bot service online!'));

app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: Number(req.params.telegramId) });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';

    res.json({
      success: true,
      user: {
        telegramId: user.telegramId,
        username: user.username,
        name: fullName,
        points: user.points,
        accessCode: user.accessCode,
        referredBy: user.referredBy,
        isBanned: user.isBanned,
        isSuspended: user.isSuspended
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`REST API running on port ${PORT}`));
