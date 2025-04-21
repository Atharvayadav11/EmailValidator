// routes/emailRoutes.js - Updated with new endpoints
const express = require('express');
const router = express.Router();
const { validateEmailLookupRequest } = require('../middleware/validator');
const {
  findWorkEmail,
  getCompanyPatterns,
  getGlobalPatterns,
  getPersonData,
  getCatchAllDomains
} = require('../controllers/emailVerificationController');

// Find work email based on personal details
router.post('/verify', validateEmailLookupRequest, findWorkEmail);

// Get company patterns
router.get('/company/:company', getCompanyPatterns);

// Get global patterns
router.get('/patterns', getGlobalPatterns);

// Get person data
router.get('/person', getPersonData);

// Get catch-all domains
router.get('/catch-all', getCatchAllDomains);

module.exports = router;

