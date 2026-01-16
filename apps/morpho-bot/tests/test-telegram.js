/**
 * Test script for Telegram notifications
 * Simulates a successful liquidation notification
 */

const { getConfig } = require('../src/lib/env');
const { createTelegramClient } = require('../src/lib/telegram');
const { formatSuccess } = require('../src/lib/telegramFormat');

async function testTelegramNotification() {
  // Load config
  const config = getConfig();

  // Check if Telegram is enabled
  if (!config.telegramEnabled) {
    console.error('❌ TELEGRAM_ENABLED is not set to 1');
    console.log('Set TELEGRAM_ENABLED=1 in your .env file');
    process.exit(1);
  }

  if (!config.telegramToken) {
    console.error('❌ TELEGRAM_TOKEN is not set');
    console.log('Set TELEGRAM_TOKEN=your_bot_token in your .env file');
    process.exit(1);
  }

  console.log('📱 Testing Telegram notification...');
  console.log(`   Chat ID: ${config.telegramChatId}`);
  console.log(`   Rate Limit: ${config.telegramRateLimitSeconds}s between messages`);
  console.log(`   Max Per Hour: ${config.telegramMaxPerHour}`);
  console.log('');

  // Create Telegram client
  const telegramClient = createTelegramClient({
    token: config.telegramToken,
    chatId: config.telegramChatId,
    enabled: config.telegramEnabled,
    rateLimitSeconds: config.telegramRateLimitSeconds,
    maxPerHour: config.telegramMaxPerHour,
  });

  // Simulate a successful liquidation
  const testData = {
    chainId: config.chainId || 999,
    mode: 'FLASHLOAN', // or 'PREFUND'
    marketId: '0x1234567890abcdef1234567890abcdef12345678',
    user: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    loanToken: 'USDC',
    collateralToken: 'WETH',
    repayAssets: 1000000000n, // 1000 USDC (6 decimals)
    loanDecimals: 6,
    profitAssets: {
      profit: 50000000n, // 50 USDC profit (6 decimals)
      profitable: true,
    },
    txHash: '0x' + 'a'.repeat(64), // Fake tx hash
  };

  // Format success message
  const message = formatSuccess(testData);

  console.log('📤 Sending test notification...');
  console.log('');
  console.log('Message content:');
  console.log('─'.repeat(50));
  console.log(message);
  console.log('─'.repeat(50));
  console.log('');

  // Send notification
  const success = await telegramClient.send(
    testData.txHash,
    message,
    { dedupeKey: testData.txHash }
  );

  if (success) {
    console.log('✅ Notification sent successfully!');
    console.log('Check your Telegram chat to verify.');
  } else {
    console.log('⚠️  Notification was not sent (may be rate-limited or deduplicated)');
    console.log('Try again in a few seconds.');
  }

  // Cleanup
  telegramClient.cleanup();
}

// Run test
testTelegramNotification().catch(error => {
  console.error('❌ Test failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
