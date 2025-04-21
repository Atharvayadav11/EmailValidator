// models/company.js
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