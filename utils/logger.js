const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

class Logger {
    constructor() {
        this.baseLogDir = path.join(process.cwd(), 'logs');
        this.currentDate = format(new Date(), 'yyyy-MM-dd');
        this.streams = new Map();
        this.ensureLogDirectory();
        this.initializeStreams();
        
        // Check for date change every minute
        setInterval(() => this.checkDateChange(), 60000);
    }

    ensureLogDirectory() {
        // Create base log directory
        if (!fs.existsSync(this.baseLogDir)) {
            fs.mkdirSync(this.baseLogDir, { recursive: true });
        }
        
        // Create directory for current date
        this.currentLogDir = path.join(this.baseLogDir, this.currentDate);
        if (!fs.existsSync(this.currentLogDir)) {
            fs.mkdirSync(this.currentLogDir, { recursive: true });
        }
    }

    getLogPath(type) {
        const time = format(new Date(), 'HH');
        return path.join(this.currentLogDir, `${type}_${time}h.log`);
    }

    initializeStreams() {
        // Close existing streams if any
        for (const stream of this.streams.values()) {
            stream.end();
        }
        this.streams.clear();

        // Initialize new streams
        const logTypes = ['general', 'success', 'catchall', 'error', 'blocked_ips'];
        for (const type of logTypes) {
            const logPath = this.getLogPath(type);
            this.streams.set(type, fs.createWriteStream(logPath, { flags: 'a' }));
        }
    }

    checkDateChange() {
        const newDate = format(new Date(), 'yyyy-MM-dd');
        if (newDate !== this.currentDate) {
            this.currentDate = newDate;
            this.ensureLogDirectory();
            this.initializeStreams();
        }
    }

    formatLogEntry(type, data) {
        const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
        const logData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        return `[${timestamp}] [${type}]\n${logData}\n${'='.repeat(80)}\n`;
    }

    writeToLog(type, entry) {
        const stream = this.streams.get(type);
        if (stream) {
            stream.write(entry);
        }
    }

    log(message, data = {}) {
        const logEntry = this.formatLogEntry('INFO', {
            message,
            ...data,
            timestamp: new Date().toISOString()
        });
        this.writeToLog('general', logEntry);
        console.log(logEntry);
    }

    success(data) {
        const { firstName, lastName, company, verifiedEmail, timeTaken, patternsChecked } = data;
        const logEntry = this.formatLogEntry('SUCCESS', {
            requestId: data.requestId,
            firstName,
            lastName,
            company,
            verifiedEmail,
            timeTaken,
            patternsChecked,
            timestamp: new Date().toISOString()
        });
        this.writeToLog('success', logEntry);
        this.log('Email verification successful', { verifiedEmail });
    }

    catchall(data) {
        const { domain, company, detectionMethod, timeTaken } = data;
        const logEntry = this.formatLogEntry('CATCH-ALL', {
            requestId: data.requestId,
            domain,
            company,
            detectionMethod,
            timeTaken,
            timestamp: new Date().toISOString()
        });
        this.writeToLog('catchall', logEntry);
        this.log('Catch-all domain detected', { domain });
    }

    error(error, context = {}) {
        const logEntry = this.formatLogEntry('ERROR', {
            requestId: context.requestId,
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code
            },
            context,
            timestamp: new Date().toISOString()
        });
        this.writeToLog('error', logEntry);
        console.error(logEntry);
    }

    blockedIP(data) {
        const { ip, domain, error, timestamp = new Date() } = data;
        const logEntry = this.formatLogEntry('BLOCKED-IP', {
            requestId: data.requestId,
            ip,
            domain,
            error,
            timestamp: timestamp.toISOString()
        });
        this.writeToLog('blocked_ips', logEntry);
        this.log('IP blocked detected', { ip, domain });
    }

    // Clean up method to close all streams
    cleanup() {
        for (const stream of this.streams.values()) {
            stream.end();
        }
        this.streams.clear();
    }
}

// Create singleton instance
const logger = new Logger();

// Handle process termination
process.on('SIGTERM', () => logger.cleanup());
process.on('SIGINT', () => logger.cleanup());

// Export just the logger instance
module.exports = logger; 