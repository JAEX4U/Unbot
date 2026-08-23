// models.js
const mongoose = require('mongoose');

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

module.exports = { User, AccessCode };
