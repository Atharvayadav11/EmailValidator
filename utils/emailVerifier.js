// utils/emailVerifier.js - Updated with catch-all detection and IP pool support
const dns = require('dns');
const net = require('net');
const { promisify } = require('util');
const CatchAllDomain = require('../models/catchAllDomain');
const IPPoolManager = require('./ipPoolManager');
const logger = require('./logger');

const resolveMx = promisify(dns.resolveMx);

// IP block detection patterns
const IP_BLOCK_PATTERNS = [
    'blocked',
    'blacklisted',
    'banned',
    'denied',
    'rejected',
    'spam',
    'authentication required',
    'connection refused'
];

// Configure IP Pool with actual IP addresses
const ipPool = new IPPoolManager([
    '108.165.213.192',  // First IP (Propagated)
    '166.88.142.147',   // Second IP
    '166.88.142.148'    // Third IP
]);

/**
 * Check if domain is a known catch-all domain
 * @param {string} domain - Domain to check
 * @returns {Promise<boolean>} - True if domain is a catch-all
 */
async function isKnownCatchAllDomain(domain) {
  const domainRecord = await CatchAllDomain.findOne({ domain });
  return domainRecord !== null;
}

/**
 * Mark domain as catch-all
 * @param {string} domain - Domain to mark
 */
async function markAsCatchAll(domain) {
  await CatchAllDomain.findOneAndUpdate(
    { domain },
    { 
      $inc: { verificationAttempts: 1 },
      $set: { lastVerified: new Date() }
    },
    { upsert: true }
  );
  
  // Also update any companies with this domain
  const Company = require('../models/company');
  await Company.updateMany(
    { domain },
    { $set: { isCatchAll: true } }
  );
}

/**
 * Verify email using SMTP handshake
 * @param {string} email - Email to verify
 * @param {string} fromEmail - Email to use as sender
 * @returns {Promise<Object>} - Verification result
 */
async function verifyEmail(email, fromEmail = 'team@emailvalidator.online') {
  const domain = email.split('@')[1];
  
  try {
    console.log(`Starting verification for ${email}`);
    
    // Check if domain is known catch-all
    const isCatchAll = await isKnownCatchAllDomain(domain);
    if (isCatchAll) {
      console.log(`${domain} is a known catch-all domain, skipping verification`);
      return { 
        valid: false, 
        reason: 'CATCH_ALL_DOMAIN',
        details: 'This domain accepts all email addresses and cannot be reliably verified'
      };
    }
    
    // Get MX records
    console.log(`Finding MX records for ${domain}...`);
    const mxRecords = await resolveMx(domain);
    
    if (!mxRecords || mxRecords.length === 0) {
      console.log(`No MX records found for domain ${domain}`);
      return { valid: false, reason: 'NO_MX_RECORD' };
    }
    
    // Sort MX records by priority (lower is better)
    mxRecords.sort((a, b) => a.priority - b.priority);
    const mxRecord = mxRecords[0].exchange;
    console.log(`Using MX record: ${mxRecord}`);
    
    // Perform SMTP verification
    const result = await smtpVerify(email, mxRecord, fromEmail);
    return result;
  } catch (error) {
    console.error(`Error verifying ${email}:`, error);
    return { valid: false, reason: 'VERIFICATION_ERROR', details: error.message };
  }
}

/**
 * Detect if domain is catch-all by testing random emails
 * @param {string} domain - Domain to test
 * @param {string} validEmail - Email already validated
 * @returns {Promise<boolean>} - True if domain is catch-all
 */
async function detectCatchAllDomain(domain, validEmail) {
  // Generate random email addresses that should not exist
  const randomEmails = [
    `nonexistent_${Math.random().toString(36).substring(2)}@${domain}`,
    `fake_account_${Date.now()}@${domain}`,
    `test_${Math.random().toString(36).substring(2)}_verify@${domain}`
  ];
  
  console.log(`Testing if ${domain} is a catch-all domain...`);
  
  // Test random emails
  let catchAllCount = 0;
  for (const randomEmail of randomEmails) {
    const result = await verifyEmail(randomEmail);
    if (result.valid) {
      catchAllCount++;
      console.log(`Random email ${randomEmail} validated - potential catch-all domain`);
    }
  }
  
  // If 2 or more random emails validate, consider it a catch-all domain
  const isCatchAll = catchAllCount >= 2;
  if (isCatchAll) {
    console.log(`${domain} is a catch-all domain! (${catchAllCount}/3 random emails validated)`);
    await markAsCatchAll(domain);
  }
  
  return isCatchAll;
}

/**
 * Perform SMTP handshake to verify email
 * @param {string} email - The email to verify
 * @param {string} mxServer - MX server to connect to
 * @param {string} fromEmail - Sender email
 * @param {string} sourceIP - IP to use for connection
 * @returns {Promise<Object>} - Verification result
 */
