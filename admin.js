// admin.js
const adminId = Number(process.env.ADMIN_TELEGRAM_ID || 0);

// Helper middleware to check admin authorization
function isAdmin(ctx) {
  if (ctx.from.id !== adminId && adminId !== 0) {
    ctx.reply('❌ Unauthorized: Admin access only.');
    return false;
  }
  return true;
}

// Function to attach all admin commands to the bot
function setupAdminCommands(bot, models, findUserByQuery) {
  const { User, AccessCode } = models;

  // Admin Dashboard: /admin
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

  // Admin Command: /ban
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

  // Admin Command: /unban
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

  // Admin Command: /suspend
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

  // Admin Command: /val <6-digit-code>
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

  // Admin Command: /addpoints
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

  // Admin Command: /removepoints
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

  // Admin Command: /broadcast
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
