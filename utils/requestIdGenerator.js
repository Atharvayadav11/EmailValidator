/**
 * Generate a unique request ID
 * @returns {string} Unique request ID
 */
function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
    generateRequestId
}; 