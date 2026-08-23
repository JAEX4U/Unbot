// user.js
const { InlineKeyboard } = require('grammy');
const axios = require('axios');
const { User, AccessCode } = require('./models');

// Adsgram Block ID from Environment (or Fallback Key)
const ADSGRAM_BLOCK_ID = process.env.ADSGRAM_BLOCK_ID || '68a57a654a6d416e814783af7a685817';

// Cooldown tracker for watching ads (Prevents spam)
const userAdCooldowns = new Map();
const AD_COOLDOWN_MS = 60 * 1000; // 1-minute cooldown between watch-ad tasks

// 🌐 Adsgram API Helper: Fetch dynamic banners / offers
async function fetchAdsgramAd(telegramId, type = 'banner') {
  try {
    const response = await axios.get('https://api.adsgram.ai/adv', {
      params: { 
        blockId: ADSGRAM_BLOCK_ID, 
        tgid: telegramId,
        type: type 
      },
      timeout: 3000
    });

    if (response.data && response.data.banner) {
      return {
        id: response.data.banner.id || 'adsgram_ad',
        title: response.data.banner.title || response.data.banner.text || 'Sponsored Offer',
        reward: response.data.banner.rewardPoints || 50,
        link: response.data.banner.link
      };
    }
    return null;
  } catch (error) {
    return null; // Silently handle timeout or no fill
  }
}

// 🔘 Helper: Main Menu Inline Keyboard
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .text('💰 Earn Rewards', 'menu_earn')
    .row()
    .text('🎁 Daily Bonus', 'btn_daily')
    .text('👥 Referral Link', 'btn_referral')
    .row()
    .text('❓ Help', 'btn_help');
}

// 🔘 Helper: Back Button Keyboard
function getBackKeyboard() {
  return new InlineKeyboard().text('🔙 Back to Main Menu', 'btn_back');
}

// 🔘 Helper: Back to Earn Menu Keyboard
function getEarnBackKeyboard() {
  return new InlineKeyboard().text('🔙 Back to Earn Menu', 'menu_earn');
}

