// routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const { validateEmailLookupRequest } = require('../middleware/validator');
const {
  findWorkEmail,
  getCompanyPatterns,
  getGlobalPatterns
} = require('../controllers/emailVerificationController');

// Find work email based on personal details
router.post('/verify', validateEmailLookupRequest, findWorkEmail);

// Get company patterns
router.get('/company/:company', getCompanyPatterns);

// Get global patterns
router.get('/patterns', getGlobalPatterns);

module.exports = router;