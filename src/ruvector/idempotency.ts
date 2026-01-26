/**
 * Idempotency Guard for Execution.
 *
 * Ensures that each plan is executed at most once, preventing
 * duplicate executions from duplicate events or retries.
 *
 * @module ruvector/idempotency
 */

import type { ISOTimestamp } from '../types/common.js';
import type { PlanId } from './types.js';

// ============================================================================
// EXECUTION RECORD
// ============================================================================

/**
 * Record of a plan execution attempt.
 */
export interface ExecutionRecord {
  /** Plan that was executed */
  readonly planId: PlanId;
  /** When execution started */
  readonly startedAt: ISOTimestamp;
  /** When execution completed (if applicable) */
  readonly completedAt?: ISOTimestamp;
  /** Execution status */
  readonly status: 'pending' | 'running' | 'completed' | 'failed';
  /** Error information if failed */
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  /** Number of execution attempts */
  readonly attempts: number;
}

/**
 * Result of an idempotency check.
 */
export interface IdempotencyCheckResult {
  /** Whether execution should proceed */
  readonly shouldExecute: boolean;
  /** Reason if execution should not proceed */
  readonly reason?: string;
  /** Existing execution record if found */
  readonly existingRecord?: ExecutionRecord;
}

// ============================================================================
// IDEMPOTENCY GUARD
// ============================================================================

/**
 * Configuration for the idempotency guard.
 */
export interface IdempotencyGuardConfig {
  /** Time-to-live for execution records in milliseconds */
  readonly recordTtlMs: number;
  /** Maximum number of records to keep in memory */
  readonly maxRecords: number;
  /** Whether to allow retry of failed executions */
  readonly allowFailedRetry: boolean;
}

/**
 * Default idempotency guard configuration.
 */
export const DEFAULT_IDEMPOTENCY_CONFIG: IdempotencyGuardConfig = {
  recordTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRecords: 10000,
  allowFailedRetry: false,
};

/**
 * Idempotency guard for preventing duplicate plan executions.
 *
 * This guard maintains a record of executed plans and ensures
 * that each plan is executed at most once.
 */
export class IdempotencyGuard {
  private readonly records: Map<PlanId, ExecutionRecord> = new Map();
  private readonly config: IdempotencyGuardConfig;

  constructor(config: Partial<IdempotencyGuardConfig> = {}) {
    this.config = { ...DEFAULT_IDEMPOTENCY_CONFIG, ...config };
  }

  /**
   * Checks if a plan can be executed.
   *
   * @param planId - Plan identifier to check
   * @returns Check result indicating whether execution should proceed
   */
  check(planId: PlanId): IdempotencyCheckResult {
    this.pruneExpiredRecords();

    const existingRecord = this.records.get(planId);

    if (!existingRecord) {
      return { shouldExecute: true };
    }

    // Already running - do not execute
    if (existingRecord.status === 'running' || existingRecord.status === 'pending') {
      return {
        shouldExecute: false,
        reason: `Plan ${planId} is already being executed (status: ${existingRecord.status})`,
        existingRecord,
      };
    }

    // Already completed successfully - do not execute
    if (existingRecord.status === 'completed') {
      return {
        shouldExecute: false,
        reason: `Plan ${planId} has already been executed successfully`,
        existingRecord,
      };
    }

    // Failed - check if retry is allowed
    if (existingRecord.status === 'failed') {
      if (this.config.allowFailedRetry) {
        return { shouldExecute: true, existingRecord };
      }
      return {
        shouldExecute: false,
        reason: `Plan ${planId} execution failed and retry is disabled`,
        existingRecord,
      };
    }

    return { shouldExecute: true };
  }

  /**
   * Marks a plan execution as started.
   *
   * @param planId - Plan identifier
   * @returns The execution record
   */
  markStarted(planId: PlanId): ExecutionRecord {
    const existingRecord = this.records.get(planId);
    const attempts = existingRecord ? existingRecord.attempts + 1 : 1;

    const record: ExecutionRecord = {
      planId,
      startedAt: new Date().toISOString() as ISOTimestamp,
      status: 'running',
      attempts,
    };

    this.records.set(planId, record);
    this.enforceMaxRecords();

    return record;
  }

