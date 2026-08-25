// models.js
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: { type: String, default: 'No Username' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  accessCode: { type: String, required: true, unique: true },
  points: { type: Number, default: 0 },
  completedTasks: [{ type: String, default: [] }],
  isBanned: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  lastDailyClaim: { type: Date, default: null }
}, { timestamps: true });

// Access Code Schema
const accessCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  isUsed: { type: Boolean, default: false },
  usedByTelegramId: { type: Number, default: null },
  isAgentCode: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const AccessCode = mongoose.model('AccessCode', accessCodeSchema);

module.exports = { User, AccessCode };
