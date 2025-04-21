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