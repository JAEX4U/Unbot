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
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// 2. Define Schema with Admin Codes & User Details
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  points: { type: Number, default: 0 },
  accessCode: { type: String, required: true },
  referredBy: { type: Number, default: null },
  lastDailyClaim: { type: Date, default: null }
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

// Catch bot errors gracefully instead of crashing
bot.catch((err) => {
  console.error(`Error while handling update ${err.ctx.update.update_id}:`);
  console.error(err.error);
});

// Helper: Main Menu Inline Keyboard Buttons
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .text('🪙 My Balance', 'btn_balance')
    .row()
    .text('🎁 Daily Bonus', 'btn_daily')
    .text('👥 Referral Link', 'btn_referral');
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
    `Please type: \`/login <6-digit-code>\` to sign in.\n` +
    `Example: \`/login 888888\``,
    { parse_mode: 'Markdown' }
  );
});

// Admin Command: /val 888888
bot.command('val', async (ctx) => {
  if (ctx.from.id !== adminId && adminId !== 0) {
    return ctx.reply('❌ Unauthorized: Only the bot admin can create access codes.');
  }

  const codeArg = ctx.match.trim();
  if (!codeArg || codeArg.length !== 6 || isNaN(codeArg)) {
    return ctx.reply('⚠️ Please specify a valid 6-digit numeric code. Example: `/val 888888`', { parse_mode: 'Markdown' });
  }

  try {
    const existingCode = await AccessCode.findOne({ code: codeArg });
    if (existingCode) {
      return ctx.reply('⚠️ This code already exists in the database.');
    }

    await AccessCode.create({
      code: codeArg,
      createdBy: ctx.from.id
    });

    await ctx.reply(`✅ *Access Code Created:* \`${codeArg}\`\nUsers can now register using \`/login ${codeArg}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('❌ Error generating access code.');
  }
});

// User Command: /login 888888
bot.command('login', async (ctx) => {
  const codeInput = ctx.match.trim();

  if (!codeInput || codeInput.length !== 6) {
    return ctx.reply('⚠️ Usage: Send `/login <6-digit-code>`. Example: `/login 888888`', { parse_mode: 'Markdown' });
  }

  let user = await User.findOne({ telegramId: ctx.from.id });
  if (user) {
    return ctx.reply(`✅ You are already logged in with code \`${user.accessCode}\`!`, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
  }

  const validCode = await AccessCode.findOne({ code: codeInput, isUsed: false });
  if (!validCode) {
    return ctx.reply('❌ Invalid or already used access code. Please check with the admin.');
  }

  validCode.isUsed = true;
  validCode.usedByTelegramId = ctx.from.id;
  await validCode.save();

  user = await User.create({
    telegramId: ctx.from.id,
    username: ctx.from.username || 'No Username',
    firstName: ctx.from.first_name || '',
    lastName: ctx.from.last_name || '',
    points: 100,
    accessCode: codeInput
  });

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';

  await ctx.reply(
    `🎉 *Welcome to the Bot, ${fullName}!*\n\n` +
    `Your account has been created and saved to the database.\n` +
    `👤 *Username:* @${user.username}\n` +
    `🆔 *ID (Access Code):* \`${user.accessCode}\`\n` +
    `📲 *Telegram ID:* \`${user.telegramId}\`\n` +
    `🪙 *Starting Balance:* ${user.points} points\n\n` +
    `Choose an option below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    }
  );
});

// --- BUTTON HANDLERS ---

// Handle "My Profile" Button
bot.callbackQuery('btn_profile', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

  await ctx.answerCallbackQuery();

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';

  const profileCard = 
    `👤 *USER PROFILE DETAILS*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📛 *Name:* ${fullName}\n` +
    `🆔 *ID (Access Code):* \`${user.accessCode}\`\n` +
    `📲 *Telegram ID:* \`${user.telegramId}\`\n` +
    `🪙 *Points Balance:* *${user.points} points*\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  await ctx.reply(profileCard, { parse_mode: 'Markdown' });
});

// Handle "My Balance" Button
bot.callbackQuery('btn_balance', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

  await ctx.answerCallbackQuery();
  await ctx.reply(`🪙 *Balance Details*\n\nTelegram ID: \`${user.telegramId}\`\nCurrent Points: *${user.points}*`, { parse_mode: 'Markdown' });
});

// Handle "Daily Bonus" Button
bot.callbackQuery('btn_daily', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

  const now = new Date();
  if (user.lastDailyClaim) {
    const timeDiff = (now - new Date(user.lastDailyClaim)) / (1000 * 60 * 60);
    if (timeDiff < 24) {
      const remaining = Math.ceil(24 - timeDiff);
      await ctx.answerCallbackQuery({ text: `Wait ${remaining}h for next claim!`, show_alert: true });
      return;
    }
  }

  user.points += 50;
  user.lastDailyClaim = now;
  await user.save();

  await ctx.answerCallbackQuery({ text: 'Claimed +50 points!' });
  await ctx.reply(`🎁 You claimed *50 daily points*! New Balance: *${user.points} points*`, { parse_mode: 'Markdown' });
});

// Handle "Referral Link" Button
bot.callbackQuery('btn_referral', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

  const botInfo = await bot.api.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

  await ctx.answerCallbackQuery();
  await ctx.reply(`👥 *Your Referral Link:*\n\`${refLink}\`\n\nShare this link to earn bonus points when friends join!`, { parse_mode: 'Markdown' });
});

// Start Telegram Bot safely with long polling
bot.start({
  drop_pending_updates: true,
  onStart: (botInfo) => console.log(`Telegram Bot @${botInfo.username} engine is running...`)
});

// 4. Express REST API Server
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
        referredBy: user.referredBy
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`REST API running on port ${PORT}`));
