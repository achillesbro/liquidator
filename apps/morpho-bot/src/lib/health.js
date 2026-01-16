/**
 * Minimal health server for Docker healthcheck and monitoring
 * No external dependencies - uses Node http module
 */

const http = require('http');

/**
 * Shared health state - updated by scheduler
 */
const state = {
  startedAt: new Date().toISOString(),
  lastTickAt: null,
  lastTickDurationMs: null,
  lastErrorAt: null,
  firstTickComplete: false,
  mode: 'BASE',
  executionEnabled: false,
  tickBaseSeconds: 30,
};

/**
 * Update health state after a tick
 * @param {Object} update - Partial state update
 */
function updateHealthState(update) {
  Object.assign(state, update);
}

/**
 * Mark first tick complete (for /ready endpoint)
 */
function markReady() {
  state.firstTickComplete = true;
}

/**
 * Get health state
 * @returns {Object} Current health state
 */
function getHealthState() {
  return { ...state };
}

/**
 * Check if scheduler is degraded (stuck/slow)
 * @returns {boolean} True if degraded
 */
function isDegraded() {
  if (!state.lastTickAt) {
    return false; // Not degraded if no tick yet
  }
  
  const now = Date.now();
  const lastTick = new Date(state.lastTickAt).getTime();
  const threshold = (2 * state.tickBaseSeconds + 30) * 1000; // 2 * base + 30s
  
  return now - lastTick > threshold;
}

/**
 * Create and start health server
 * @param {number} port - Port to listen on
 * @returns {http.Server} HTTP server instance
 */
function createHealthServer(port = 4001) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    
    if (req.method === 'GET' && url.pathname === '/health') {
      const status = isDegraded() ? 'degraded' : 'ok';
      const body = JSON.stringify({
        status,
        startedAt: state.startedAt,
        lastTickAt: state.lastTickAt,
        lastTickDurationMs: state.lastTickDurationMs,
        lastErrorAt: state.lastErrorAt,
        mode: state.mode,
        executionEnabled: state.executionEnabled,
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    
    if (req.method === 'GET' && url.pathname === '/ready') {
      if (state.firstTickComplete) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready: true }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready: false, reason: 'First tick not complete' }));
      }
      return;
    }
    
    // 404 for other paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  
  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });
  
  // Handle errors gracefully
  server.on('error', (err) => {
    console.error(`Health server error: ${err.message}`);
  });
  
  return server;
}

module.exports = {
  updateHealthState,
  markReady,
  getHealthState,
  isDegraded,
  createHealthServer,
};
