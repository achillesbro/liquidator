/**
 * Scheduler with adaptive cadence, jitter, and single-flight execution
 * Handles timing, mode transitions, and metrics tracking
 */

const { updateHealthState, markReady } = require('./health');

/**
 * Tick metrics structure
 * @typedef {Object} TickMetrics
 * @property {number} fetchedVaults
 * @property {number} fetchedMarkets
 * @property {number} fetchedCandidates
 * @property {number} confirmedCount
 * @property {number} liquidatableCount
 * @property {number} simulatedCount
 * @property {number} simSuccessCount
 * @property {number} profitOkCount
 * @property {number} executedCount
 * @property {number} execSuccessCount
 * @property {number} errorsCount
 * @property {number} durationMs
 * @property {Object} triggers
 * @property {boolean} triggers.hasLiquidatable
 * @property {boolean} triggers.hasExec
 * @property {boolean} triggers.hasNearMiss
 */

/**
 * Scheduler state
 */
class Scheduler {
  constructor(config) {
    this.config = config;
    this.baseSeconds = config.tickBaseSeconds || 30;
    this.fastSeconds = config.tickFastSeconds || 10;
    this.jitterPct = config.jitterPct || 10;
    this.fastModeMinutes = config.fastModeMinutes || 5;

    // State
    this.mode = 'BASE'; // 'BASE' or 'FAST'
    this.fastModeUntil = 0; // Timestamp when fast mode expires
    this.isRunning = false;
    this.currentTick = null; // Promise of current tick
    this.shutdownRequested = false;
    this.tickNumber = 0;
  }

  /**
   * Calculate next interval with jitter
   * @param {number} baseSeconds - Base interval in seconds
   * @returns {number} Interval in milliseconds with jitter
   */
  calculateInterval(baseSeconds) {
    const jitterRange = (baseSeconds * this.jitterPct) / 100;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // ±jitterRange
    const intervalSeconds = baseSeconds + jitter;
    return Math.max(1000, intervalSeconds * 1000); // At least 1 second
  }

  /**
   * Update mode based on tick metrics
   * @param {TickMetrics} metrics - Tick metrics
   */
  updateMode(metrics) {
    const now = Date.now();
    const triggers = metrics.triggers || {};

    // Check for triggers that should activate fast mode
    if (triggers.hasLiquidatable || triggers.hasExec) {
      this.mode = 'FAST';
      this.fastModeUntil = now + this.fastModeMinutes * 60 * 1000;
      return true; // Mode changed
    }

    // Check if fast mode should expire
    if (this.mode === 'FAST' && now >= this.fastModeUntil) {
      this.mode = 'BASE';
      return true; // Mode changed
    }

    return false; // No change
  }

  /**
   * Get current interval based on mode
   * @returns {number} Interval in milliseconds
   */
  getCurrentInterval() {
    const baseSeconds = this.mode === 'FAST' ? this.fastSeconds : this.baseSeconds;
    return this.calculateInterval(baseSeconds);
  }

