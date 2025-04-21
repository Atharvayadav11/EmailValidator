// models/company.js - Updated to store more information
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  domain: {
    type: String,
    required: true,
    trim: true
  },
  isCatchAll: {
    type: Boolean,
    default: false
  },
  verifiedPatterns: [{
    pattern: {
      type: String,
      required: true
    },
    usageCount: {
      type: Number,
      default: 1
    },
    lastVerified: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
