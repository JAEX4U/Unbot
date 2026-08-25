// models.js
const mongoose = require('mongoose');

// 👤 User Schema
const userSchema = new mongoose.Schema({
  telegramId: { 
    type: Number, 
    required: true, 
    unique: true, 
    index: true 
  },
  username: { 
    type: String, 
    default: 'No Username', 
    index: true 
  },
  firstName: { 
    type: String, 
    default: '' 
  },
  lastName: { 
    type: String, 
    default: '' 
  },
  accessCode: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  points: { 
    type: Number, 
    default: 0,
    min: 0 
  },
  completedTasks: { 
    type: [String], 
    default: [] 
  },
  isBanned: { 
    type: Boolean, 
    default: false 
  },
  isSuspended: { 
    type: Boolean, 
    default: false 
  },
  lastDailyClaim: { 
    type: Date, 
    default: null 
  }
}, { timestamps: true });

// 🔑 Access Code Schema
const accessCodeSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  isUsed: { 
    type: Boolean, 
    default: false 
  },
  usedByTelegramId: { 
    type: Number, 
    default: null 
  },
  isAgentCode: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

// 📢 Sponsored Ads Schema (Optional for persistent ad management)
const adSchema = new mongoose.Schema({
  adId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  title: { 
    type: String, 
    required: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  buttonText: { 
    type: String, 
    default: '🔗 Visit Link' 
  },
  targetUrl: { 
    type: String, 
    required: true 
  },
  reward: { 
    type: Number, 
    default: 50 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const AccessCode = mongoose.model('AccessCode', accessCodeSchema);
const Ad = mongoose.model('Ad', adSchema);

module.exports = { User, AccessCode, Ad };