  /**
   * Run scheduler loop
   * @param {Function} runTick - Async function that runs a single tick: (ctx) => Promise<TickMetrics>
   * @param {Object} ctx - Context object passed to runTick
   * @param {Function} onShutdown - Optional cleanup function called before shutdown: () => Promise<void>
   */
  async runScheduler(runTick, ctx, onShutdown) {
    this.isRunning = true;
    this.shutdownRequested = false;

    console.log('\n' + '='.repeat(70));
    console.log('Scheduler started');
    console.log(`Mode: ${this.mode} (${this.baseSeconds}s base, ${this.fastSeconds}s fast)`);
    console.log(`Jitter: ±${this.jitterPct}%`);
    console.log('='.repeat(70) + '\n');

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n⏸ Shutdown requested. Waiting for current tick to finish...');
      this.shutdownRequested = true;

      // Wait for current tick with timeout
      const maxShutdownWait = 30000; // 30 seconds
      const startWait = Date.now();

      while (this.currentTick && Date.now() - startWait < maxShutdownWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.currentTick) {
        console.log('⚠ Current tick did not finish in time. Forcing exit.');
      }

      // Call cleanup callback if provided
      if (onShutdown) {
        try {
          await onShutdown();
        } catch (error) {
          console.error('Cleanup error:', error.message);
        }
      }

      this.isRunning = false;
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Main loop
    while (this.isRunning && !this.shutdownRequested) {
      const interval = this.getCurrentInterval();
      const modeBefore = this.mode;

      // Run tick
      const tickStart = Date.now();
      this.tickNumber++;

      try {
        // Single-flight: wait for current tick if still running
        if (this.currentTick) {
          await this.currentTick;
        }

        // Run new tick
        this.currentTick = this.runTickWithMetrics(runTick, ctx);
        const metrics = await this.currentTick;
        this.currentTick = null;

        // Update mode based on metrics
        const modeChanged = this.updateMode(metrics);

        // Log tick summary
        this.logTickSummary(this.tickNumber, metrics, modeBefore, modeChanged);

        // Log mode transition if changed
        if (modeChanged) {
          this.logModeTransition(modeBefore, this.mode, metrics.triggers);
        }

      } catch (error) {
        this.currentTick = null;
        console.error(`\n❌ Tick ${this.tickNumber} error:`, error.message);
        if (error.stack) {
          console.error(error.stack);
        }
      }

      // Wait for next tick (unless shutdown requested)
      if (!this.shutdownRequested) {
        const elapsed = Date.now() - tickStart;
        const waitTime = Math.max(0, interval - elapsed);

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          // Tick took longer than interval, continue immediately
          console.log(`⚠ Tick took ${(elapsed / 1000).toFixed(1)}s (longer than interval)`);
        }
      }
    }
  }

  /**
   * Run tick with metrics collection
   * @param {Function} runTick - Tick function
   * @param {Object} ctx - Context
   * @returns {Promise<TickMetrics>} Tick metrics
   */
  async runTickWithMetrics(runTick, ctx) {
    const startTime = Date.now();

    try {
      const metrics = await runTick(ctx);
      const durationMs = Date.now() - startTime;

      // Update health state on success
      updateHealthState({
        lastTickAt: new Date().toISOString(),
        lastTickDurationMs: durationMs,
        mode: this.mode,
      });
      markReady();

      return {
        ...metrics,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Update health state on error
      updateHealthState({
        lastTickAt: new Date().toISOString(),
        lastTickDurationMs: durationMs,
        lastErrorAt: new Date().toISOString(),
        mode: this.mode,
      });
      markReady(); // Still mark ready - tick ran, just errored

      return {
        fetchedVaults: 0,
        fetchedMarkets: 0,
        fetchedCandidates: 0,
        confirmedCount: 0,
        liquidatableCount: 0,
        simulatedCount: 0,
        simSuccessCount: 0,
        profitOkCount: 0,
        executedCount: 0,
        execSuccessCount: 0,
        errorsCount: 1,
        durationMs,
        triggers: {},
      };
    }
  }

  /**
   * Log tick summary
   * @param {number} tickNumber - Tick number
   * @param {TickMetrics} metrics - Tick metrics
   * @param {string} modeBefore - Mode before tick
   * @param {boolean} modeChanged - Whether mode changed
   */
  logTickSummary(tickNumber, metrics, modeBefore, modeChanged) {
    const modeLabel = this.mode === 'FAST' ? 'FAST' : 'BASE';
    const duration = (metrics.durationMs / 1000).toFixed(1);
    const cadence = this.mode === 'FAST' ? this.fastSeconds : this.baseSeconds;

    const parts = [
      `[T${tickNumber}]`,
      `${modeLabel}(${cadence}s)`,
      `${duration}s`,
      `C:${metrics.fetchedCandidates}`,
      `Cf:${metrics.confirmedCount}`,
      `L:${metrics.liquidatableCount}`,
      `S:${metrics.simSuccessCount}/${metrics.simulatedCount}`,
    ];

    if (metrics.executedCount > 0) {
      parts.push(`E:${metrics.execSuccessCount}/${metrics.executedCount}`);
    }

    if (metrics.errorsCount > 0) {
      parts.push(`Err:${metrics.errorsCount}`);
    }

    console.log(parts.join(' '));
  }

  /**
   * Log mode transition
   * @param {string} fromMode - Previous mode
   * @param {string} toMode - New mode
   * @param {Object} triggers - Trigger information
   */
  logModeTransition(fromMode, toMode, triggers) {
    if (fromMode === toMode) {
      return;
    }

    let reason = '';
    if (triggers.hasLiquidatable) {
      reason = 'liquidatable found';
    } else if (triggers.hasExec) {
      reason = 'execution occurred';
    } else if (toMode === 'BASE') {
      reason = 'fast mode expired';
    }

    console.log(`→ ${toMode} MODE${reason ? ` (reason: ${reason})` : ''}`);
  }

  /**
   * Stop scheduler
   */
  stop() {
    this.shutdownRequested = true;
    this.isRunning = false;
  }
}

module.exports = { Scheduler };
