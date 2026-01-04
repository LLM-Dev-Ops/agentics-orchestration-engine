/**
 * Error Recovery Strategies.
 *
 * Provides recovery mechanisms for different error types
 * during simulation execution.
 *
 * @module error/recovery
 */

import type {
  SimulationId,
  StepId,
  SnapshotId,
  ISOTimestamp,
  StateVersion,
} from '../types/common.js';
import {
  type ErrorClass,
  SimulationError,
  classifyError,
  ErrorCodes,
} from './types.js';

// ============================================================================
// RECOVERY STRATEGY TYPES
// ============================================================================

/**
 * Type of recovery action to take.
 */
export type RecoveryAction =
  | 'retry'
  | 'skip'
  | 'rollback'
  | 'restart'
  | 'abort'
  | 'manual';

/**
 * Result of attempting recovery.
 */
export interface RecoveryResult {
  readonly success: boolean;
  readonly action: RecoveryAction;
  readonly details: string;
  readonly newState?: {
    readonly version: StateVersion;
    readonly snapshotId?: SnapshotId;
  };
  readonly retryCount?: number;
  readonly nextRetryDelayMs?: number;
}

/**
 * Context for recovery decisions.
 */
export interface RecoveryContext {
  readonly simulationId: SimulationId;
  readonly stepId?: StepId;
  readonly errorClass: ErrorClass;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly availableSnapshots: ReadonlyArray<SnapshotId>;
  readonly elapsedTimeMs: number;
  readonly maxTimeMs: number;
}

// ============================================================================
// RECOVERY CONFIGURATION
// ============================================================================

/**
 * Configuration for error recovery.
 */
export interface RecoveryConfig {
  /** Maximum retry attempts for transient errors */
  readonly maxRetries: number;
  /** Base delay between retries (ms) */
  readonly baseRetryDelayMs: number;
  /** Maximum delay between retries (ms) */
  readonly maxRetryDelayMs: number;
  /** Backoff multiplier for retry delays */
  readonly backoffMultiplier: number;
  /** Whether to add jitter to retry delays */
  readonly addJitter: boolean;
  /** Maximum time to spend on recovery (ms) */
  readonly maxRecoveryTimeMs: number;
  /** Whether to auto-rollback on recoverable errors */
  readonly autoRollback: boolean;
  /** Snapshot interval for automatic checkpointing */
  readonly checkpointInterval: number;
}

/**
 * Default recovery configuration.
 */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 30000,
  backoffMultiplier: 2,
  addJitter: true,
  maxRecoveryTimeMs: 60000,
  autoRollback: true,
  checkpointInterval: 50,
};

// ============================================================================
// RECOVERY STRATEGY CLASS
// ============================================================================

/**
 * Determines and executes recovery strategies for simulation errors.
 */
export class RecoveryStrategy {
  private readonly config: RecoveryConfig;
  private readonly retryHistory: Map<string, RetryHistoryEntry[]> = new Map();
  private readonly getTime: () => ISOTimestamp;

