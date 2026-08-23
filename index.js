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

// Global Middleware: Check if user is Banned or Suspended
bot.use(async (ctx, next) => {
  if (!ctx.from) return await next();

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user) {
    if (user.isBanned) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: '🚫 Account Banned.', show_alert: true });
      else await ctx.reply('⛔ *Your account has been permanently banned from using this bot.*', { parse_mode: 'Markdown' });
      return;
    }
    if (user.isSuspended) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: '⚠️ Account Suspended.', show_alert: true });
      else await ctx.reply('⚠️ *Your account is currently suspended. Please contact support.*', { parse_mode: 'Markdown' });
      return;
    }
  }
  await next();
});

// Helper: Main Menu Inline Keyboard
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .text('🪙 My Balance', 'btn_balance')
    .row()
    .text('🎁 Daily Bonus', 'btn_daily')
    .text('👥 Referral Link', 'btn_referral');
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

// Helper: Format User Profile/Info Output
function formatUserInfo(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
  const usernameDisplay = user.username && user.username !== 'No Username' ? `@${user.username}` : 'Not set';
  const registeredDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
  
  let statusText = '🟢 Active';
  if (user.isBanned) statusText = '🔴 Banned';
  else if (user.isSuspended) statusText = '🟡 Suspended';

  return `🔍 *USER INFORMATION*\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `📛 *Name:* ${fullName}\n` +
         `🆔 *ID (Access Code):* \`${user.accessCode}\`\n` +
         `📲 *Telegram ID:* \`${user.telegramId}\`\n` +
         `🏷️ *Username:* ${usernameDisplay}\n` +
         `🪙 *Points Balance:* *${user.points} points*\n` +
         `📊 *Status:* ${statusText}\n` +
         `📅 *Registered:* ${registeredDate}\n` +
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
    `Please type: \`/login <6-digit-code>\` to sign in.\n` +
    `Example: \`/login 888888\``,
    { parse_mode: 'Markdown' }
  );
});

// Public Command: /info <accessCode | telegramId | @username>
bot.command('info', async (ctx) => {
  const query = ctx.match.trim();

  if (!query) {
    // If no argument provided, show caller's own info
    const selfUser = await User.findOne({ telegramId: ctx.from.id });
    if (!selfUser) return ctx.reply('⚠️ Please provide an Access Code, Telegram ID, or Username.\nExample: `/info 888888` or `/info @username`', { parse_mode: 'Markdown' });
    return ctx.reply(formatUserInfo(selfUser), { parse_mode: 'Markdown' });
  }

  const targetUser = await findUserByQuery(query);
  if (!targetUser) {
    return ctx.reply('❌ User not found in database.', { parse_mode: 'Markdown' });
  }

  await ctx.reply(formatUserInfo(targetUser), { parse_mode: 'Markdown' });
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
    `🛠️ *ADMIN PANEL DASHBOARD*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 *Total Users:* ${totalUsers}\n` +
    `🔴 *Banned:* ${bannedUsers} | 🟡 *Suspended:* ${suspendedUsers}\n` +
    `🔑 *Total Codes:* ${totalCodes} (🟢 *Unused:* ${unusedCodes})\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*Admin Commands:*\n` +
    `• \`/val <6-digit-code>\` - Create access code\n` +
    `• \`/codes\` - View generated codes\n` +
    `• \`/ban <id|code|@user>\` - Ban a user\n` +
    `• \`/unban <id|code|@user>\` - Unban/Unsuspend user\n` +
    `• \`/suspend <id|code|@user>\` - Suspend a user\n` +
    `• \`/addpoints <id> <amount>\` - Add points\n` +
    `• \`/removepoints <id> <amount>\` - Deduct points\n` +
    `• \`/broadcast <message>\` - Send message to all`;

  await ctx.reply(adminText, { parse_mode: 'Markdown' });
});

// Admin Command: /ban <id | code | @username>
bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: `/ban <telegram_id | access_code | @username>`', { parse_mode: 'Markdown' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isBanned = true;
  user.isSuspended = false;
  await user.save();

  await ctx.reply(`🔴 User *${user.firstName}* (\`${user.telegramId}\`) is now **BANNED**.`, { parse_mode: 'Markdown' });
});

// Admin Command: /unban <id | code | @username>
bot.command('unban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: `/unban <telegram_id | access_code | @username>`', { parse_mode: 'Markdown' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isBanned = false;
  user.isSuspended = false;
  await user.save();

  await ctx.reply(`🟢 User *${user.firstName}* (\`${user.telegramId}\`) has been **UNBANNED / RESTORED**.`, { parse_mode: 'Markdown' });
});

