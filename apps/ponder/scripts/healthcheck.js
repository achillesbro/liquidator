#!/usr/bin/env node

/**
 * Healthcheck script for Ponder service
 * Checks if Ponder is running and responsive
 */

const PONDER_URL = process.env.PONDER_SERVICE_URL || 'http://localhost:42069';

async function checkHealth() {
  try {
    console.log(`Checking Ponder health at ${PONDER_URL}...`);
    
    const response = await fetch(`${PONDER_URL}/health`);
    
    if (!response.ok) {
      console.error(`❌ Ponder health check failed: ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    
    const data = await response.json();
    console.log('✓ Ponder is healthy');
    console.log(`  Status: ${data.status}`);
    console.log(`  Timestamp: ${new Date(data.timestamp).toISOString()}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to connect to Ponder:', error.message);
    console.error('\n💡 Make sure Ponder is running:');
    console.error('   pnpm ponder:dev');
    process.exit(1);
  }
}

checkHealth();
