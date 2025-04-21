// models/pattern.js
const mongoose = require('mongoose');

const patternSchema = new mongoose.Schema({
  pattern: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Pattern', patternSchema);
