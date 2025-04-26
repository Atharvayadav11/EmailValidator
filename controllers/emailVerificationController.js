// controllers/emailVerificationController.js - Updated with new requirements
const Company = require('../models/company');
const Pattern = require('../models/pattern');
const Person = require('../models/person');
const CatchAllDomain = require('../models/catchAllDomain');
const { generateEmailPatterns, guessDomainFromCompanyName } = require('../utils/patternGenerator');
const { verifyEmail, verifyEmailPatterns, detectCatchAllDomain } = require('../utils/emailVerifier');
const logger = require('../utils/logger');
const { generateRequestId } = require('../utils/requestIdGenerator');
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
    const requestId = generateRequestId();
    const startTime = Date.now();
    
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
        
        logger.log('Starting email verification', {
            requestId,
            firstName,
            lastName,
            company: companyName
        });
        
        // Step 1: Determine domain from provided domain or company name
        let domain;
        try {
            if (providedDomain) {
                domain = providedDomain.toLowerCase().trim();
                logger.log(`Using provided domain: ${domain}`, { requestId });
            } else {
                // Try to find domain from existing companies
                const existingCompany = await Company.findOne({
                    name: { $regex: new RegExp(companyName, 'i') }
                });
                
                if (existingCompany) {
                    domain = existingCompany.domain;
                    logger.log(`Found existing domain ${domain} for company ${companyName}`);
                } else {
                    // Make an educated guess or use external API
                    const potentialDomains = guessDomainFromCompanyName(companyName);
                    
                    // Try to validate each domain by checking for MX records
                    for (const potentialDomain of potentialDomains) {
                        try {
                            const mxRecords = await resolveMx(potentialDomain);
                            if (mxRecords && mxRecords.length > 0) {
                                domain = potentialDomain;
                                logger.log(`Found domain ${domain} for company ${companyName} via MX lookup`);
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
            const timeTaken = Date.now() - startTime;
            logger.error(error, {
                requestId,
                context: {
                    stage: 'domain_determination',
                    companyName,
                    timeTaken
                }
            });
            
            return res.status(500).json({
                success: false,
                message: 'Error determining company email domain',
                timeTaken
            });
        }
        
        // Step 2: Check if this is a known catch-all domain
        const catchAllDomain = await CatchAllDomain.findOne({ domain });
        if (catchAllDomain) {
            const timeTaken = Date.now() - startTime;
            
            logger.catchall({
                requestId,
                domain,
                company: companyName,
                detectionMethod: 'database_lookup',
                timeTaken
            });
            
            return res.status(200).json({
                success: false,
                message: 'This domain is a catch-all domain and cannot be reliably verified',
                metadata: {
                    firstName,
                    lastName,
                    company: companyName,
                    domain,
                    isCatchAll: true
                },
                timeTaken
            });
        }
        
        // Step 3: Get or create company in database
        const company = await findOrCreateCompany(companyName, domain);
        
        // Step 4: Get MX records for the domain
        const mxRecords = await resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No MX records found for this domain'
            });
        }
        
        // Sort MX records by priority
        mxRecords.sort((a, b) => a.priority - b.priority);
        const mxRecord = mxRecords[0].exchange;
        
        // Step 5: Generate email patterns to test
        let emailsToVerify = [];
        
        if (company.verifiedPatterns.length > 0) {
            // Get verified patterns and sort by usage count
            const sortedPatterns = [...company.verifiedPatterns]
                .sort((a, b) => b.usageCount - a.usageCount);
            
            // Generate actual email addresses from patterns
            emailsToVerify = sortedPatterns.map(p => {
                return p.pattern
                    .replace('{firstName}', firstName.toLowerCase())
                    .replace('{lastName}', lastName.toLowerCase())
                    .replace('{firstInitial}', firstName.charAt(0).toLowerCase())
                    .replace('{lastInitial}', lastName.charAt(0).toLowerCase());
            });
            
            logger.log(`Using ${emailsToVerify.length} verified patterns from company history`, { 
                requestId,
                patternsCount: emailsToVerify.length 
            });
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
            
            logger.log(`Generated ${generatedEmails.length} additional patterns`, { 
                requestId,
                patternsCount: generatedEmails.length 
            });
        }
        
        // Step 6: Verify emails in parallel using IP pool
        logger.log(`Starting parallel verification of ${emailsToVerify.length} email patterns`, { 
            requestId,
            patternsCount: emailsToVerify.length 
        });
        
        const { results: verificationResults, foundValidEmail } = await verifyEmailPatterns(
            emailsToVerify, 
            mxRecord,
            'team@emailvalidator.online',
            requestId
        );
        
        // Process results
        const validEmails = [];
        const verifiedPatterns = new Map();
        
        for (const [email, result] of verificationResults) {
            if (result.valid) {
                validEmails.push({
                    email,
                    sourceIP: result.sourceIP
                });
                
                // Extract and store the pattern
                const pattern = derivePatternFromEmail(email, firstName, lastName, domain);
                if (pattern) {
                    verifiedPatterns.set(pattern, (verifiedPatterns.get(pattern) || 0) + 1);
                }
                
                // If this is our first valid email, check for catch-all domain
                if (validEmails.length === 1) {
                    const isCatchAll = await detectCatchAllDomain(domain, email);
                    
                    if (isCatchAll) {
                        const timeTaken = Date.now() - startTime;
                        
                        logger.catchall({
                            requestId,
                            domain,
                            company: companyName,
                            detectionMethod: 'pattern_verification',
                            timeTaken
                        });
                        
                        return res.json({
                            success: false,
                            message: 'This domain appears to be a catch-all domain that accepts all emails',
                            verifiedEmails: [],
                            attemptedPatterns: Array.from(verificationResults.values()),
                            metadata: {
                                firstName,
                                lastName,
                                company: companyName,
                                domain,
                                isCatchAll: true
                            },
                            timeTaken
                        });
                    }
                    
                    // If not a catch-all domain and we're configured for early exit, break here
                    const EARLY_EXIT = 'true';
                    if (EARLY_EXIT === 'true') {
                        break;
                    }
                }
            }
        }
        
        // Update company patterns
        for (const [pattern, count] of verifiedPatterns) {
            await updateCompanyPattern(company, pattern);
        }
        
        // Save person data
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
        
        const verifiedEmail = validEmails.length > 0 ? validEmails[0].email : null;
        await savePersonData(personData, company, verifiedEmail, Array.from(verificationResults.values()));
        
        const timeTaken = Date.now() - startTime;
        
        if (validEmails.length > 0) {
            logger.success({
                requestId,
                firstName,
                lastName,
                company: companyName,
                verifiedEmail: validEmails[0].email,
                timeTaken,
                patternsChecked: verificationResults.size
            });
        } else {
            logger.log('No valid emails found', {
                requestId,
                firstName,
                lastName,
                company: companyName,
                patternsChecked: verificationResults.size,
                timeTaken
            });
        }
        
        // Return results
        return res.json({
            success: validEmails.length > 0,
            verifiedEmails: validEmails,
            totalPatternsTested: emailsToVerify.length,
            patternsTestedBeforeValid: foundValidEmail ? verificationResults.size : null,
            metadata: {
                firstName,
                lastName,
                company: companyName,
                domain
            },
            timeTaken
        });
    } catch (error) {
        const timeTaken = Date.now() - startTime;
        
        logger.error(error, {
            requestId,
            context: {
                stage: 'request_processing',
                timeTaken
            }
        });
        
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message,
            timeTaken
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