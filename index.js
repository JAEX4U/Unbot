// index.js
require('dotenv').config();
const { Bot } = require('grammy');
const mongoose = require('mongoose');
const { User, AccessCode } = require('./models');
const { setupUserCommands } = require('./user');
const { setupAdminCommands } = require('./admin');

const bot = new Bot(process.env.BOT_TOKEN);

// Helper function to lookup users by Access Code, Telegram ID, or Username
async function findUserByQuery(query) {
  if (!query) return null;
  const cleanQuery = query.replace('@', '').trim();

  let user = await User.findOne({ accessCode: cleanQuery });
  if (user) return user;

  if (!isNaN(cleanQuery)) {
    user = await User.findOne({ telegramId: Number(cleanQuery) });
    if (user) return user;
  }

  user = await User.findOne({ username: new RegExp(`^${cleanQuery}$`, 'i') });
  return user;
}

// Register Modules
setupUserCommands(bot, findUserByQuery);
setupAdminCommands(bot, findUserByQuery);

// Database Connection & Launch
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB successfully.');
    bot.start({
      onStart: (info) => console.log(`🚀 Bot @${info.username} is running live!`)
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err);
  });
