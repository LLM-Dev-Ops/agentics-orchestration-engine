/**
 * Timeout Controller.
 *
 * Provides timeout management for simulation operations.
 * Supports both operation-level and simulation-level timeouts.
 *
 * @module core/resources/timeout
 */

import type { ISOTimestamp } from '../../types/common.js';
import {
  ResourceExhaustionError,
  ErrorCodes,
} from '../../error/types.js';

// ============================================================================
// TIMEOUT CONFIGURATION
// ============================================================================

/**
 * Configuration for a timeout.
 */
export interface TimeoutConfig {
  /** Timeout duration in milliseconds */
  readonly durationMs: number;
  /** Description of what is being timed */
  readonly description?: string;
  /** Whether to throw on timeout (default: true) */
  readonly throwOnTimeout?: boolean;
  /** Callback when timeout occurs */
  readonly onTimeout?: () => void;
}

// ============================================================================
// TIMEOUT HANDLE
// ============================================================================

/**
 * Handle for managing a timeout.
 */
export interface TimeoutHandle {
  /** Unique ID for this timeout */
  readonly id: string;
  /** When the timeout was started */
  readonly startedAt: ISOTimestamp;
  /** When the timeout will expire */
  readonly expiresAt: ISOTimestamp;
  /** Remaining time in milliseconds */
  readonly remainingMs: number;
  /** Whether the timeout has been cancelled */
  readonly cancelled: boolean;
  /** Whether the timeout has expired */
  readonly expired: boolean;
  /** Cancels the timeout */
  cancel(): void;
  /** Extends the timeout by the given milliseconds */
  extend(ms: number): void;
}

// ============================================================================
// TIMEOUT CONTROLLER CLASS
// ============================================================================

/**
 * Manages timeouts for simulation operations.
 *
 * Key features:
 * - Operation-level timeouts
 * - Timeout extension
 * - Timeout cancellation
 * - Automatic cleanup
 */
export class TimeoutController {
  private readonly activeTimeouts: Map<string, TimeoutEntry> = new Map();
  private nextId = 0;
  private readonly getTime: () => ISOTimestamp;

  constructor(getTime?: () => ISOTimestamp) {
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // TIMEOUT CREATION
  // ==========================================================================

  /**
   * Creates a timeout.
   *
   * @param config - Timeout configuration
   * @returns Timeout handle
   */
  setTimeout(config: TimeoutConfig): TimeoutHandle {
    const id = `timeout-${++this.nextId}`;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + config.durationMs);

    const entry: TimeoutEntry = {
      id,
      config,
      startedAt,
      expiresAt,
      cancelled: false,
      expired: false,
      timerId: null,
    };

    // Set up the timer
    entry.timerId = global.setTimeout(() => {
      entry.expired = true;
      this.handleTimeout(entry);
    }, config.durationMs);

    this.activeTimeouts.set(id, entry);

    return this.createHandle(entry);
  }

  /**
   * Creates a timeout that rejects a promise after the specified duration.
   *
   * @param durationMs - Timeout duration
   * @param description - Description for error message
   */
  createTimeoutPromise(
    durationMs: number,
    description?: string
  ): Promise<never> {
    return new Promise((_, reject) => {
      this.setTimeout({
        durationMs,
        description,
        onTimeout: () => {
          reject(
            new ResourceExhaustionError(
              description ?? 'Operation timed out',
              ErrorCodes.EXECUTION_TIMEOUT,
              'time',
              durationMs,
              durationMs,
              {
                component: 'TimeoutController',
                operation: 'createTimeoutPromise',
              }
            )
          );
        },
      });
    });
  }

