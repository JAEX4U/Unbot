// ads.js
const { InlineKeyboard } = require('grammy');
const { User } = require('./models');

// ⚙️ Configurable Reward for viewing/clicking ads
const AD_REWARD_POINTS = 50;

// Temporary in-memory ad storage (Can be linked to database later)
let activeAds = [
  {
    id: 'ad_001',
    title: '🚀 Join Our Official Community!',
    description: 'Get exclusive daily rewards and updates by joining our news channel.',
    buttonText: '📢 Visit Channel',
    targetUrl: 'https://t.me/Unlab02_Channel',
    reward: AD_REWARD_POINTS,
  }
];

function setupAdCommands(bot, ADMIN_IDS = []) {

  // 📺 User Command: /ads (View Sponsored Ads Hub)
  bot.command('ads', async (ctx) => {
    if (activeAds.length === 0) {
      return ctx.reply('📺 No sponsored ads available at the moment. Check back later!');
    }

    const user = await User.findOne({ telegramId: ctx.from.id });
    const completed = user?.completedTasks || [];

    let text = `📺 <b>SPONSORED ADS & REWARDS</b>\n━━━━━━━━━━━━━━━━━━━━\nView sponsored ads and earn bonus points!\n\n`;

    const keyboard = new InlineKeyboard();

    activeAds.forEach((ad) => {
      const isClaimed = completed.includes(`ad_${ad.id}`);
      const statusIcon = isClaimed ? '✅' : '🎁';
      text += `${statusIcon} <b>${ad.title}</b> (+${ad.reward} pts)\n${ad.description}\n\n`;

      if (!isClaimed) {
        keyboard.text(`📢 View: ${ad.title.slice(0, 18)}...`, `view_ad_${ad.id}`).row();
      }
    });

    keyboard.text('🔙 Back to Main Menu', 'btn_back');

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // 👁️ Callback: View Specific Ad Details
  bot.callbackQuery(/^view_ad_(.+)$/, async (ctx) => {
    const adId = ctx.match[1];
    const ad = activeAds.find((a) => a.id === adId);

    if (!ad) {
      return ctx.answerCallbackQuery({ text: '❌ Ad not found or expired.', show_alert: true }).catch(() => {});
    }

    const user = await User.findOne({ telegramId: ctx.from.id });
    const isClaimed = user?.completedTasks?.includes(`ad_${ad.id}`);

    const message = 
      `📢 <b>SPONSORED AD</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>${ad.title}</b>\n\n` +
      `${ad.description}\n\n` +
      `🪙 <b>Reward:</b> +${ad.reward} Points`;

    const keyboard = new InlineKeyboard()
      .url(ad.buttonText, ad.targetUrl)
      .row();

    if (!isClaimed) {
      keyboard.text('✅ Claim Reward', `claim_ad_${ad.id}`).row();
    }
    keyboard.text('🔙 Back to Ads', 'menu_ads_back');

    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
  });

  // 🔙 Callback: Return to Ads List
  bot.callbackQuery('menu_ads_back', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const user = await User.findOne({ telegramId: ctx.from.id });
    const completed = user?.completedTasks || [];

    let text = `📺 <b>SPONSORED ADS & REWARDS</b>\n━━━━━━━━━━━━━━━━━━━━\nView sponsored ads and earn bonus points!\n\n`;
    const keyboard = new InlineKeyboard();

    activeAds.forEach((ad) => {
      const isClaimed = completed.includes(`ad_${ad.id}`);
      const statusIcon = isClaimed ? '✅' : '🎁';
      text += `${statusIcon} <b>${ad.title}</b> (+${ad.reward} pts)\n${ad.description}\n\n`;

      if (!isClaimed) {
        keyboard.text(`📢 View: ${ad.title.slice(0, 18)}...`, `view_ad_${ad.id}`).row();
      }
    });

    keyboard.text('🔙 Back to Main Menu', 'btn_back');
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
  });

  // 🎁 Callback: Claim Reward for Viewing Ad
  bot.callbackQuery(/^claim_ad_(.+)$/, async (ctx) => {
    const adId = ctx.match[1];
    const ad = activeAds.find((a) => a.id === adId);

    if (!ad) {
      return ctx.answerCallbackQuery({ text: '❌ Ad expired or invalid.', show_alert: true }).catch(() => {});
    }

    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) {
      return ctx.answerCallbackQuery({ text: '❌ User record not found.', show_alert: true }).catch(() => {});
    }

    const taskId = `ad_${ad.id}`;
    if (user.completedTasks && user.completedTasks.includes(taskId)) {
      return ctx.answerCallbackQuery({ text: '⚠️ You already claimed this reward!', show_alert: true }).catch(() => {});
    }

    user.points += ad.reward;
    user.completedTasks.push(taskId);
    await user.save();

    await ctx.answerCallbackQuery({ text: `🎉 Claimed +${ad.reward} Points!`, show_alert: true }).catch(() => {});

    await ctx.editMessageText(
      `🎉 <b>REWARD CLAIMED!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `You earned <b>+${ad.reward} Points</b> for viewing the sponsored ad.\n\n` +
      `🪙 <b>New Balance:</b> ${user.points} Points`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Main Menu', 'btn_back') }
    ).catch(() => {});
  });

  // 📢 Admin Broadcast Command: /postad <Message>
  bot.command('postad', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const adContent = ctx.match ? ctx.match.trim() : '';
    if (!adContent) {
      return ctx.reply('⚠️ Usage: <code>/postad <Your Sponsored Broadcast Message></code>', { parse_mode: 'HTML' });
    }

    const users = await User.find({ isBanned: false });
    let sentCount = 0;

    await ctx.reply(`⏳ Broadcasting ad to ${users.length} active users...`);

    for (const user of users) {
      try {
        await bot.api.sendMessage(
          user.telegramId,
          `📢 <b>SPONSORED ANNOUNCEMENT</b>\n━━━━━━━━━━━━━━━━━━━━\n${adContent}`,
          { parse_mode: 'HTML' }
        );
        sentCount++;
        // Rate limiting buffer to stay safe under Telegram's 30 msg/sec limit
        await new Promise((res) => setTimeout(res, 40));
      } catch (e) {
        // Ignored if recipient blocked the bot or has invalid chat ID
      }
    }

    await ctx.reply(`✅ Broadcast complete! Successfully delivered to ${sentCount}/${users.length} users.`);
  });
}

module.exports = { setupAdCommands };