  /**
   * Marks a plan execution as completed.
   *
   * @param planId - Plan identifier
   */
  markCompleted(planId: PlanId): ExecutionRecord {
    const existingRecord = this.records.get(planId);
    if (!existingRecord) {
      throw new Error(`No execution record found for plan ${planId}`);
    }

    const record: ExecutionRecord = {
      ...existingRecord,
      status: 'completed',
      completedAt: new Date().toISOString() as ISOTimestamp,
    };

    this.records.set(planId, record);
    return record;
  }

  /**
   * Marks a plan execution as failed.
   *
   * @param planId - Plan identifier
   * @param error - Error information
   */
  markFailed(planId: PlanId, error: { code: string; message: string }): ExecutionRecord {
    const existingRecord = this.records.get(planId);
    if (!existingRecord) {
      throw new Error(`No execution record found for plan ${planId}`);
    }

    const record: ExecutionRecord = {
      ...existingRecord,
      status: 'failed',
      completedAt: new Date().toISOString() as ISOTimestamp,
      error,
    };

    this.records.set(planId, record);
    return record;
  }

  /**
   * Gets the execution record for a plan.
   *
   * @param planId - Plan identifier
   * @returns Execution record if found
   */
  getRecord(planId: PlanId): ExecutionRecord | undefined {
    return this.records.get(planId);
  }

  /**
   * Gets all execution records.
   */
  getAllRecords(): ReadonlyArray<ExecutionRecord> {
    return Array.from(this.records.values());
  }

  /**
   * Gets statistics about execution records.
   */
  getStatistics(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const record of this.records.values()) {
      switch (record.status) {
        case 'pending':
          pending++;
          break;
        case 'running':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    return {
      total: this.records.size,
      pending,
      running,
      completed,
      failed,
    };
  }

  /**
   * Clears all execution records.
   */
  clear(): void {
    this.records.clear();
  }

  /**
   * Removes expired records based on TTL.
   */
  private pruneExpiredRecords(): void {
    const now = Date.now();
    const expiredKeys: PlanId[] = [];

    for (const [planId, record] of this.records) {
      const recordTime = new Date(record.completedAt ?? record.startedAt).getTime();
      if (now - recordTime > this.config.recordTtlMs) {
        // Only prune completed or failed records
        if (record.status === 'completed' || record.status === 'failed') {
          expiredKeys.push(planId);
        }
      }
    }

    for (const key of expiredKeys) {
      this.records.delete(key);
    }
  }

  /**
   * Enforces maximum record count by removing oldest completed records.
   */
  private enforceMaxRecords(): void {
    if (this.records.size <= this.config.maxRecords) {
      return;
    }

    // Sort completed records by completion time (oldest first)
    const completedRecords: Array<[PlanId, ExecutionRecord]> = [];
    for (const [planId, record] of this.records) {
      if (record.status === 'completed' || record.status === 'failed') {
        completedRecords.push([planId, record]);
      }
    }

    completedRecords.sort((a, b) => {
      const timeA = new Date(a[1].completedAt ?? a[1].startedAt).getTime();
      const timeB = new Date(b[1].completedAt ?? b[1].startedAt).getTime();
      return timeA - timeB;
    });

    // Remove oldest records until under limit
    const toRemove = this.records.size - this.config.maxRecords;
    for (let i = 0; i < toRemove && i < completedRecords.length; i++) {
      this.records.delete(completedRecords[i]![0]);
    }
  }
}

/**
 * Creates an idempotency guard with the given configuration.
 */
export function createIdempotencyGuard(
  config: Partial<IdempotencyGuardConfig> = {}
): IdempotencyGuard {
  return new IdempotencyGuard(config);
}