  /**
   * Executes an operation with a timeout.
   *
   * @param operation - Operation to execute
   * @param config - Timeout configuration
   * @returns Operation result
   */
  async withTimeout<T>(
    operation: () => Promise<T>,
    config: TimeoutConfig
  ): Promise<T> {
    const handle = this.setTimeout(config);

    try {
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise(config.durationMs, config.description),
      ]);
      handle.cancel();
      return result;
    } catch (error) {
      handle.cancel();
      throw error;
    }
  }

  /**
   * Executes an operation with a simple timeout.
   *
   * @param operation - Operation to execute
   * @param durationMs - Timeout duration
   * @param description - Description for error message
   */
  async withSimpleTimeout<T>(
    operation: () => Promise<T>,
    durationMs: number,
    description?: string
  ): Promise<T> {
    return this.withTimeout(operation, { durationMs, description });
  }

  // ==========================================================================
  // TIMEOUT MANAGEMENT
  // ==========================================================================

  /**
   * Gets a timeout handle by ID.
   */
  getTimeout(id: string): TimeoutHandle | undefined {
    const entry = this.activeTimeouts.get(id);
    return entry ? this.createHandle(entry) : undefined;
  }

  /**
   * Cancels a timeout by ID.
   */
  cancelTimeout(id: string): boolean {
    const entry = this.activeTimeouts.get(id);
    if (!entry || entry.cancelled) {
      return false;
    }

    if (entry.timerId !== null) {
      clearTimeout(entry.timerId);
    }
    entry.cancelled = true;
    this.activeTimeouts.delete(id);
    return true;
  }

  /**
   * Cancels all active timeouts.
   */
  cancelAll(): number {
    let count = 0;
    for (const [id] of this.activeTimeouts) {
      if (this.cancelTimeout(id)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets the count of active timeouts.
   */
  getActiveCount(): number {
    return this.activeTimeouts.size;
  }

  /**
   * Gets all active timeout handles.
   */
  getActiveTimeouts(): ReadonlyArray<TimeoutHandle> {
    return Array.from(this.activeTimeouts.values()).map((entry) =>
      this.createHandle(entry)
    );
  }

  // ==========================================================================
  // DEADLINE SUPPORT
  // ==========================================================================

  /**
   * Creates a deadline that expires at a specific time.
   *
   * @param deadline - Deadline timestamp
   * @param description - Description for error message
   */
  setDeadline(
    deadline: ISOTimestamp,
    description?: string
  ): TimeoutHandle {
    const now = new Date();
    const deadlineTime = new Date(deadline);
    const durationMs = Math.max(0, deadlineTime.getTime() - now.getTime());

    return this.setTimeout({
      durationMs,
      description: description ?? `Deadline: ${deadline}`,
    });
  }

  /**
   * Checks if a deadline has passed.
   */
  isDeadlinePassed(deadline: ISOTimestamp): boolean {
    return new Date() >= new Date(deadline);
  }

  /**
   * Gets remaining time until a deadline.
   */
  getTimeUntilDeadline(deadline: ISOTimestamp): number {
    return Math.max(0, new Date(deadline).getTime() - Date.now());
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private createHandle(entry: TimeoutEntry): TimeoutHandle {
    const self = this;
    return {
      id: entry.id,
      startedAt: entry.startedAt.toISOString() as ISOTimestamp,
      expiresAt: entry.expiresAt.toISOString() as ISOTimestamp,
      get remainingMs() {
        if (entry.cancelled || entry.expired) {
          return 0;
        }
        return Math.max(0, entry.expiresAt.getTime() - Date.now());
      },
      get cancelled() {
        return entry.cancelled;
      },
      get expired() {
        return entry.expired;
      },
      cancel() {
        self.cancelTimeout(entry.id);
      },
      extend(ms: number) {
        self.extendTimeout(entry.id, ms);
      },
    };
  }

  private extendTimeout(id: string, ms: number): void {
    const entry = this.activeTimeouts.get(id);
    if (!entry || entry.cancelled || entry.expired) {
      return;
    }

    // Clear existing timer
    if (entry.timerId !== null) {
      clearTimeout(entry.timerId);
    }

    // Update expiration
    entry.expiresAt = new Date(entry.expiresAt.getTime() + ms);

    // Set new timer
    const remainingMs = entry.expiresAt.getTime() - Date.now();
    if (remainingMs > 0) {
      entry.timerId = global.setTimeout(() => {
        entry.expired = true;
        this.handleTimeout(entry);
      }, remainingMs);
    }
  }

  private handleTimeout(entry: TimeoutEntry): void {
    this.activeTimeouts.delete(entry.id);

    // Call callback if provided
    if (entry.config.onTimeout) {
      entry.config.onTimeout();
    }

    // Throw if configured
    if (entry.config.throwOnTimeout !== false) {
      throw new ResourceExhaustionError(
        entry.config.description ?? 'Operation timed out',
        ErrorCodes.EXECUTION_TIMEOUT,
        'time',
        entry.config.durationMs,
        entry.config.durationMs,
        {
          component: 'TimeoutController',
          operation: 'handleTimeout',
          details: {
            timeoutId: entry.id,
            startedAt: entry.startedAt.toISOString(),
            expiresAt: entry.expiresAt.toISOString(),
          },
        }
      );
    }
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Disposes of the timeout controller.
   */
  dispose(): void {
    this.cancelAll();
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Internal timeout entry.
 */
interface TimeoutEntry {
  readonly id: string;
  readonly config: TimeoutConfig;
  readonly startedAt: Date;
  expiresAt: Date;
  cancelled: boolean;
  expired: boolean;
  timerId: NodeJS.Timeout | null;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a timeout controller.
 */
export function createTimeoutController(
  getTime?: () => ISOTimestamp
): TimeoutController {
  return new TimeoutController(getTime);
}

/**
 * Executes an operation with a timeout.
 *
 * @param operation - Operation to execute
 * @param durationMs - Timeout duration
 * @param description - Description for error message
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  durationMs: number,
  description?: string
): Promise<T> {
  const controller = new TimeoutController();
  try {
    return await controller.withSimpleTimeout(operation, durationMs, description);
  } finally {
    controller.dispose();
  }
}

/**
 * Creates a promise that rejects after the specified duration.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a promise that rejects after the specified duration.
 */
export function timeout(ms: number, description?: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new ResourceExhaustionError(
          description ?? 'Operation timed out',
          ErrorCodes.EXECUTION_TIMEOUT,
          'time',
          ms,
          ms,
          {
            component: 'timeout',
            operation: 'timeout',
          }
        )
      );
    }, ms);
  });
}
