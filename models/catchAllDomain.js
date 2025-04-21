// models/catchAllDomain.js - New model to track catch-all domains
const mongoose = require('mongoose');

const catchAllDomainSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  detectedAt: {
    type: Date,
    default: Date.now
  },
  verificationAttempts: {
    type: Number,
    default: 1
  },
  lastVerified: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('CatchAllDomain', catchAllDomainSchema);
