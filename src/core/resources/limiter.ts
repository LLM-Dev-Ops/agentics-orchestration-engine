/**
 * Resource Limiter.
 *
 * Enforces resource limits during simulation execution.
 * Prevents simulations from consuming excessive resources.
 *
 * @module core/resources/limiter
 */

import type {
  SimulationId,
  ISOTimestamp,
  ResourceLimits,
} from '../../types/common.js';
import {
  ResourceExhaustionError,
  ErrorCodes,
  type ErrorCode,
} from '../../error/types.js';

// ============================================================================
// RESOURCE USAGE TYPES
// ============================================================================

/**
 * Current resource usage statistics.
 */
export interface ResourceUsage {
  /** Elapsed execution time in milliseconds */
  readonly elapsedTimeMs: number;
  /** Estimated memory usage in bytes */
  readonly memoryBytes: number;
  /** Current concurrent operations */
  readonly concurrency: number;
  /** Number of snapshots created */
  readonly snapshots: number;
  /** Number of trace events recorded */
  readonly traceEvents: number;
}

/**
 * Resource limit check result.
 */
export interface ResourceCheckResult {
  readonly withinLimits: boolean;
  readonly violations: ReadonlyArray<{
    readonly resource: keyof ResourceLimits;
    readonly current: number;
    readonly limit: number;
    readonly percentUsed: number;
  }>;
  readonly warnings: ReadonlyArray<{
    readonly resource: keyof ResourceLimits;
    readonly current: number;
    readonly limit: number;
    readonly percentUsed: number;
  }>;
}

// ============================================================================
// RESOURCE LIMITER CONFIGURATION
// ============================================================================

/**
 * Configuration for resource limiter.
 */
export interface ResourceLimiterConfig {
  /** Resource limits to enforce */
  readonly limits: ResourceLimits;
  /** Warning threshold (0-1, e.g., 0.8 = warn at 80%) */
  readonly warningThreshold: number;
  /** Check interval for automatic monitoring (ms) */
  readonly checkIntervalMs: number;
  /** Whether to automatically terminate on limit breach */
  readonly autoTerminate: boolean;
}

/**
 * Default resource limiter configuration.
 */
export const DEFAULT_RESOURCE_LIMITER_CONFIG: Omit<ResourceLimiterConfig, 'limits'> = {
  warningThreshold: 0.8,
  checkIntervalMs: 1000,
  autoTerminate: true,
};

// ============================================================================
// RESOURCE LIMITER CLASS
// ============================================================================

/**
 * Enforces resource limits for simulation execution.
 *
 * Key features:
 * - Time limit enforcement
 * - Memory usage tracking
 * - Concurrency limiting
 * - Snapshot count limiting
 * - Event count limiting
 */
export class ResourceLimiter {
  private readonly simulationId: SimulationId;
  private readonly config: ResourceLimiterConfig;
  private readonly startTime: Date;
  private currentConcurrency = 0;
  private snapshotCount = 0;
  private traceEventCount = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly listeners: Set<ResourceListener> = new Set();
  private readonly getTime: () => ISOTimestamp;

  constructor(
    simulationId: SimulationId,
    limits: ResourceLimits,
    config?: Partial<Omit<ResourceLimiterConfig, 'limits'>>,
    getTime?: () => ISOTimestamp
  ) {
    this.simulationId = simulationId;
    this.config = {
      ...DEFAULT_RESOURCE_LIMITER_CONFIG,
      ...config,
      limits,
    };
    this.startTime = new Date();
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // RESOURCE TRACKING
  // ==========================================================================

  /**
   * Gets current resource usage.
   */
  getUsage(): ResourceUsage {
    return {
      elapsedTimeMs: Date.now() - this.startTime.getTime(),
      memoryBytes: this.getMemoryUsage(),
      concurrency: this.currentConcurrency,
      snapshots: this.snapshotCount,
      traceEvents: this.traceEventCount,
    };
  }

  /**
   * Checks if all resources are within limits.
   */
  check(): ResourceCheckResult {
    const usage = this.getUsage();
    const violations: Array<{ resource: keyof ResourceLimits; current: number; limit: number; percentUsed: number }> = [];
    const warnings: Array<{ resource: keyof ResourceLimits; current: number; limit: number; percentUsed: number }> = [];

    // Check execution time
    this.checkResource(
      'maxExecutionTimeMs',
      usage.elapsedTimeMs,
      this.config.limits.maxExecutionTimeMs,
      violations,
      warnings
    );

    // Check memory
    this.checkResource(
      'maxMemoryBytes',
      usage.memoryBytes,
      this.config.limits.maxMemoryBytes,
      violations,
      warnings
    );

    // Check concurrency
    this.checkResource(
      'maxConcurrency',
      usage.concurrency,
      this.config.limits.maxConcurrency,
      violations,
      warnings
    );

    // Check snapshots
    this.checkResource(
      'maxSnapshots',
      usage.snapshots,
      this.config.limits.maxSnapshots,
      violations,
      warnings
    );

    // Check trace events
    this.checkResource(
      'maxTraceEvents',
      usage.traceEvents,
      this.config.limits.maxTraceEvents,
      violations,
      warnings
    );

    return {
      withinLimits: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Enforces resource limits, throwing if exceeded.
   */
  enforce(): void {
    const result = this.check();

    if (!result.withinLimits) {
      const violation = result.violations[0]!;
      this.throwResourceError(
        violation.resource,
        violation.current,
        violation.limit
      );
    }
  }

  // ==========================================================================
  // CONCURRENCY CONTROL
  // ==========================================================================

  /**
   * Acquires a concurrency slot.
   *
   * @throws ResourceExhaustionError if concurrency limit exceeded
   */
  acquireConcurrency(): void {
    if (this.currentConcurrency >= this.config.limits.maxConcurrency) {
      this.throwResourceError(
        'maxConcurrency',
        this.currentConcurrency + 1,
        this.config.limits.maxConcurrency
      );
    }
    this.currentConcurrency++;
    this.notifyListeners('concurrency_acquired');
  }

  /**
   * Releases a concurrency slot.
   */
  releaseConcurrency(): void {
    if (this.currentConcurrency > 0) {
      this.currentConcurrency--;
      this.notifyListeners('concurrency_released');
    }
  }

  /**
   * Executes an operation with concurrency limiting.
   */
  async withConcurrency<T>(operation: () => Promise<T>): Promise<T> {
    this.acquireConcurrency();
    try {
      return await operation();
    } finally {
      this.releaseConcurrency();
    }
  }

  // ==========================================================================
  // COUNTER TRACKING
  // ==========================================================================

  /**
   * Records a snapshot creation.
   */
  recordSnapshot(): void {
    this.snapshotCount++;
    if (this.snapshotCount > this.config.limits.maxSnapshots) {
      this.throwResourceError(
        'maxSnapshots',
        this.snapshotCount,
        this.config.limits.maxSnapshots
      );
    }
    this.notifyListeners('snapshot_recorded');
  }

  /**
   * Records trace events.
   */
  recordTraceEvents(count: number): void {
    this.traceEventCount += count;
    if (this.traceEventCount > this.config.limits.maxTraceEvents) {
      this.throwResourceError(
        'maxTraceEvents',
        this.traceEventCount,
        this.config.limits.maxTraceEvents
      );
    }
  }

  /**
   * Gets remaining time before timeout.
   */
  getRemainingTimeMs(): number {
    const elapsed = Date.now() - this.startTime.getTime();
    return Math.max(0, this.config.limits.maxExecutionTimeMs - elapsed);
  }

  /**
   * Checks if execution has timed out.
   */
  hasTimedOut(): boolean {
    return this.getRemainingTimeMs() <= 0;
  }

  // ==========================================================================
  // AUTOMATIC MONITORING
  // ==========================================================================

  /**
   * Starts automatic resource monitoring.
   */
  startMonitoring(): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      const result = this.check();

      // Notify of warnings
      for (const warning of result.warnings) {
        this.notifyListeners('warning', { resource: warning.resource });
      }

      // Auto-terminate if configured
      if (!result.withinLimits && this.config.autoTerminate) {
        this.stopMonitoring();
        const violation = result.violations[0]!;
        this.throwResourceError(
          violation.resource,
          violation.current,
          violation.limit
        );
      }
    }, this.config.checkIntervalMs);
  }

