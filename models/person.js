// models/person.js - New model to store person data
const mongoose = require('mongoose');

const personSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  domain: String,
  currentPosition: String,
  phone: String,
  educationalInstitute: String,
  previousCompanies: [String],
  qualifications: [String],
  verifiedEmail: String,
  emailVerifiedAt: Date,
  allTestedEmails: [{
    email: String,
    valid: Boolean,
    reason: String,
    details: String,
    testedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

// Create index for faster lookups
personSchema.index({ firstName: 1, lastName: 1, company: 1 });

module.exports = mongoose.model('Person', personSchema);