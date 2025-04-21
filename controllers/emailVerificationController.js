// controllers/emailVerificationController.js - Updated with new requirements
const Company = require('../models/company');
const Pattern = require('../models/pattern');
const Person = require('../models/person');
const CatchAllDomain = require('../models/catchAllDomain');
const { generateEmailPatterns, guessDomainFromCompanyName } = require('../utils/patternGenerator');
const { verifyEmail, detectCatchAllDomain } = require('../utils/emailVerifier');
const dns = require('dns');
const { promisify } = require('util');

const resolveMx = promisify(dns.resolveMx);

/**
 * Find or create a company by name and domain
 */
async function findOrCreateCompany(companyName, domain) {
  let company = await Company.findOne({ 
    $or: [
      { name: { $regex: new RegExp(companyName, 'i') } },
      { domain: domain }
    ]
  });
  
  if (!company) {
    company = new Company({
      name: companyName,
      domain: domain,
      verifiedPatterns: []
    });
    await company.save();
  }
  
  return company;
}

/**
 * Update company with verified pattern
 */
async function updateCompanyPattern(company, pattern) {
  const patternIndex = company.verifiedPatterns.findIndex(p => p.pattern === pattern);
  
  if (patternIndex >= 0) {
    // Pattern exists, increment count
    company.verifiedPatterns[patternIndex].usageCount += 1;
    company.verifiedPatterns[patternIndex].lastVerified = new Date();
  } else {
    // Add new pattern
    company.verifiedPatterns.push({
      pattern,
      usageCount: 1,
      lastVerified: new Date()
    });
  }
  
  await company.save();
  
  // Also update global pattern stats
  await Pattern.findOneAndUpdate(
    { pattern },
    { $inc: { usageCount: 1 } },
    { upsert: true, new: true }
  );
}

/**
 * Save person data with verification results
 */
async function savePersonData(personData, company, verifiedEmail, allResults) {
  // Check if person already exists
  let person = await Person.findOne({
    firstName: personData.firstName,
    lastName: personData.lastName,
    company: personData.company
  });
  
  if (!person) {
    person = new Person({
      ...personData,
      companyId: company._id,
      domain: company.domain,
      allTestedEmails: []
    });
  }
  
  // Update verification data
  person.verifiedEmail = verifiedEmail;
  person.emailVerifiedAt = new Date();
  
  // Format and add test results
  const formattedResults = allResults.map(result => ({
    email: result.email,
    valid: result.valid,
    reason: result.reason,
    details: result.details,
    testedAt: new Date()
  }));
  
  // Add new test results
  person.allTestedEmails = [...person.allTestedEmails, ...formattedResults];
  
  await person.save();
  return person;
}

/**
 * Find work email based on personal details
 */
