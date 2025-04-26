const { promisify } = require('util');
const sleep = promisify(setTimeout);

class IPPoolManager {
    constructor(ips) {
        this.ips = ips;
        this.lastUsedTimes = new Map();
        this.currentIndex = 0;
        
        // Initialize last used times
        ips.forEach(ip => {
            this.lastUsedTimes.set(ip, 0);
        });
    }

    async getNextAvailableIP() {
        const now = Date.now();
        const ip = this.ips[this.currentIndex];
        const lastUsed = this.lastUsedTimes.get(ip);
        
        // Check if we need to wait (0.5s timeout)
        const timeSinceLastUse = now - lastUsed;
        if (timeSinceLastUse < 500) {
            await sleep(500 - timeSinceLastUse);
        }
        
        // Update last used time and rotate index
        this.lastUsedTimes.set(ip, Date.now());
        this.currentIndex = (this.currentIndex + 1) % this.ips.length;
        
        return ip;
    }

    async verifyEmailsInParallel(emails, verifyFn) {
        // Group emails into batches based on number of IPs
        const batchSize = this.ips.length;
        const batches = [];
        
        for (let i = 0; i < emails.length; i += batchSize) {
            batches.push(emails.slice(i, i + batchSize));
        }

        const results = new Map();
        let foundValidEmail = false;
        
        // Process each batch in parallel
        for (const batch of batches) {
            if (foundValidEmail) {
                break; // Stop processing if we found a valid email
            }
            
            const verificationPromises = batch.map(async (email) => {
                // Skip if we already found a valid email
                if (foundValidEmail) return;
                
                const ip = await this.getNextAvailableIP();
                const result = await verifyFn(email, ip);
                results.set(email, result);
                
                // Check if this is a valid email
                if (result.valid) {
                    foundValidEmail = true;
                }
            });
            
            // Wait for current batch to complete before moving to next
            await Promise.all(verificationPromises);
        }
        
        return {
            results,
            foundValidEmail
        };
    }
}

module.exports = IPPoolManager; 