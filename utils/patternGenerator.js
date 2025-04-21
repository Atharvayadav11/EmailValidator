// utils/patternGenerator.js
/**
 * Generate potential email patterns based on first name and last name
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {string} domain - Company domain
 * @returns {Array} - List of potential email addresses
 */
function generateEmailPatterns(firstName, lastName, domain) {
  // Normalize inputs
  firstName = firstName.toLowerCase().trim();
  lastName = lastName.toLowerCase().trim();
  domain = domain.toLowerCase().trim();
  
  // First initial
  const firstInitial = firstName.charAt(0);
  // Last initial
  const lastInitial = lastName.charAt(0);
  
  // Define common patterns
  const patterns = [
    // Most common patterns
    `${firstName}.${lastName}@${domain}`,
    `${firstName}${lastName}@${domain}`,
    `${firstInitial}.${lastName}@${domain}`,
    `${firstInitial}${lastName}@${domain}`,
    `${firstName}_${lastName}@${domain}`,
    `${firstName}@${domain}`,
    `${lastName}.${firstName}@${domain}`,
    `${lastName}${firstName}@${domain}`,
    `${lastName}${firstInitial}@${domain}`,
    `${firstInitial}${lastInitial}@${domain}`,
    // Less common but still used
    `${lastName}_${firstName}@${domain}`,
    `${firstName}-${lastName}@${domain}`,
    `${firstName}.${lastInitial}@${domain}`,
    `${firstName}${lastInitial}@${domain}`,
    `${firstName}_${lastInitial}@${domain}`,
    `${firstName}${lastName[0]}${lastName[1]}@${domain}`,
    `${firstInitial}${lastName[0]}${lastName[1]}@${domain}`
  ];
  
  return patterns;
}

/**
 * Generate domain from company name (fallback)
 * @param {string} companyName - Name of the company
 * @returns {string} - Potential domain
 */
function guessDomainFromCompanyName(companyName) {
  // Remove special characters and spaces
  const normalizedName = companyName.toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, '');
  
  return [
    `${normalizedName}.com`,
    `${normalizedName}.co`,
    `${normalizedName}.io`,
    `${normalizedName}.net`
  ];
}

module.exports = {
  generateEmailPatterns,
  guessDomainFromCompanyName
};
