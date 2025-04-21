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

// middleware/validator.js - Updated with new validation
/**
 * Validate request parameters for email verification
 */
function validateEmailLookupRequest(req, res, next) {
  const { firstName, lastName, company } = req.body;
  
  if (!firstName || !lastName || !company) {
    return res.status(400).json({
      success: false,
      message: 'First name, last name, and company are required'
    });
  }
  
  // Basic validation
  if (firstName.length < 2 || lastName.length < 2 || company.length < 2) {
    return res.status(400).json({
      success: false,
      message: 'First name, last name, and company must each be at least 2 characters'
    });
  }
  
  next();
}

module.exports = {
  validateEmailLookupRequest
};