// Admin Command: /suspend <id | code | @username>
bot.command('suspend', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const query = ctx.match.trim();
  if (!query) return ctx.reply('⚠️ Usage: `/suspend <telegram_id | access_code | @username>`', { parse_mode: 'Markdown' });

  const user = await findUserByQuery(query);
  if (!user) return ctx.reply('❌ User not found.');

  user.isSuspended = true;
  user.isBanned = false;
  await user.save();

  await ctx.reply(`🟡 User *${user.firstName}* (\`${user.telegramId}\`) is now **SUSPENDED**.`, { parse_mode: 'Markdown' });
});

// Admin Command: /val 888888
bot.command('val', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const codeArg = ctx.match.trim();
  if (!codeArg || codeArg.length !== 6 || isNaN(codeArg)) {
    return ctx.reply('⚠️ Please specify a valid 6-digit numeric code. Example: `/val 888888`', { parse_mode: 'Markdown' });
  }

  try {
    const existingCode = await AccessCode.findOne({ code: codeArg });
    if (existingCode) {
      return ctx.reply('⚠️ This code already exists in the database.');
    }

    await AccessCode.create({ code: codeArg, createdBy: ctx.from.id });
    await ctx.reply(`✅ *Access Code Created:* \`${codeArg}\`\nUsers can now register using \`/login ${codeArg}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('❌ Error generating access code.');
  }
});

// Admin Command: /codes
bot.command('codes', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const codes = await AccessCode.find().sort({ createdAt: -1 }).limit(20);
  if (codes.length === 0) return ctx.reply('No access codes found.');

  let message = `🔑 *Access Codes List (Latest 20):*\n━━━━━━━━━━━━━━━━━━━━\n`;
  codes.forEach(c => {
    const status = c.isUsed ? `🔴 Used (by \`${c.usedByTelegramId}\`)` : `🟢 Unused`;
    message += `• Code: \`${c.code}\` | ${status}\n`;
  });

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Admin Command: /addpoints <id|code|username> <amount>
bot.command('addpoints', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const args = ctx.match.trim().split(' ');
  const targetQuery = args[0];
  const amount = Number(args[1]);

  if (!targetQuery || isNaN(amount)) {
    return ctx.reply('⚠️ Usage: `/addpoints <user_id|code|@username> <amount>`\nExample: `/addpoints 123456789 500`', { parse_mode: 'Markdown' });
  }

  const user = await findUserByQuery(targetQuery);
  if (!user) return ctx.reply('❌ User not found.');

  user.points += amount;
  await user.save();

  await ctx.reply(`✅ Added *${amount} points* to *${user.firstName}* (\`${user.telegramId}\`).\nNew Balance: *${user.points} points*`, { parse_mode: 'Markdown' });
});

// Admin Command: /removepoints <id|code|username> <amount>
bot.command('removepoints', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const args = ctx.match.trim().split(' ');
  const targetQuery = args[0];
  const amount = Number(args[1]);

  if (!targetQuery || isNaN(amount)) {
    return ctx.reply('⚠️ Usage: `/removepoints <user_id|code|@username> <amount>`\nExample: `/removepoints 123456789 200`', { parse_mode: 'Markdown' });
  }

  const user = await findUserByQuery(targetQuery);
  if (!user) return ctx.reply('❌ User not found.');

  user.points = Math.max(0, user.points - amount);
  await user.save();

  await ctx.reply(`✅ Deducted *${amount} points* from *${user.firstName}* (\`${user.telegramId}\`).\nNew Balance: *${user.points} points*`, { parse_mode: 'Markdown' });
});

// Admin Command: /broadcast <message>
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const broadcastMsg = ctx.match.trim();
  if (!broadcastMsg) return ctx.reply('⚠️ Usage: `/broadcast <your message here>`', { parse_mode: 'Markdown' });

  const users = await User.find({ isBanned: false }, 'telegramId');
  let successCount = 0;

  for (const u of users) {
    try {
      await bot.api.sendMessage(u.telegramId, `📢 *ANNOUNCEMENT*\n\n${broadcastMsg}`, { parse_mode: 'Markdown' });
      successCount++;
    } catch (e) {
      // User blocked bot or invalid ID
    }
  }

  await ctx.reply(`✅ Broadcast sent to *${successCount}/${users.length}* active users.`, { parse_mode: 'Markdown' });
});

// --- USER COMMANDS & BUTTON HANDLERS ---

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

// Handle "My Profile" Button
bot.callbackQuery('btn_profile', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

  await ctx.answerCallbackQuery();
  await ctx.reply(formatUserInfo(user), { parse_mode: 'Markdown' });
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
