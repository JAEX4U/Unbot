// index.js
require('dotenv').config();
const { Bot, GrammyError, HttpError } = require('grammy');
const mongoose = require('mongoose');
const { User } = require('./models');

// Module Routes
const { setupUserCommands } = require('./user');
const { setupAdCommands } = require('./ads');
const { setupAdminCommands } = require('./admin'); // Uncommented

// Inside main function:
setupUserCommands(bot, findUserByQuery);
setupAdCommands(bot, ADMIN_IDS);
setupAdminCommands(bot, findUserByQuery); // Added
// ⚙️ Configurations & Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_IDS = process.env.ADMIN_IDS 
  ? process.env.ADMIN_IDS.split(',').map((id) => Number(id.trim()))
  : [];

if (!BOT_TOKEN) {
  console.error('❌ FATAL: BOT_TOKEN is missing from environment variables.');
  process.exit(1);
}

// 🤖 Initialize Bot
const bot = new Bot(BOT_TOKEN);

// 🛡️ 1. GLOBAL ERROR HANDLER (Prevents crashes from expired queries & API errors)
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`⚠️ Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error('Telegram API Error:', e.description);
  } else if (e instanceof HttpError) {
    console.error('Network Error (Could not contact Telegram):', e);
  } else {
    console.error('Unhandled Application Error:', e);
  }
});

// 🔎 Helper: User Lookup Utility
async function findUserByQuery(query) {
  if (!query) return null;
  const cleanQuery = query.trim();

  let targetUser = await User.findOne({ accessCode: cleanQuery });

  if (!targetUser && /^\d+$/.test(cleanQuery)) {
    targetUser = await User.findOne({ telegramId: Number(cleanQuery) });
  }

  if (!targetUser) {
    const cleanUsername = cleanQuery.replace('@', '');
    targetUser = await User.findOne({ username: new RegExp(`^${cleanUsername}$`, 'i') });
  }

  return targetUser;
}

// 🚀 Start Application Server
async function main() {
  try {
    // Connect Database
    if (MONGO_URI) {
      await mongoose.connect(MONGO_URI);
      console.log('✅ Connected to MongoDB successfully.');
    } else {
      console.warn('⚠️ MONGO_URI missing. Database features will fail if required.');
    }

    // Register Handlers & Command Modules
    setupUserCommands(bot, findUserByQuery);
    setupAdCommands(bot, ADMIN_IDS);
    // setupAdminCommands(bot, findUserByQuery, ADMIN_IDS);

    // Launch Bot Polling
    console.log('🚀 Starting Telegram Bot polling...');
    await bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Bot online as @${botInfo.username}`);
      },
    });
  } catch (error) {
    console.error('❌ Failed to start the bot:', error);
    process.exit(1);
  }
}

// 🛑 Graceful Shutdown Signals (For Render / Heroku / Container Restarts)
process.once('SIGINT', () => {
  console.log('Stopping bot on SIGINT...');
  bot.stop();
});
process.once('SIGTERM', () => {
  console.log('Stopping bot on SIGTERM...');
  bot.stop();
});

main();