  constructor(
    config?: Partial<RecoveryConfig>,
    getTime?: () => ISOTimestamp
  ) {
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // STRATEGY DETERMINATION
  // ==========================================================================

  /**
   * Determines the appropriate recovery action for an error.
   *
   * @param error - Error to recover from
   * @param context - Recovery context
   * @returns Recommended recovery action
   */
  determineAction(error: unknown, context: RecoveryContext): RecoveryAction {
    const classification = error instanceof SimulationError
      ? error.classification
      : classifyError(error);

    switch (classification) {
      case 'TRANSIENT':
        return this.determineTransientAction(error, context);

      case 'RECOVERABLE':
        return this.determineRecoverableAction(error, context);

      case 'POLICY_VIOLATION':
        return this.determinePolicyViolationAction(error, context);

      case 'RESOURCE_EXHAUSTION':
        return this.determineResourceExhaustionAction(error, context);

      case 'FATAL':
      default:
        return 'abort';
    }
  }

  /**
   * Determines action for transient errors.
   */
  private determineTransientAction(
    error: unknown,
    context: RecoveryContext
  ): RecoveryAction {
    // Check if we've exceeded max retries
    if (context.retryCount >= context.maxRetries) {
      return 'abort';
    }

    // Check if we have time for another retry
    const estimatedRetryTime = this.calculateRetryDelay(context.retryCount);
    if (context.elapsedTimeMs + estimatedRetryTime > context.maxTimeMs) {
      return 'abort';
    }

    return 'retry';
  }

  /**
   * Determines action for recoverable errors.
   */
  private determineRecoverableAction(
    error: unknown,
    context: RecoveryContext
  ): RecoveryAction {
    // Check if rollback is possible
    if (context.availableSnapshots.length > 0 && this.config.autoRollback) {
      return 'rollback';
    }

    // If no snapshots, try to skip the step
    if (context.stepId) {
      return 'skip';
    }

    return 'abort';
  }

  /**
   * Determines action for policy violation errors.
   */
  private determinePolicyViolationAction(
    _error: unknown,
    context: RecoveryContext
  ): RecoveryAction {
    // Policy violations typically require manual intervention
    // unless the step can be skipped
    if (context.stepId) {
      return 'skip';
    }
    return 'manual';
  }

  /**
   * Determines action for resource exhaustion errors.
   */
  private determineResourceExhaustionAction(
    _error: unknown,
    _context: RecoveryContext
  ): RecoveryAction {
    // Resource exhaustion usually requires cleanup or abort
    return 'abort';
  }

  // ==========================================================================
  // RETRY LOGIC
  // ==========================================================================

  /**
   * Calculates the delay before the next retry.
   *
   * @param retryCount - Current retry count
   * @returns Delay in milliseconds
   */
  calculateRetryDelay(retryCount: number): number {
    // Exponential backoff
    let delay = this.config.baseRetryDelayMs * Math.pow(this.config.backoffMultiplier, retryCount);

    // Cap at max delay
    delay = Math.min(delay, this.config.maxRetryDelayMs);

    // Add jitter if enabled
    if (this.config.addJitter) {
      const jitter = delay * 0.2 * Math.random();
      delay = delay + jitter - jitter / 2;
    }

    return Math.round(delay);
  }

  /**
   * Records a retry attempt.
   *
   * @param key - Unique key for the operation
   * @param error - Error that caused the retry
   */
  recordRetry(key: string, error: unknown): void {
    const history = this.retryHistory.get(key) ?? [];
    history.push({
      timestamp: this.getTime(),
      errorMessage: error instanceof Error ? error.message : String(error),
      errorClass: classifyError(error),
    });
    this.retryHistory.set(key, history);
  }

  /**
   * Gets retry history for an operation.
   *
   * @param key - Operation key
   */
  getRetryHistory(key: string): ReadonlyArray<RetryHistoryEntry> {
    return this.retryHistory.get(key) ?? [];
  }

  /**
   * Gets the retry count for an operation.
   *
   * @param key - Operation key
   */
  getRetryCount(key: string): number {
    return this.retryHistory.get(key)?.length ?? 0;
  }

  /**
   * Clears retry history for an operation.
   *
   * @param key - Operation key
   */
  clearRetryHistory(key: string): void {
    this.retryHistory.delete(key);
  }

  /**
   * Checks if an operation should retry.
   *
   * @param key - Operation key
   * @param error - Current error
   */
  shouldRetry(key: string, error: unknown): boolean {
    const retryCount = this.getRetryCount(key);
    if (retryCount >= this.config.maxRetries) {
      return false;
    }

    const classification = classifyError(error);
    return classification === 'TRANSIENT';
  }

  // ==========================================================================
  // RECOVERY EXECUTION
  // ==========================================================================

  /**
   * Executes recovery for an error.
   *
   * @param error - Error to recover from
   * @param context - Recovery context
   * @param handlers - Recovery handlers
   * @returns Recovery result
   */
  async executeRecovery(
    error: unknown,
    context: RecoveryContext,
    handlers: RecoveryHandlers
  ): Promise<RecoveryResult> {
    const action = this.determineAction(error, context);

    try {
      switch (action) {
        case 'retry':
          return await this.executeRetry(error, context, handlers);

        case 'skip':
          return await this.executeSkip(error, context, handlers);

        case 'rollback':
          return await this.executeRollback(error, context, handlers);

        case 'restart':
          return await this.executeRestart(error, context, handlers);

        case 'abort':
          return this.executeAbort(error, context);

        case 'manual':
          return this.requestManualIntervention(error, context);

        default:
          return this.executeAbort(error, context);
      }
    } catch (recoveryError) {
      // Recovery itself failed
      return {
        success: false,
        action: 'abort',
        details: `Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
      };
    }
  }

  private async executeRetry(
    error: unknown,
    context: RecoveryContext,
    handlers: RecoveryHandlers
  ): Promise<RecoveryResult> {
    const key = context.stepId ?? context.simulationId;
    this.recordRetry(key, error);

    const delay = this.calculateRetryDelay(context.retryCount);

    if (handlers.onRetry) {
      await handlers.onRetry(context.retryCount + 1, delay);
    }

    return {
      success: true,
      action: 'retry',
      details: `Will retry after ${delay}ms (attempt ${context.retryCount + 1}/${context.maxRetries})`,
      retryCount: context.retryCount + 1,
      nextRetryDelayMs: delay,
    };
  }

  private async executeSkip(
    error: unknown,
    context: RecoveryContext,
    handlers: RecoveryHandlers
  ): Promise<RecoveryResult> {
    if (handlers.onSkip && context.stepId) {
      await handlers.onSkip(context.stepId);
    }

    return {
      success: true,
      action: 'skip',
      details: `Skipped step ${context.stepId} due to error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  private async executeRollback(
    error: unknown,
    context: RecoveryContext,
    handlers: RecoveryHandlers
  ): Promise<RecoveryResult> {
    if (context.availableSnapshots.length === 0) {
      return {
        success: false,
        action: 'rollback',
        details: 'No snapshots available for rollback',
      };
    }

    const targetSnapshot = context.availableSnapshots[context.availableSnapshots.length - 1]!;

    if (handlers.onRollback) {
      const newVersion = await handlers.onRollback(targetSnapshot);
      return {
        success: true,
        action: 'rollback',
        details: `Rolled back to snapshot ${targetSnapshot}`,
        newState: {
          version: newVersion,
          snapshotId: targetSnapshot,
        },
      };
    }

    return {
      success: false,
      action: 'rollback',
      details: 'Rollback handler not provided',
    };
  }

  private async executeRestart(
    _error: unknown,
    context: RecoveryContext,
    handlers: RecoveryHandlers
  ): Promise<RecoveryResult> {
    if (handlers.onRestart) {
      await handlers.onRestart();
      return {
        success: true,
        action: 'restart',
        details: `Restarting simulation ${context.simulationId}`,
      };
    }

    return {
      success: false,
      action: 'restart',
      details: 'Restart handler not provided',
    };
  }

  private executeAbort(error: unknown, context: RecoveryContext): RecoveryResult {
    return {
      success: false,
      action: 'abort',
      details: `Aborting simulation ${context.simulationId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  private requestManualIntervention(
    error: unknown,
    context: RecoveryContext
  ): RecoveryResult {
    return {
      success: false,
      action: 'manual',
      details: `Manual intervention required for ${context.simulationId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// RECOVERY HANDLERS
// ============================================================================

/**
 * Handlers for recovery actions.
 */
export interface RecoveryHandlers {
  /** Called when a retry is initiated */
  onRetry?: (attempt: number, delayMs: number) => Promise<void> | void;
  /** Called when a step is skipped */
  onSkip?: (stepId: StepId) => Promise<void> | void;
  /** Called when rolling back to a snapshot */
  onRollback?: (snapshotId: SnapshotId) => Promise<StateVersion>;
  /** Called when restarting the simulation */
  onRestart?: () => Promise<void> | void;
}

// ============================================================================
// RETRY HISTORY
// ============================================================================

/**
 * Entry in retry history.
 */
export interface RetryHistoryEntry {
  readonly timestamp: ISOTimestamp;
  readonly errorMessage: string;
  readonly errorClass: ErrorClass;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a recovery strategy.
 */
export function createRecoveryStrategy(
  config?: Partial<RecoveryConfig>,
  getTime?: () => ISOTimestamp
): RecoveryStrategy {
  return new RecoveryStrategy(config, getTime);
}

// ============================================================================
// RETRY UTILITIES
// ============================================================================

/**
 * Executes an operation with automatic retry.
 *
 * @param operation - Operation to execute
 * @param config - Retry configuration
 * @returns Operation result
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config?: Partial<RecoveryConfig>
): Promise<T> {
  const strategy = new RecoveryStrategy(config);
  const maxRetries = config?.maxRetries ?? DEFAULT_RECOVERY_CONFIG.maxRetries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!strategy.shouldRetry(`retry-${attempt}`, error)) {
        throw error;
      }

      const delay = strategy.calculateRetryDelay(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
