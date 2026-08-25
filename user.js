const { InlineKeyboard } = require('grammy');
const { User, AccessCode } = require('./models');

// 📢 Channel & Group Configuration for Community Tasks
const SPONSOR_CHANNEL = '@Unlab02_Channel'; // Replace with your actual channel
const SPONSOR_GROUP = '@Unlab02_Group';     // Replace with your actual group
const TASK_REWARD_POINTS = 100;

// ⚙️ Transfer Tax Fee (5 = 5% tax fee on transfers)
const TRANSFER_TAX_PERCENT = 5;

// 🔑 Unique Code Generator (Reserves 000001 - 000015 for Admin Agent Codes)
async function generateUniqueAccessCode(AccessCodeModel, UserModel) {
  let isUnique = false;
  let newCode = '';

  while (!isUnique) {
    const randomNumber = Math.floor(Math.random() * (999999 - 16 + 1)) + 16;
    newCode = randomNumber.toString().padStart(6, '0');

    const [existingCode, existingUser] = await Promise.all([
      AccessCodeModel.findOne({ code: newCode }),
      UserModel.findOne({ accessCode: newCode }),
    ]);

    if (!existingCode && !existingUser) {
      isUnique = true;
    }
  }
  return newCode;
}

// 🔘 Navigation Keyboards
function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👤 My Profile', 'btn_profile')
    .text('💰 Earn Rewards', 'menu_earn')
    .row()
    .text('💸 Send Points', 'menu_transfer')
    .text('🎁 Daily Bonus', 'btn_daily')
    .row()
    .text('👥 Referral Link', 'btn_referral')
    .text('❓ Help', 'btn_help');
}

function getBackKeyboard() {
  return new InlineKeyboard().text('🔙 Back to Main Menu', 'btn_back');
}

function getEarnBackKeyboard() {
  return new InlineKeyboard().text('🔙 Back to Earn Menu', 'menu_earn');
}

// 👤 Helper: Profile Formatter
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
         `🔑 <b>Access Code:</b> <code>${user.accessCode}</code>\n` +
         `📲 <b>Telegram ID:</b> <code>${user.telegramId}</code>\n` +
         `🏷️ <b>Username:</b> ${usernameDisplay}\n` +
         `🪙 <b>Points Balance:</b> <b>${user.points} points</b>\n` +
         `📊 <b>Status:</b> ${statusText}\n` +
         `📅 <b>Registered:</b> ${registeredDate}\n` +
         `━━━━━━━━━━━━━━━━━━━━`;
}