function smtpVerify(email, mxServer, fromEmail, sourceIP) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let responseBuffer = '';
        let step = 0;
        let timeoutId;
        
        // Log helper
        const logStep = (stepName, data) => {
            logger.log(`SMTP Step [${email}][${sourceIP}] ${stepName}`, { 
                data: data.trim(),
                sourceIP 
            });
        };
        
        // Set timeout
        const setupTimeout = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            timeoutId = setTimeout(() => {
                logger.log(`Connection timed out for ${email}`, { sourceIP });
                socket.destroy();
                resolve({ valid: false, reason: 'TIMEOUT', sourceIP });
            }, 10000);
        };
        
        // Handle responses
        socket.on('data', (data) => {
            clearTimeout(timeoutId);
            responseBuffer += data.toString();
            
            if (responseBuffer.endsWith('\r\n')) {
                const response = responseBuffer;
                responseBuffer = '';
                
                // Check for IP blocks in response
                const lowerResponse = response.toLowerCase();
                const isBlocked = IP_BLOCK_PATTERNS.some(pattern => 
                    lowerResponse.includes(pattern.toLowerCase())
                );
                
                if (isBlocked) {
                    logger.blockedIP({
                        sourceIP,
                        domain: email.split('@')[1],
                        error: response.trim()
                    });
                }
                
                switch (step) {
                    case 0: // Connected
                        logStep('CONNECT', response);
                        socket.write(`HELO emailvalidator.online\r\n`);
                        step = 1;
                        break;
                        
                    case 1: // HELO sent
                        logStep('HELO', response);
                        socket.write(`MAIL FROM:<${fromEmail}>\r\n`);
                        step = 2;
                        break;
                        
                    case 2: // MAIL FROM sent
                        logStep('MAIL FROM', response);
                        socket.write(`RCPT TO:<${email}>\r\n`);
                        step = 3;
                        break;
                        
                    case 3: // RCPT TO sent
                        logStep('RCPT TO', response);
                        
                        // Check if email exists based on response code
                        if (response.startsWith('250')) {
                            socket.write('QUIT\r\n');
                            resolve({ valid: true, sourceIP });
                        } else if (response.startsWith('550') || response.startsWith('551') || response.startsWith('553')) {
                            socket.write('QUIT\r\n');
                            resolve({ valid: false, reason: 'INVALID_RECIPIENT', details: response.trim(), sourceIP });
                        } else if (response.startsWith('452')) {
                            socket.write('QUIT\r\n');
                            resolve({ valid: false, reason: 'FULL_MAILBOX', details: response.trim(), sourceIP });
                        } else {
                            socket.write('QUIT\r\n');
                            resolve({ valid: false, reason: 'UNKNOWN_ERROR', details: response.trim(), sourceIP });
                        }
                        step = 4;
                        break;
                        
                    case 4: // QUIT sent
                        logStep('QUIT', response);
                        socket.destroy();
                        break;
                }
                
                setupTimeout();
            }
        });
        
        socket.on('error', (error) => {
            // Check if error indicates IP blocking
            const errorStr = error.message.toLowerCase();
            const isBlocked = IP_BLOCK_PATTERNS.some(pattern => 
                errorStr.includes(pattern.toLowerCase())
            );
            
            if (isBlocked) {
                logger.blockedIP({
                    sourceIP,
                    domain: email.split('@')[1],
                    error: error.message
                });
            }
            
            logger.error(error, {
                context: {
                    email,
                    sourceIP,
                    mxServer,
                    step
                }
            });
            
            resolve({ 
                valid: false, 
                reason: 'CONNECTION_ERROR', 
                details: error.message,
                sourceIP,
                isBlocked 
            });
        });
        
        // Connect to the SMTP server using specific source IP
        const options = {
            port: 25,
            host: mxServer,
            localAddress: sourceIP
        };
        
        socket.connect(options, () => {
            console.log(`[${email}][${sourceIP}] Connected to ${mxServer}`);
            setupTimeout();
        });
    });
}

/**
 * Verify multiple email patterns in parallel using IP pool
 * @param {Array<string>} emailPatterns - List of email patterns to verify
 * @param {string} mxServer - MX server to connect to
 * @param {string} fromEmail - Sender email
 * @returns {Promise<Map>} - Map of results for each email pattern
 */
async function verifyEmailPatterns(emailPatterns, mxServer, fromEmail = 'team@emailvalidator.online') {
    const verifyFn = async (email, ip) => {
        return await smtpVerify(email, mxServer, fromEmail, ip);
    };
    
    return await ipPool.verifyEmailsInParallel(emailPatterns, verifyFn);
}

module.exports = {
  verifyEmail,
  verifyEmailPatterns,
  detectCatchAllDomain,
  isKnownCatchAllDomain
};