async function findWorkEmail(req, res) {
  try {
    const {
      firstName,
      lastName,
      company: companyName,
      domain: providedDomain,
      currentPosition,
      phone,
      educationalInstitute,
      previousCompanies,
      qualifications
    } = req.body;
    
    // Step 1: Determine domain from provided domain or company name
    let domain;
    try {
      if (providedDomain) {
        // Use provided domain
        domain = providedDomain.toLowerCase().trim();
        console.log(`Using provided domain: ${domain}`);
      } else {
        // Try to find domain from existing companies
        const existingCompany = await Company.findOne({
          name: { $regex: new RegExp(companyName, 'i') }
        });
        
        if (existingCompany) {
          domain = existingCompany.domain;
          console.log(`Found existing domain ${domain} for company ${companyName}`);
        } else {
          // Make an educated guess or use external API
          const potentialDomains = guessDomainFromCompanyName(companyName);
          
          // Try to validate each domain by checking for MX records
          for (const potentialDomain of potentialDomains) {
            try {
              const mxRecords = await resolveMx(potentialDomain);
              if (mxRecords && mxRecords.length > 0) {
                domain = potentialDomain;
                console.log(`Found domain ${domain} for company ${companyName} via MX lookup`);
                break;
              }
            } catch (err) {
              // This domain doesn't have MX records, try next one
              continue;
            }
          }
          
          if (!domain) {
            return res.status(400).json({
              success: false,
              message: 'Could not determine email domain for this company'
            });
          }
        }
      }
    } catch (error) {
      console.error('Error determining domain:', error);
      return res.status(500).json({
        success: false,
        message: 'Error determining company email domain'
      });
    }
    
    // Step 2: Check if this is a known catch-all domain
    const catchAllDomain = await CatchAllDomain.findOne({ domain });
    if (catchAllDomain) {
      return res.status(200).json({
        success: false,
        message: 'This domain is a catch-all domain and cannot be reliably verified',
        metadata: {
          firstName,
          lastName,
          company: companyName,
          domain,
          isCatchAll: true
        }
      });
    }
    
    // Step 3: Get or create company in database
    const company = await findOrCreateCompany(companyName, domain);
    
    // Step 4: Check if we have verified patterns for this company
    let emailsToVerify = [];
    
    if (company.verifiedPatterns.length > 0) {
      // Get verified patterns and sort by usage count
      const sortedPatterns = [...company.verifiedPatterns]
        .sort((a, b) => b.usageCount - a.usageCount);
      
      // Generate actual email addresses from patterns
      emailsToVerify = sortedPatterns.map(p => {
        // Replace placeholders in pattern with actual values
        return p.pattern
          .replace('{firstName}', firstName.toLowerCase())
          .replace('{lastName}', lastName.toLowerCase())
          .replace('{firstInitial}', firstName.charAt(0).toLowerCase())
          .replace('{lastInitial}', lastName.charAt(0).toLowerCase());
      });
      
      console.log(`Using ${emailsToVerify.length} verified patterns from company history`);
    }
    
    // Generate more potential patterns if we don't have enough
    if (emailsToVerify.length < 5) {
      const generatedEmails = generateEmailPatterns(firstName, lastName, domain);
      
      // Add any new patterns not already in our list
      for (const email of generatedEmails) {
        if (!emailsToVerify.includes(email)) {
          emailsToVerify.push(email);
        }
      }
      
      console.log(`Generated ${generatedEmails.length} additional patterns`);
    }
    
    // Step 5: Check if this person already exists in our database
    const existingPerson = await Person.findOne({
      firstName: { $regex: new RegExp(`^${firstName}$`, 'i') },
      lastName: { $regex: new RegExp(`^${lastName}$`, 'i') },
      company: { $regex: new RegExp(`^${companyName}$`, 'i') }
    });
    
    if (existingPerson && existingPerson.verifiedEmail) {
      console.log(`Found existing verified email for ${firstName} ${lastName}: ${existingPerson.verifiedEmail}`);
      
      // Re-verify the existing email to ensure it's still valid
      const verificationResult = await verifyEmail(existingPerson.verifiedEmail);
      
      if (verificationResult.valid) {
        console.log(`Re-verified existing email: ${existingPerson.verifiedEmail}`);
        
        // Update verification timestamp
        existingPerson.emailVerifiedAt = new Date();
        await existingPerson.save();
        
        return res.json({
          success: true,
          verifiedEmails: [existingPerson.verifiedEmail],
          source: 'database',
          metadata: {
            firstName,
            lastName,
            company: companyName,
            domain,
            currentPosition
          }
        });
      } else {
        console.log(`Existing email ${existingPerson.verifiedEmail} is no longer valid. Searching for new email.`);
      }
    }
    
    // Step 6: Verify emails
    console.log(`Starting verification of ${emailsToVerify.length} email patterns`);
    const verificationResults = [];
    const verifiedEmails = [];
    
    for (const email of emailsToVerify) {
      const result = await verifyEmail(email);
      
      verificationResults.push({
        email,
        valid: result.valid,
        reason: result.reason,
        details: result.details
      });
      
      if (result.valid) {
        verifiedEmails.push(email);
        
        // Extract pattern from email
        const patternType = derivePatternFromEmail(email, firstName, lastName, domain);
        await updateCompanyPattern(company, patternType);
        
        // Test for catch-all domain after first verification
        if (verifiedEmails.length === 1) {
          const isCatchAll = await detectCatchAllDomain(domain, email);
          
          if (isCatchAll) {
            // Update company as catch-all
            company.isCatchAll = true;
            await company.save();
            
            return res.json({
              success: false,
              message: 'This domain appears to be a catch-all domain that accepts all emails',
              verifiedEmails: [],
              attemptedPatterns: verificationResults,
              metadata: {
                firstName,
                lastName,
                company: companyName,
                domain,
                isCatchAll: true
              }
            });
          }
          const EARLY_EXIT='true';
          // Early exit after first valid email if not catch-all
          if (EARLY_EXIT === 'true') {
            break;
          }
        }
      }
    }
    
    // Step 7: Save person data
    if (verifiedEmails.length > 0) {
      const personData = {
        firstName,
        lastName,
        company: companyName,
        currentPosition,
        phone,
        educationalInstitute,
        previousCompanies,
        qualifications
      };
      
      await savePersonData(personData, company, verifiedEmails[0], verificationResults);
    }
    
    // Step 8: Return results
    if (verifiedEmails.length > 0) {
      return res.json({
        success: true,
        verifiedEmails,
        allResults: verificationResults,
        metadata: {
          firstName,
          lastName,
          company: companyName,
          domain,
          currentPosition
        }
      });
    } else {
      return res.json({
        success: false,
        message: 'Could not verify any email patterns',
        attemptedPatterns: verificationResults,
        metadata: {
          firstName,
          lastName,
          company: companyName,
          domain,
          currentPosition
        }
      });
    }
  } catch (error) {
    console.error('Error in findWorkEmail:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

/**
 * Derive pattern type from verified email
 */
function derivePatternFromEmail(email, firstName, lastName, domain) {
  firstName = firstName.toLowerCase();
  lastName = lastName.toLowerCase();
  const firstInitial = firstName.charAt(0);
  const lastInitial = lastName.charAt(0);
  
  const localPart = email.split('@')[0];
  
  // Define pattern mapping
  const patterns = {
    [`${firstName}.${lastName}`]: '{firstName}.{lastName}',
    [`${firstName}${lastName}`]: '{firstName}{lastName}',
    [`${firstInitial}.${lastName}`]: '{firstInitial}.{lastName}',
    [`${firstInitial}${lastName}`]: '{firstInitial}{lastName}',
    [`${firstName}_${lastName}`]: '{firstName}_{lastName}',
    [`${firstName}`]: '{firstName}',
    [`${lastName}.${firstName}`]: '{lastName}.{firstName}',
    [`${lastName}${firstName}`]: '{lastName}{firstName}',
    [`${lastName}${firstInitial}`]: '{lastName}{firstInitial}',
    [`${firstInitial}${lastInitial}`]: '{firstInitial}{lastInitial}'
  };
  
  return patterns[localPart] || localPart;
}

/**
 * Get company patterns
 */
async function getCompanyPatterns(req, res) {
  try {
    const { company } = req.params;
    
    const companyDoc = await Company.findOne({
      name: { $regex: new RegExp(company, 'i') }
    });
    
    if (!companyDoc) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }
    
    return res.json({
      success: true,
      company: companyDoc.name,
      domain: companyDoc.domain,
      isCatchAll: companyDoc.isCatchAll,
      patterns: companyDoc.verifiedPatterns.sort((a, b) => b.usageCount - a.usageCount)
    });
  } catch (error) {
    console.error('Error in getCompanyPatterns:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

/**
 * Get global pattern stats
 */
async function getGlobalPatterns(req, res) {
  try {
    const patterns = await Pattern.find().sort({ usageCount: -1 }).limit(20);
    
    return res.json({
      success: true,
      patterns
    });
  } catch (error) {
    console.error('Error in getGlobalPatterns:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

/**
 * Get person data
 */
async function getPersonData(req, res) {
  try {
    const { firstName, lastName, company } = req.query;
    
    if (!firstName || !lastName || !company) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, and company are required'
      });
    }
    
    const person = await Person.findOne({
      firstName: { $regex: new RegExp(`^${firstName}$`, 'i') },
      lastName: { $regex: new RegExp(`^${lastName}$`, 'i') },
      company: { $regex: new RegExp(`^${company}$`, 'i') }
    });
    
    if (!person) {
      return res.status(404).json({
        success: false,
        message: 'Person not found'
      });
    }
    
    return res.json({
      success: true,
      person
    });
  } catch (error) {
    console.error('Error in getPersonData:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

/**
 * Get catch-all domains
 */
async function getCatchAllDomains(req, res) {
  try {
    const catchAllDomains = await CatchAllDomain.find()
      .sort({ lastVerified: -1 })
      .limit(parseInt(req.query.limit) || 100);
    
    return res.json({
      success: true,
      count: catchAllDomains.length,
      domains: catchAllDomains
    });
  } catch (error) {
    console.error('Error in getCatchAllDomains:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

module.exports = {
  findWorkEmail,
  getCompanyPatterns,
  getGlobalPatterns,
  getPersonData,
  getCatchAllDomains
};