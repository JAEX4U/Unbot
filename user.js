// user.js
const { InlineKeyboard } = require('grammy');
const { User, AccessCode } = require('./models');

// Helper: Main Menu Inline Keyboard
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .row()
    .text('🎁 Daily Bonus', 'btn_daily')
    .text('👥 Referral Link', 'btn_referral')
    .row()
    .text('❓ Help', 'btn_help');
}

// Helper: Back Button Keyboard
function getBackKeyboard() {
  return new InlineKeyboard().text('🔙 Back to Main Menu', 'btn_back');
}

// Helper: Format User Profile Details
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

function setupUserCommands(bot, findUserByQuery) {
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

  // Public Command: /info
  bot.command('info', async (ctx) => {
    const query = ctx.match.trim();

    if (!query) {
      const selfUser = await User.findOne({ telegramId: ctx.from.id });
      if (!selfUser) return ctx.reply('⚠️ Please provide an Access Code, Telegram ID, or Username.\nExample: <code>/info 888888</code> or <code>/info @username</code>', { parse_mode: 'HTML' });
      return ctx.reply(formatUserInfo(selfUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
    }

    const targetUser = await findUserByQuery(query);
    if (!targetUser) {
      return ctx.reply('❌ User not found in database.', { parse_mode: 'HTML' });
    }

    await ctx.reply(formatUserInfo(targetUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
  });

  // User Command: /login
  bot.command('login', async (ctx) => {
    const codeInput = ctx.match.trim();

    if (!codeInput || codeInput.length !== 6) {
      return ctx.reply('⚠️ Usage: Send <code>/login &lt;6-digit-code&gt;</code>. Example: <code>/login 888888</code>', { parse_mode: 'HTML' });
    }

    let user = await User.findOne({ telegramId: ctx.from.id });
    if (user) {
      return ctx.reply(`✅ You are already logged in with code <code>${user.accessCode}</code>!`, {
        parse_mode: 'HTML',
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
      `🎉 <b>Welcome to the Bot, ${fullName}!</b>\n\n` +
      `Your account has been created and saved to the database.\n` +
      `👤 <b>Username:</b> @${user.username}\n` +
      `🆔 <b>ID (Access Code):</b> <code>${user.accessCode}</code>\n` +
      `📲 <b>Telegram ID:</b> <code>${user.telegramId}</code>\n` +
      `🪙 <b>Starting Balance:</b> ${user.points} points\n\n` +
      `Choose an option below:`,
      {
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard()
      }
    );
  });

  // Handle "My Profile" Button
  bot.callbackQuery('btn_profile', async (ctx) => {
    try {
      const user = await User.findOne({ telegramId: Number(ctx.from.id) });
      if (!user) {
        await ctx.answerCallbackQuery({ text: '❌ Account not found. Please log in using /login <code> first.', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatUserInfo(user), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
    } catch (err) {
      console.error('Error in btn_profile handler:', err);
      await ctx.answerCallbackQuery({ text: '⚠️ An error occurred.', show_alert: true }).catch(() => {});
    }
  });

  // Handle "Back to Main Menu" Button
  bot.callbackQuery('btn_back', async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
      const fullName = ctx.from.first_name || 'User';
      await ctx.editMessageText(`Welcome back, ${fullName}! 👋\nSelect an option from the menu below:`, { reply_markup: getMainMenuKeyboard() });
    } catch (err) {
      console.error('Error in btn_back handler:', err);
    }
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
    await ctx.reply(`🎁 You claimed <b>50 daily points</b>! New Balance: <b>${user.points} points</b>`, { parse_mode: 'HTML' });
  });

  // Handle "Referral Link" Button
  bot.callbackQuery('btn_referral', async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });

    const botInfo = await bot.api.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

    await ctx.answerCallbackQuery();
    await ctx.reply(`👥 <b>Your Referral Link:</b>\n<code>${refLink}</code>\n\nShare this link to earn bonus points when friends join!`, {
      parse_mode: 'HTML',
      reply_markup: getBackKeyboard()
    });
  });

  // Handle "Help" Button
  bot.callbackQuery('btn_help', async (ctx) => {
    try {
      await ctx.answerCallbackQuery();

      const helpText = 
        `❓ <b>HELP & COMMANDS GUIDE</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔑 <code>/login &lt;code&gt;</code> - Sign in with your 6-digit access code\n` +
        `ℹ️ <code>/info</code> - View your profile details\n` +
        `ℹ️ <code>/info &lt;id|code|@user&gt;</code> - View public details for a specific user\n\n` +
        `💡 <b>Features:</b>\n` +
        `• <b>My Profile:</b> View your account info, points balance, and access code.\n` +
        `• <b>Daily Bonus:</b> Claim free daily points once every 24 hours.\n` +
        `• <b>Referral Link:</b> Invite friends to earn extra rewards.\n\n` +
        `📩 Need assistance? Contact admin support: <a href="https://t.me/dinos_service">@dinos_service</a>`;

      await ctx.editMessageText(helpText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: getBackKeyboard()
      });
    } catch (err) {
      console.error('Error in btn_help handler:', err);
      await ctx.answerCallbackQuery({ text: '⚠️ An error occurred.', show_alert: true }).catch(() => {});
    }
  });
}

module.exports = { setupUserCommands };
