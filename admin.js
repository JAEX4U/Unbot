// admin.js
const mongoose = require('mongoose');
const { User, AccessCode } = require('./models');

const adminId = Number(process.env.ADMIN_TELEGRAM_ID || 0);

// --- AD CAMPAIGN SCHEMA & MODEL ---
const adCampaignSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  createdBy: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'active', 'completed'], default: 'active' },
  sentCount: { type: Number, default: 0 },
  totalTargeted: { type: Number, default: 0 }
}, { timestamps: true });

const AdCampaign = mongoose.models.AdCampaign || mongoose.model('AdCampaign', adCampaignSchema);

// Helper middleware to check admin authorization
function isAdmin(ctx) {
  if (ctx.from.id !== adminId && adminId !== 0) {
    ctx.reply('❌ Unauthorized: Admin access only.');
    return false;
  }
  return true;
}

// Function to attach all admin commands to the bot
function setupAdminCommands(bot, findUserByQuery) {

  // 🛠️ Admin Dashboard: /admin
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const totalUsers = await User.countDocuments();
    const totalCodes = await AccessCode.countDocuments();
    const unusedCodes = await AccessCode.countDocuments({ isUsed: false });
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const suspendedUsers = await User.countDocuments({ isSuspended: true });
    const totalAds = await AdCampaign.countDocuments();

    const adminText = 
      `🛠️ <b>ADMIN PANEL DASHBOARD</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>Total Users:</b> ${totalUsers}\n` +
      `🔴 <b>Banned:</b> ${bannedUsers} | 🟡 <b>Suspended:</b> ${suspendedUsers}\n` +
      `🔑 <b>Total Codes:</b> ${totalCodes} (🟢 <b>Unused:</b> ${unusedCodes})\n` +
      `📢 <b>Ad Campaigns:</b> ${totalAds}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>User & Access Commands:</b>\n` +
      `• <code>/val &lt;6-digit-code&gt;</code> - Create access code\n` +
      `• <code>/codes</code> - View generated codes\n` +
      `• <code>/ban &lt;id|code|@user&gt;</code> - Ban a user\n` +
      `• <code>/unban &lt;id|code|@user&gt;</code> - Unban/Unsuspend user\n` +
      `• <code>/suspend &lt;id|code|@user&gt;</code> - Suspend a user\n` +
      `• <code>/addpoints &lt;id&gt; &lt;amount&gt;</code> - Add points\n` +
      `• <code>/removepoints &lt;id&gt; &lt;amount&gt;</code> - Deduct points\n` +
      `• <code>/broadcast &lt;message&gt;</code> - Send message to all\n\n` +
      `<b>📢 Ads Management Commands:</b>\n` +
      `• <code>/createad &lt;Title&gt; | &lt;Content&gt;</code> - Create & broadcast ad\n` +
      `• <code>/ads</code> - View all ad campaigns\n` +
      `• <code>/deletead &lt;ad_id&gt;</code> - Delete an ad record`;

    await ctx.reply(adminText, { parse_mode: 'HTML' });
  });

  // 📢 AD SYSTEM: Create and Broadcast Ad Campaign
  bot.command('createad', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const rawInput = ctx.match.trim();
    if (!rawInput.includes('|')) {
      return ctx.reply(
        `⚠️ <b>Invalid Format!</b>\n\n` +
        `Usage: <code>/createad &lt;Title&gt; | &lt;Ad Message Content&gt;</code>\n` +
        `Example:\n<code>/createad Special Promo | Get 50% extra points today using bonus code 9999!</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const [title, ...contentParts] = rawInput.split('|');
    const adTitle = title.trim();
    const adContent = contentParts.join('|').trim();

    if (!adTitle || !adContent) {
      return ctx.reply('⚠️ Title and Ad Content cannot be empty.');
    }

    const activeUsers = await User.find({ isBanned: false, isSuspended: false }, 'telegramId');
    
    // Save Campaign to DB
    const campaign = await AdCampaign.create({
      title: adTitle,
      content: adContent,
      createdBy: ctx.from.id,
      totalTargeted: activeUsers.length,
      status: 'active'
    });

    await ctx.reply(`🚀 Starting Ad Campaign <b>"${adTitle}"</b> to ${activeUsers.length} users...`, { parse_mode: 'HTML' });

    let successCount = 0;
    const formattedAd = `📢 <b>SPONSORED ANNOUNCEMENT</b>\n<b>${adTitle}</b>\n━━━━━━━━━━━━━━━━━━━━\n${adContent}`;

    for (const u of activeUsers) {
      try {
        await bot.api.sendMessage(u.telegramId, formattedAd, { parse_mode: 'HTML' });
        successCount++;
      } catch (e) {
        // User blocked or deactivated Telegram account
      }
    }

    campaign.sentCount = successCount;
    campaign.status = 'completed';
    await campaign.save();

    await ctx.reply(
      `✅ <b>Ad Campaign Completed!</b>\n\n` +
      `🆔 <b>Ad ID:</b> <code>${campaign._id}</code>\n` +
      `📌 <b>Title:</b> ${adTitle}\n` +
      `📊 <b>Delivered:</b> ${successCount}/${activeUsers.length} users`,
      { parse_mode: 'HTML' }
    );
  });

  // 📢 AD SYSTEM: View All Ad Campaigns
  bot.command('ads', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const campaigns = await AdCampaign.find().sort({ createdAt: -1 }).limit(10);
    if (campaigns.length === 0) {
      return ctx.reply('📢 No ad campaigns found.');
    }

    let message = `📢 <b>Recent Ad Campaigns (Latest 10):</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    campaigns.forEach(c => {
      message += 
        `🆔 <b>ID:</b> <code>${c._id}</code>\n` +
        `📌 <b>Title:</b> ${c.title}\n` +
        `📊 <b>Reach:</b> ${c.sentCount}/${c.totalTargeted} delivered\n` +
        `📅 <b>Date:</b> ${new Date(c.createdAt).toLocaleDateString()}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n`;
    });

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  // 📢 AD SYSTEM: Delete Ad Campaign Record
  bot.command('deletead', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const adId = ctx.match.trim();
    if (!adId) return ctx.reply('⚠️ Usage: <code>/deletead &lt;ad_id&gt;</code>', { parse_mode: 'HTML' });

    try {
      const deleted = await AdCampaign.findByIdAndDelete(adId);
      if (!deleted) return ctx.reply('❌ Ad campaign ID not found.');
      await ctx.reply(`🗑️ Ad campaign <b>"${deleted.title}"</b> deleted successfully.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('❌ Invalid Ad ID format.');
    }
  });

  // 🔴 Ban User
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

  // 🟢 Unban User
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

  // 🟡 Suspend User
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

  // 🔑 Generate Access Code: /val 888888
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

  // 🔑 View Access Codes
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

  // 🪙 Add Points
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

  // 🪙 Deduct Points
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

  // 📢 Broadcast System Message
  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const broadcastMsg = ctx.match.trim();
    if (!broadcastMsg) return ctx.reply('⚠️ Usage: <code>/broadcast &lt;your message here&gt;</code>', { parse_mode: 'HTML' });

    const users = await User.find({ isBanned: false }, 'telegramId');
    let successCount = 0;

    for (const u of users) {
      try {
        await bot.api.sendMessage(u.telegramId, `📢 <b>ANNOUNCEMENT</b>\n\n${broadcastMsg}`, { parse_mode: 'HTML' });
        successCount++;
      } catch (e) {
        // User blocked bot
      }
    }

    await ctx.reply(`✅ Broadcast sent to <b>${successCount}/${users.length}</b> active users.`, { parse_mode: 'HTML' });
  });
}

module.exports = { setupAdminCommands };
