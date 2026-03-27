/**
 * Setup SSE (Server-Sent Events) headers
 */
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/**
 * Send SSE message
 */
function sendSSE(res, event, data) {
  if (event) {
    res.write(`event: ${event}\n`);
  }
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Send SSE log message
 */
function sendLog(res, message) {
  sendSSE(res, 'log', { message, time: new Date().toISOString() });
}

/**
 * Send SSE status update
 */
function sendStatus(res, status, data = {}) {
  sendSSE(res, 'status', { status, ...data, time: new Date().toISOString() });
}

/**
 * Send SSE error
 */
function sendError(res, error) {
  sendSSE(res, 'error', { error: error.message || error, time: new Date().toISOString() });
}

/**
 * Send SSE completion
 */
function sendComplete(res, data = {}) {
  sendSSE(res, 'complete', { ...data, time: new Date().toISOString() });
}

module.exports = {
  setupSSE,
  sendSSE,
  sendLog,
  sendStatus,
  sendError,
  sendComplete
};