  /**
   * Stops automatic resource monitoring.
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ==========================================================================
  // LISTENERS
  // ==========================================================================

  /**
   * Subscribes to resource events.
   */
  onResourceEvent(listener: ResourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(
    event: string,
    data?: Record<string, unknown>
  ): void {
    for (const listener of this.listeners) {
      try {
        listener({
          type: event,
          timestamp: this.getTime(),
          data,
        });
      } catch (error) {
        console.error('Error in resource listener:', error);
      }
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private checkResource(
    resource: keyof ResourceLimits,
    current: number,
    limit: number,
    violations: Array<{ resource: keyof ResourceLimits; current: number; limit: number; percentUsed: number }>,
    warnings: Array<{ resource: keyof ResourceLimits; current: number; limit: number; percentUsed: number }>
  ): void {
    const percentUsed = current / limit;

    if (percentUsed >= 1) {
      violations.push({ resource, current, limit, percentUsed });
    } else if (percentUsed >= this.config.warningThreshold) {
      warnings.push({ resource, current, limit, percentUsed });
    }
  }

  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  private throwResourceError(
    resource: keyof ResourceLimits,
    current: number,
    limit: number
  ): never {
    const resourceTypeMap: Record<keyof ResourceLimits, 'time' | 'memory' | 'concurrency' | 'snapshots' | 'events' | 'disk'> = {
      maxExecutionTimeMs: 'time',
      maxMemoryBytes: 'memory',
      maxConcurrency: 'concurrency',
      maxSnapshots: 'snapshots',
      maxTraceEvents: 'events',
    };

    const errorCodeMap: Record<keyof ResourceLimits, ErrorCode> = {
      maxExecutionTimeMs: ErrorCodes.EXECUTION_TIMEOUT,
      maxMemoryBytes: ErrorCodes.MEMORY_LIMIT_EXCEEDED,
      maxConcurrency: ErrorCodes.CONCURRENCY_LIMIT_EXCEEDED,
      maxSnapshots: ErrorCodes.SNAPSHOT_LIMIT_EXCEEDED,
      maxTraceEvents: ErrorCodes.EVENT_LIMIT_EXCEEDED,
    };

    throw new ResourceExhaustionError(
      `Resource limit exceeded: ${resource} (${current} > ${limit})`,
      errorCodeMap[resource],
      resourceTypeMap[resource],
      current,
      limit,
      {
        component: 'ResourceLimiter',
        operation: 'enforce',
        simulationId: this.simulationId,
        details: { resource, current, limit },
      }
    );
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Cleans up the resource limiter.
   */
  dispose(): void {
    this.stopMonitoring();
    this.listeners.clear();
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Listener for resource events.
 */
export type ResourceListener = (event: {
  type: string;
  timestamp: ISOTimestamp;
  data?: Record<string, unknown>;
}) => void;

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a resource limiter.
 */
export function createResourceLimiter(
  simulationId: SimulationId,
  limits: ResourceLimits,
  config?: Partial<Omit<ResourceLimiterConfig, 'limits'>>,
  getTime?: () => ISOTimestamp
): ResourceLimiter {
  return new ResourceLimiter(simulationId, limits, config, getTime);
}
