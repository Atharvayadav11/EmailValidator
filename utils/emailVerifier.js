// utils/emailVerifier.js
const dns = require('dns');
const net = require('net');
const { promisify } = require('util');

const resolveMx = promisify(dns.resolveMx);

/**
 * Verify an email using SMTP handshake
 * @param {string} email - The email to verify
 * @param {string} fromEmail - The email to use as sender
 * @returns {Promise<Object>} - Verification result
 */
async function verifyEmail(email, fromEmail = 'team@emailvalidator.online') {
  const domain = email.split('@')[1];
  
  try {
    console.log(`Starting verification for ${email}`);
    
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
 * Perform SMTP handshake to verify email
 * @param {string} email - The email to verify
 * @param {string} mxServer - MX server to connect to
 * @param {string} fromEmail - Sender email
 * @returns {Promise<Object>} - Verification result
 */
function smtpVerify(email, mxServer, fromEmail) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responseBuffer = '';
    let step = 0;
    let timeoutId;
    
    // Log helper
    const logStep = (stepName, data) => {
      console.log(`[${email}] ${stepName}: ${data.trim()}`);
    };
    
    // Set timeout
    const setTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        console.log(`[${email}] Connection timed out`);
        socket.destroy();
        resolve({ valid: false, reason: 'TIMEOUT' });
      }, 10000); // 10 second timeout
    };
    
    // Handle responses
    socket.on('data', (data) => {
      clearTimeout(timeoutId);
      responseBuffer += data.toString();
      
      // If we have a complete response (ends with \r\n)
      if (responseBuffer.endsWith('\r\n')) {
        const response = responseBuffer;
        responseBuffer = '';
        
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
              resolve({ valid: true });
            } else if (response.startsWith('550') || response.startsWith('551') || response.startsWith('553')) {
              socket.write('QUIT\r\n');
              resolve({ valid: false, reason: 'INVALID_RECIPIENT', details: response.trim() });
            } else if (response.startsWith('452')) {
              socket.write('QUIT\r\n');
              resolve({ valid: false, reason: 'FULL_MAILBOX', details: response.trim() });
            } else {
              socket.write('QUIT\r\n');
              resolve({ valid: false, reason: 'UNKNOWN_ERROR', details: response.trim() });
            }
            step = 4;
            break;
            
          case 4: // QUIT sent
            logStep('QUIT', response);
            socket.destroy();
            break;
        }
        
        setTimeout();
      }
    });
    
    socket.on('error', (error) => {
      console.error(`[${email}] Connection error:`, error.message);
      resolve({ valid: false, reason: 'CONNECTION_ERROR', details: error.message });
    });
    
    // Connect to the SMTP server
    socket.connect(25, mxServer, () => {
      console.log(`[${email}] Connected to ${mxServer}`);
      setTimeout();
    });
  });
}

module.exports = {
  verifyEmail
};