// 👤 Helper: Format User Profile Details
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

  // Command & Callback: /earn or Earn Menu Button
  const handleEarnMenu = async (ctx) => {
    const message = 
      `💰 <b>EARN REWARDS CENTER</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Choose a section below to earn extra points:\n\n` +
      `🎯 <b>Tasks:</b> Watch Adsgram ads & daily check-ins.\n` +
      `📋 <b>Offers:</b> Complete external partner campaigns and Adsgram offers.\n` +
      `👥 <b>Referral:</b> Invite friends to earn bonus points.`;

    const keyboard = new InlineKeyboard()
      .text('🎯 Tasks', 'earn_tasks')
      .text('📋 Offers', 'earn_offers')
      .row()
      .text('👥 Refer & Earn', 'earn_referral')
      .row()
      .text('🔙 Main Menu', 'btn_back');

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  };

  bot.command('earn', handleEarnMenu);
  bot.callbackQuery('menu_earn', handleEarnMenu);

  // 🎯 CALLBACK: Tasks Sub-Menu
  bot.callbackQuery('earn_tasks', async (ctx) => {
    await ctx.answerCallbackQuery();

    const message = 
      `🎯 <b>AVAILABLE TASKS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `1. <b>Watch Adsgram Ad:</b> Earn +25 Points per ad view.\n` +
      `2. <b>Daily Bonus:</b> Earn +50 Points once every 24 hours.\n\n` +
      `Select a task below:`;

    const keyboard = new InlineKeyboard()
      .text('📺 Watch Sponsored Ad (+25 pts)', 'task_watch_ad')
      .row()
      .text('🎁 Daily Claim (+50 pts)', 'btn_daily')
      .row()
      .text('🔙 Back to Earn Menu', 'menu_earn');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // 📺 ACTION: Watch Sponsored Ad Task
  bot.callbackQuery('task_watch_ad', async (ctx) => {
    const telegramId = ctx.from.id;
    const now = Date.now();

    // Check Cooldown
    const lastWatch = userAdCooldowns.get(telegramId) || 0;
    if (now - lastWatch < AD_COOLDOWN_MS) {
      const remainingSecs = Math.ceil((AD_COOLDOWN_MS - (now - lastWatch)) / 1000);
      return ctx.answerCallbackQuery({ 
        text: `⏳ Please wait ${remainingSecs} seconds before watching another ad!`, 
        show_alert: true 
      });
    }

    await ctx.answerCallbackQuery('Fetching Adsgram offer...');

    const user = await User.findOne({ telegramId });
    if (!user) return ctx.reply('❌ User record not found.');

    const ad = await fetchAdsgramAd(telegramId, 'banner');

    // Update cooldown & grant points
    userAdCooldowns.set(telegramId, now);
    const rewardPoints = 25;
    user.points += rewardPoints;
    await user.save();

    let responseText = `✅ <b>Task Completed!</b>\n` +
      `You earned <b>+${rewardPoints} Points</b>!\n` +
      `New Balance: <b>${user.points} Points</b>`;

    const keyboard = new InlineKeyboard();

    if (ad) {
      responseText += `\n\n━━━━━━━━━━━━━━━━━━━━\n📢 <b>Sponsored Ad:</b>\n${ad.title}`;
      if (ad.link) {
        keyboard.url('👉 Visit Sponsor', ad.link).row();
      }
    }
    keyboard.text('🔙 Back to Earn Menu', 'menu_earn');

    await ctx.reply(responseText, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // 📋 CALLBACK: Offers Sub-Menu (Adsgram Offers + Custom Offers)
  bot.callbackQuery('earn_offers', async (ctx) => {
    const telegramId = ctx.from.id;
    await ctx.answerCallbackQuery('Loading Adsgram offers...');

    // Fetch Adsgram CPA Task Offer
    const adsgramOffer = await fetchAdsgramAd(telegramId, 'task');

    let message = 
      `📋 <b>SPECIAL OFFERS & CAMPAIGNS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Complete offers below to earn high-tier point rewards:\n\n`;

    const keyboard = new InlineKeyboard();

    // 1. Dynamic Adsgram Offer Section
    if (adsgramOffer) {
      message += `🔥 <b>[Adsgram Partner Offer] ${adsgramOffer.title}</b>\n` +
                 `🎁 Reward: <b>+${adsgramOffer.reward} Points</b>\n\n`;

      if (adsgramOffer.link) {
        keyboard.url(`🚀 Open Offer (+${adsgramOffer.reward} pts)`, adsgramOffer.link).row();
      }
      keyboard.text('✅ Verify & Claim Reward', `verify_adsgram_offer_${adsgramOffer.reward}`).row();
    } else {
      message += `⚡ <i>No sponsored Adsgram tasks active right now. Check back soon!</i>\n\n`;
    }

    // 2. Static Direct Offers
    message += `<b>Featured Direct Offers:</b>\n` +
      `• Join Partner Channel (+100 Points)\n` +
      `• Register on Crypto Exchange (+500 Points)`;

    keyboard
      .url('📢 Join Partner Channel (+100 pts)', 'https://t.me/YourChannelLink').row()
      .url('💎 Register Exchange (+500 pts)', 'https://bybit.com/register?ref=YOUR_REF').row()
      .text('🔙 Back to Earn Menu', 'menu_earn');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // ✅ CALLBACK: Verify Adsgram Offer
  bot.callbackQuery(/^verify_adsgram_offer_(\d+)$/, async (ctx) => {
    const telegramId = ctx.from.id;
    const rewardPoints = Number(ctx.match[1]) || 50;

    const user = await User.findOne({ telegramId });
    if (!user) return ctx.answerCallbackQuery({ text: '❌ User not found.', show_alert: true });

    user.points += rewardPoints;
    await user.save();

    await ctx.answerCallbackQuery({ text: `🎉 Verified! +${rewardPoints} points claimed!`, show_alert: true });

    await ctx.reply(
      `✅ <b>Adsgram Offer Verified!</b>\n\n` +
      `You earned <b>+${rewardPoints} Points</b>.\n` +
      `New Balance: <b>${user.points} Points</b>`,
      { parse_mode: 'HTML', reply_markup: getEarnBackKeyboard() }
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

    // Optionally fetch Adsgram Ad to display on claim
    const ad = await fetchAdsgramAd(ctx.from.id, 'banner');
    let message = `🎁 You claimed <b>50 daily points</b>!\nNew Balance: <b>${user.points} points</b>`;

    const keyboard = new InlineKeyboard();
    if (ad) {
      message += `\n\n━━━━━━━━━━━━━━━━━━━━\n📢 <b>Sponsored:</b>\n${ad.title}`;
      if (ad.link) keyboard.url('👉 View Sponsor', ad.link).row();
    }
    keyboard.text('🔙 Main Menu', 'btn_back');

    await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // Handle "Referral Link" Button
  const handleReferral = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) {
      if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text: 'Please log in first using /login <code>' });
      return ctx.reply('Please log in first using /login <code>');
    }

    const botInfo = await bot.api.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

    const message = 
      `👥 <b>Your Referral Link:</b>\n` +
      `<code>${refLink}</code>\n\n` +
      `Share this link to earn bonus points when friends join!`;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: getEarnBackKeyboard() });
    } else {
      await ctx.reply(message, { parse_mode: 'HTML', reply_markup: getEarnBackKeyboard() });
    }
  };

  bot.callbackQuery('btn_referral', handleReferral);
  bot.callbackQuery('earn_referral', handleReferral);

  // Handle "Help" Button
  bot.callbackQuery('btn_help', async (ctx) => {
    try {
      await ctx.answerCallbackQuery();

      const helpText = 
        `❓ <b>HELP & COMMANDS GUIDE</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔑 <code>/login &lt;code&gt;</code> - Sign in with your 6-digit access code\n` +
        `ℹ️ <code>/info</code> - View your profile details\n` +
        `💰 <code>/earn</code> - Open the Rewards & Offers Center\n` +
        `📢 <code>/advertise</code> - Contact admin to purchase direct ads\n\n` +
        `💡 <b>Features:</b>\n` +
        `• <b>My Profile:</b> View your account info, points balance, and access code.\n` +
        `• <b>Earn Rewards:</b> Complete Adsgram tasks, watch ads, and perform offer campaigns.\n` +
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

  // Direct Ad Sales Command
  bot.command('advertise', async (ctx) => {
    const adMessage = 
      `📢 <b>ADVERTISE WITH US</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Promote your channel, product, or bot to our active user base!\n\n` +
      `⚡ <b>Why advertise here?</b>\n` +
      `• Direct inbox notification to all active users\n` +
      `• High engagement & real user clicks\n` +
      `• Instant broadcast delivery\n\n` +
      `💳 <b>Accepted Payments:</b> USDT, TON, Crypto Bot (@send)\n\n` +
      `📩 <b>Contact Admin to Buy:</b> <a href="https://t.me/dinos_service">@dinos_service</a>`;

    await ctx.reply(adMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
  });
}

module.exports = { setupUserCommands };