function setupUserCommands(bot, findUserByQuery) {

  // Command: /start (Auto Registration with Collision & Range Check)
  bot.command('start', async (ctx) => {
    let user = await User.findOne({ telegramId: ctx.from.id });

    if (user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
      return ctx.reply(`Welcome back, ${fullName}! 👋\nSelect an option from the menu below:`, { reply_markup: getMainMenuKeyboard() });
    }

    // Generate unique code starting from 000016 upwards
    const generatedCode = await generateUniqueAccessCode(AccessCode, User);

    await AccessCode.create({
      code: generatedCode,
      isUsed: true,
      usedByTelegramId: ctx.from.id,
      isAgentCode: false
    });

    user = await User.create({
      telegramId: ctx.from.id,
      username: ctx.from.username || 'No Username',
      firstName: ctx.from.first_name || '',
      lastName: ctx.from.last_name || '',
      points: 100,
      accessCode: generatedCode,
      completedTasks: []
    });

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';

    await ctx.reply(
      `🎉 <b>Welcome to the Bot, ${fullName}!</b>\n\n` +
      `Your account has been created!\n` +
      `🔑 <b>Your Access Code:</b> <code>${generatedCode}</code>\n` +
      `🪙 <b>Starting Balance:</b> ${user.points} points\n\n` +
      `Choose an option below:`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  });

  // Command: /info
  bot.command('info', async (ctx) => {
    const query = ctx.match ? ctx.match.trim() : '';
    if (!query) {
      const selfUser = await User.findOne({ telegramId: ctx.from.id });
      if (!selfUser) return ctx.reply('⚠️ User profile not found.', { parse_mode: 'HTML' });
      return ctx.reply(formatUserInfo(selfUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
    }

    const targetUser = await findUserByQuery(query);
    if (!targetUser) return ctx.reply('❌ User not found in database.', { parse_mode: 'HTML' });

    await ctx.reply(formatUserInfo(targetUser), { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
  });

  // 💸 Transfer Points Menu Guide
  const handleTransferMenu = async (ctx) => {
    const text = 
      `💸 <b>POINT TRANSFER SYSTEM</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Send points directly to any registered user using their <b>Access Code</b> or <b>Telegram ID</b>.\n\n` +
      `🏷️ <b>Transfer Tax Fee:</b> <code>${TRANSFER_TAX_PERCENT}%</code>\n\n` +
      `📌 <b>Command Format:</b>\n` +
      `<code>/transfer <Recipient Code/ID> <Amount></code>\n\n` +
      `💡 <b>Examples:</b>\n` +
      `• <code>/transfer 000005 100</code>\n` +
      `• <code>/transfer 123456789 500</code>`;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: getBackKeyboard() }).catch(() => {});
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
    }
  };

  bot.callbackQuery('menu_transfer', handleTransferMenu);

  // 💸 Command: /transfer <target> <amount> (P2P Transfer with Tax)
  bot.command('transfer', async (ctx) => {
    const sender = await User.findOne({ telegramId: ctx.from.id });
    if (!sender) return ctx.reply('❌ Please complete registration first with /start.');
    if (sender.isBanned || sender.isSuspended) return ctx.reply('❌ Your account is currently restricted.');

    const args = ctx.match ? ctx.match.trim().split(/\s+/) : [];
    const targetQuery = args[0];
    const amount = Number(args[1]);

    if (!targetQuery || isNaN(amount) || amount <= 0) {
      return ctx.reply(
        `⚠️ <b>Invalid Command Format!</b>\n\n` +
        `Usage: <code>/transfer <Recipient Code/ID> <Amount></code>\n` +
        `Example: <code>/transfer 000005 100</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const recipient = await findUserByQuery(targetQuery);
    if (!recipient) {
      return ctx.reply('❌ Recipient user not found. Please verify the code or ID.');
    }

    if (recipient.telegramId === sender.telegramId) {
      return ctx.reply('❌ You cannot transfer points to yourself.');
    }

    const grossAmount = Math.floor(amount);
    const taxFee = Math.ceil((grossAmount * TRANSFER_TAX_PERCENT) / 100);
    const netReceived = grossAmount - taxFee;

    if (netReceived <= 0) {
      return ctx.reply(`❌ Transfer amount is too low after the ${TRANSFER_TAX_PERCENT}% tax fee.`);
    }

    if (sender.points < grossAmount) {
      return ctx.reply(`❌ <b>Insufficient Balance!</b>\nYour Balance: <b>${sender.points} points</b>`, { parse_mode: 'HTML' });
    }

    sender.points -= grossAmount;
    recipient.points += netReceived;

    await sender.save();
    await recipient.save();

    await ctx.reply(
      `✅ <b>Transfer Successful!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Sent To:</b> ${recipient.firstName} (<code>${recipient.accessCode}</code>)\n` +
      `🪙 <b>Gross Amount:</b> ${grossAmount} pts\n` +
      `🏷️ <b>Tax Fee (${TRANSFER_TAX_PERCENT}%):</b> -${taxFee} pts\n` +
      `📥 <b>Net Delivered:</b> ${netReceived} pts\n` +
      `💰 <b>Your New Balance:</b> ${sender.points} pts`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );

    try {
      await bot.api.sendMessage(
        recipient.telegramId,
        `🎉 <b>POINTS RECEIVED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>From:</b> ${sender.firstName} (<code>${sender.accessCode}</code>)\n` +
        `📥 <b>Received:</b> +${netReceived} pts\n` +
        `💰 <b>New Balance:</b> ${recipient.points} pts`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      // Recipient blocked bot or chat unavailable
    }
  });

  // 💰 Earn Rewards Hub
  const handleEarnMenu = async (ctx) => {
    const message = 
      `💰 <b>EARN REWARDS CENTER</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Complete community tasks or invite friends to earn instant point rewards:\n\n` +
      `🎯 <b>Tasks:</b> Join Official Channel & Group.\n` +
      `👥 <b>Referral:</b> Invite friends for bonus points.`;

    const keyboard = new InlineKeyboard()
      .text('🎯 Tasks', 'earn_tasks')
      .row()
      .text('👥 Refer & Earn', 'earn_referral')
      .row()
      .text('🔙 Main Menu', 'btn_back');

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    } else {
      await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  };

  bot.command('earn', handleEarnMenu);
  bot.callbackQuery('menu_earn', handleEarnMenu);

  // 🎯 CALLBACK: Tasks Sub-Menu
  bot.callbackQuery('earn_tasks', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const user = await User.findOne({ telegramId: ctx.from.id });
    const completed = user?.completedTasks || [];

    const channelDone = completed.includes(`join_${SPONSOR_CHANNEL.toLowerCase()}`) ? '✅' : '🔴';
    const groupDone = completed.includes(`join_${SPONSOR_GROUP.toLowerCase()}`) ? '✅' : '🔴';

    const message = 
      `🎯 <b>AVAILABLE COMMUNITY TASKS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Join our official channel and group to earn free points:\n\n` +
      `${channelDone} 1. 📢 <b>Join Official Channel</b> (+${TASK_REWARD_POINTS} pts)\n` +
      `${groupDone} 2. 💬 <b>Join Official Group</b> (+${TASK_REWARD_POINTS} pts)\n`;

    const keyboard = new InlineKeyboard()
      .text(`${channelDone} Join Channel Task`, 'task_channel_details').row()
      .text(`${groupDone} Join Group Task`, 'task_group_details').row()
      .text('🔙 Back to Earn Menu', 'menu_earn');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
  });

  // 📢 TASK 1: Channel Task
  bot.callbackQuery('task_channel_details', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const user = await User.findOne({ telegramId: ctx.from.id });
    const taskId = `join_${SPONSOR_CHANNEL.toLowerCase()}`;
    const isCompleted = user?.completedTasks?.includes(taskId);

    const statusText = isCompleted ? '✅ <b>Status:</b> Completed' : '❌ <b>Status:</b> Not Completed';

    const message = 
      `📢 <b>TASK: Join Official Channel</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Join ${SPONSOR_CHANNEL} to claim <b>+${TASK_REWARD_POINTS} Points</b>.\n\n` +
      `${statusText}\n\n` +
      `<i>Click "Verify Channel" after joining.</i>`;

    const keyboard = new InlineKeyboard();
    if (!isCompleted) {
      keyboard.url('📢 Join Channel', `https://t.me/${SPONSOR_CHANNEL.replace('@', '')}`).row();
      keyboard.text('🔄 Verify Channel', 'verify_channel').row();
    }
    keyboard.text('🔙 Back to Tasks', 'earn_tasks');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery('verify_channel', async (ctx) => {
    const telegramId = ctx.from.id;
    const taskId = `join_${SPONSOR_CHANNEL.toLowerCase()}`;

    const user = await User.findOne({ telegramId });
    if (!user) return ctx.answerCallbackQuery({ text: '❌ User not found.', show_alert: true });

    if (user.completedTasks && user.completedTasks.includes(taskId)) {
      return ctx.answerCallbackQuery({ text: '⚠️ You have already completed this task!', show_alert: true });
    }

    try {
      const member = await bot.api.getChatMember(SPONSOR_CHANNEL, telegramId);
      if (['creator', 'administrator', 'member'].includes(member.status)) {
        user.points += TASK_REWARD_POINTS;
        user.completedTasks.push(taskId);
        await user.save();

        await ctx.answerCallbackQuery({ text: `🎉 Verified! +${TASK_REWARD_POINTS} Points added.`, show_alert: true });
        
        await ctx.editMessageText(
          `🎉 <b>TASK COMPLETED!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `You earned <b>+${TASK_REWARD_POINTS} Points</b> for joining ${SPONSOR_CHANNEL}.\n\n` +
          `🪙 <b>New Balance:</b> ${user.points} Points`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Back to Tasks', 'earn_tasks') }
        ).catch(() => {});
      } else {
        await ctx.answerCallbackQuery({ text: `❌ You haven't joined ${SPONSOR_CHANNEL} yet!`, show_alert: true });
      }
    } catch (e) {
      await ctx.answerCallbackQuery({ text: '⚠️ Unable to verify. Make sure the bot is an Admin in the channel.', show_alert: true });
    }
  });

  // 💬 TASK 2: Group Task
  bot.callbackQuery('task_group_details', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const user = await User.findOne({ telegramId: ctx.from.id });
    const taskId = `join_${SPONSOR_GROUP.toLowerCase()}`;
    const isCompleted = user?.completedTasks?.includes(taskId);

    const statusText = isCompleted ? '✅ <b>Status:</b> Completed' : '❌ <b>Status:</b> Not Completed';

    const message = 
      `💬 <b>TASK: Join Official Group</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Join ${SPONSOR_GROUP} to claim <b>+${TASK_REWARD_POINTS} Points</b>.\n\n` +
      `${statusText}\n\n` +
      `<i>Click "Verify Group" after joining.</i>`;

    const keyboard = new InlineKeyboard();
    if (!isCompleted) {
      keyboard.url('💬 Join Group', `https://t.me/${SPONSOR_GROUP.replace('@', '')}`).row();
      keyboard.text('🔄 Verify Group', 'verify_group').row();
    }
    keyboard.text('🔙 Back to Tasks', 'earn_tasks');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery('verify_group', async (ctx) => {
    const telegramId = ctx.from.id;
    const taskId = `join_${SPONSOR_GROUP.toLowerCase()}`;

    const user = await User.findOne({ telegramId });
    if (!user) return ctx.answerCallbackQuery({ text: '❌ User not found.', show_alert: true });

    if (user.completedTasks && user.completedTasks.includes(taskId)) {
      return ctx.answerCallbackQuery({ text: '⚠️ You have already completed this task!', show_alert: true });
    }

    try {
      const member = await bot.api.getChatMember(SPONSOR_GROUP, telegramId);
      if (['creator', 'administrator', 'member'].includes(member.status)) {
        user.points += TASK_REWARD_POINTS;
        user.completedTasks.push(taskId);
        await user.save();

        await ctx.answerCallbackQuery({ text: `🎉 Verified! +${TASK_REWARD_POINTS} Points added.`, show_alert: true });

        await ctx.editMessageText(
          `🎉 <b>TASK COMPLETED!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `You earned <b>+${TASK_REWARD_POINTS} Points</b> for joining ${SPONSOR_GROUP}.\n\n` +
          `🪙 <b>New Balance:</b> ${user.points} Points`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Back to Tasks', 'earn_tasks') }
        ).catch(() => {});
      } else {
        await ctx.answerCallbackQuery({ text: `❌ You haven't joined ${SPONSOR_GROUP} yet!`, show_alert: true });
      }
    } catch (e) {
      await ctx.answerCallbackQuery({ text: '⚠️ Unable to verify. Make sure the bot is an Admin in the group.', show_alert: true });
    }
  });

  // Handle "My Profile"
  bot.callbackQuery('btn_profile', async (ctx) => {
    const user = await User.findOne({ telegramId: Number(ctx.from.id) });
    if (!user) return ctx.answerCallbackQuery({ text: '❌ Account not found.', show_alert: true });
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText(formatUserInfo(user), { parse_mode: 'HTML', reply_markup: getBackKeyboard() }).catch(() => {});
  });

  // Handle "Back to Main Menu"
  bot.callbackQuery('btn_back', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const fullName = ctx.from.first_name || 'User';
    await ctx.editMessageText(`Welcome back, ${fullName}! 👋\nSelect an option from the menu below:`, { reply_markup: getMainMenuKeyboard() }).catch(() => {});
  });

  // Handle "Daily Bonus"
  bot.callbackQuery('btn_daily', async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.answerCallbackQuery({ text: 'Account not found.' });

    const now = new Date();
    if (user.lastDailyClaim) {
      const timeDiff = (now - new Date(user.lastDailyClaim)) / (1000 * 60 * 60);
      if (timeDiff < 24) {
        const remaining = Math.ceil(24 - timeDiff);
        return ctx.answerCallbackQuery({ text: `Wait ${remaining}h for next claim!`, show_alert: true });
      }
    }

    user.points += 50;
    user.lastDailyClaim = now;
    await user.save();

    await ctx.answerCallbackQuery({ text: 'Claimed +50 points!' });

    const message = `🎁 You claimed <b>50 daily points</b>!\n🪙 New Balance: <b>${user.points} points</b>`;
    const keyboard = new InlineKeyboard().text('🔙 Main Menu', 'btn_back');

    await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  // Handle Referral System
  const handleReferral = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply('Account not found.');

    const botInfo = await bot.api.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

    const message = 
      `👥 <b>Your Referral Link:</b>\n` +
      `<code>${refLink}</code>\n\n` +
      `Share this link to earn bonus points when friends join!`;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: getEarnBackKeyboard() }).catch(() => {});
    } else {
      await ctx.reply(message, { parse_mode: 'HTML', reply_markup: getEarnBackKeyboard() });
    }
  };

  bot.callbackQuery('btn_referral', handleReferral);
  bot.callbackQuery('earn_referral', handleReferral);

  // Handle "Help"
  bot.callbackQuery('btn_help', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const helpText = 
      `❓ <b>HELP & COMMANDS GUIDE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `ℹ️ <code>/info</code> - View your profile details\n` +
      `💸 <code>/transfer <Code/ID> <Amount></code> - Send points to a user\n` +
      `💰 <code>/earn</code> - Open the Rewards Center\n` +
      `💬 <code>/support</code> - Contact Admin for inquiries\n\n` +
      `💡 <b>Features:</b>\n` +
      `• <b>Send Points:</b> Transfer your points to other users with a ${TRANSFER_TAX_PERCENT}% tax.\n` +
      `• <b>Tasks:</b> Join official communities to earn points.\n` +
      `• <b>Daily Bonus:</b> Claim free daily rewards every 24 hours.\n` +
      `• <b>Referral Link:</b> Invite friends for extra points.`;

    await ctx.editMessageText(helpText, { parse_mode: 'HTML', reply_markup: getBackKeyboard() }).catch(() => {});
  });

  // Support Command
  bot.command('support', async (ctx) => {
    const supportMessage = 
      `💬 <b>SUPPORT & INQUIRIES</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Have questions, need help, or want to report an issue?\n\n` +
      `📩 <b>Contact Admin:</b> <a href="https://t.me/dinos_service">@dinos_service</a>`;

    await ctx.reply(supportMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
  });
}

module.exports = { setupUserCommands };
