// models.js
const mongoose = require('mongoose');

// 1. User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  accessCode: { type: String, required: true },
  username: { type: String, default: 'No Username' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  points: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  lastDailyClaim: { type: Date, default: null }
}, { timestamps: true });

// 2. Access Code Schema
const accessCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  isUsed: { type: Boolean, default: false },
  usedByTelegramId: { type: Number, default: null },
  createdBy: { type: Number, required: true }
}, { timestamps: true });

// 3. Ad Campaign Schema (Adsgram / Sponsor Ads History)
const adCampaignSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  createdBy: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'active', 'completed'], default: 'active' },
  sentCount: { type: Number, default: 0 },
  totalTargeted: { type: Number, default: 0 }
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const AccessCode = mongoose.models.AccessCode || mongoose.model('AccessCode', accessCodeSchema);
const AdCampaign = mongoose.models.AdCampaign || mongoose.model('AdCampaign', adCampaignSchema);

module.exports = { User, AccessCode, AdCampaign };
