/**
 * Error types for the Agentics Simulation Engine.
 *
 * Defines error classification and structured error handling
 * for deterministic error recovery.
 *
 * @module error/types
 */

import type { StepId, PolicyId, SimulationId, ISOTimestamp } from '../types/common.js';

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Classification of errors for recovery strategy selection.
 *
 * - TRANSIENT: Temporary errors that may succeed on retry (network, timeout)
 * - RECOVERABLE: Errors that can be recovered via rollback
 * - POLICY_VIOLATION: Policy evaluation denied an action
 * - RESOURCE_EXHAUSTION: Resource limits exceeded
 * - FATAL: Unrecoverable errors requiring shutdown
 */
export type ErrorClass =
  | 'TRANSIENT'
  | 'RECOVERABLE'
  | 'POLICY_VIOLATION'
  | 'RESOURCE_EXHAUSTION'
  | 'FATAL';

/**
 * Error severity levels.
 */
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Standard error codes for the simulation engine.
 */
export const ErrorCodes = {
  // Transient errors (1xxx)
  NETWORK_TIMEOUT: 'E1001',
  CONNECTION_REFUSED: 'E1002',
  SERVICE_UNAVAILABLE: 'E1003',
  RATE_LIMITED: 'E1004',
  TEMPORARY_FAILURE: 'E1099',

  // Recoverable errors (2xxx)
  STATE_INCONSISTENCY: 'E2001',
  CHECKPOINT_CORRUPTED: 'E2002',
  STEP_FAILED: 'E2003',
  ASSERTION_FAILED: 'E2004',
  DATA_VALIDATION_FAILED: 'E2005',
  RECOVERABLE_ERROR: 'E2099',

  // Policy violations (3xxx)
  POLICY_DENIED: 'E3001',
  POLICY_REQUIRED_APPROVAL: 'E3002',
  POLICY_CONSTRAINT_VIOLATED: 'E3003',
  POLICY_EVALUATION_FAILED: 'E3004',
  POLICY_NOT_FOUND: 'E3005',

  // Resource exhaustion (4xxx)
  EXECUTION_TIMEOUT: 'E4001',
  MEMORY_LIMIT_EXCEEDED: 'E4002',
  CONCURRENCY_LIMIT_EXCEEDED: 'E4003',
  SNAPSHOT_LIMIT_EXCEEDED: 'E4004',
  EVENT_LIMIT_EXCEEDED: 'E4005',
  DISK_SPACE_EXHAUSTED: 'E4006',

  // Fatal errors (5xxx)
  CONFIGURATION_INVALID: 'E5001',
  SCENARIO_NOT_FOUND: 'E5002',
  SCENARIO_INVALID: 'E5003',
  DEPENDENCY_MISSING: 'E5004',
  INITIALIZATION_FAILED: 'E5005',
  INTERNAL_ERROR: 'E5006',
  ISOLATION_BREACH: 'E5007',
  DETERMINISM_VIOLATION: 'E5008',
  FATAL_ERROR: 'E5099',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// ERROR CONTEXT
// ============================================================================

/**
 * Context information about where an error occurred.
 */
export interface ErrorContext {
  /** Component where error occurred */
  readonly component: string;
  /** Operation being performed */
  readonly operation: string;
  /** Simulation ID (if applicable) */
  readonly simulationId?: SimulationId;
  /** Step ID (if applicable) */
  readonly stepId?: StepId;
  /** Policy ID (if applicable) */
  readonly policyId?: PolicyId;
  /** Additional context */
  readonly details?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// BASE ERROR CLASS
// ============================================================================

/**
 * Base error class for all simulation engine errors.
 */
export class SimulationError extends Error {
  /** Error code for programmatic handling */
  readonly code: ErrorCode;
  /** Error classification for recovery */
  readonly classification: ErrorClass;
  /** Error severity */
  readonly severity: ErrorSeverity;
  /** Error context */
  readonly context: ErrorContext;
  /** Whether error can be retried */
  readonly retryable: boolean;
  /** When the error occurred */
  readonly timestamp: ISOTimestamp;
  /** Original error (if wrapped) */
  readonly cause?: Error;

  constructor(
    message: string,
    code: ErrorCode,
    classification: ErrorClass,
    severity: ErrorSeverity,
    context: ErrorContext,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'SimulationError';
    this.code = code;
    this.classification = classification;
    this.severity = severity;
    this.context = context;
    this.retryable = options?.retryable ?? classification === 'TRANSIENT';
    this.timestamp = new Date().toISOString() as ISOTimestamp;
    this.cause = options?.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SimulationError);
    }
  }

  /**
   * Creates a structured representation of the error.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      classification: this.classification,
      severity: this.severity,
      context: this.context,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

// ============================================================================
// SPECIALIZED ERROR CLASSES
// ============================================================================

/**
 * Transient error that may succeed on retry.
 */
export class TransientError extends SimulationError {
  /** Number of retry attempts made */
  readonly retryCount: number;
  /** Suggested delay before retry (ms) */
  readonly suggestedDelayMs: number;

  constructor(
    message: string,
    code: ErrorCode,
    context: ErrorContext,
    options?: {
      retryCount?: number;
      suggestedDelayMs?: number;
      cause?: Error;
    }
  ) {
    super(message, code, 'TRANSIENT', 'medium', context, {
      retryable: true,
      cause: options?.cause,
    });
    this.name = 'TransientError';
    this.retryCount = options?.retryCount ?? 0;
    this.suggestedDelayMs = options?.suggestedDelayMs ?? 1000;
  }
}

/**
 * Recoverable error that can be handled via rollback.
 */
export class RecoverableError extends SimulationError {
  /** State version to rollback to */
  readonly rollbackToVersion?: number;
  /** Snapshot ID to restore */
  readonly snapshotId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    context: ErrorContext,
    options?: {
      rollbackToVersion?: number;
      snapshotId?: string;
      cause?: Error;
    }
  ) {
    super(message, code, 'RECOVERABLE', 'high', context, {
      retryable: false,
      cause: options?.cause,
    });
    this.name = 'RecoverableError';
    this.rollbackToVersion = options?.rollbackToVersion;
    this.snapshotId = options?.snapshotId;
  }
}

/**
 * Policy violation error.
 */
export class PolicyViolationError extends SimulationError {
  /** Policy that was violated */
  readonly policyId: PolicyId;
  /** Rule that was triggered */
  readonly ruleId: string;
  /** Violation type */
  readonly violationType: string;
  /** Suggested remediation */
  readonly remediation?: string;

  constructor(
    message: string,
    policyId: PolicyId,
    ruleId: string,
    violationType: string,
    context: ErrorContext,
    options?: {
      remediation?: string;
      cause?: Error;
    }
  ) {
    super(message, ErrorCodes.POLICY_DENIED, 'POLICY_VIOLATION', 'high', {
      ...context,
      policyId,
    }, {
      retryable: false,
      cause: options?.cause,
    });
    this.name = 'PolicyViolationError';
    this.policyId = policyId;
    this.ruleId = ruleId;
    this.violationType = violationType;
    this.remediation = options?.remediation;
  }
}

/**
 * Resource exhaustion error.
 */
export class ResourceExhaustionError extends SimulationError {
  /** Type of resource exhausted */
  readonly resourceType: 'time' | 'memory' | 'concurrency' | 'snapshots' | 'events' | 'disk';
  /** Current usage */
  readonly currentUsage: number;
  /** Limit that was exceeded */
  readonly limit: number;

  constructor(
    message: string,
    code: ErrorCode,
    resourceType: 'time' | 'memory' | 'concurrency' | 'snapshots' | 'events' | 'disk',
    currentUsage: number,
    limit: number,
    context: ErrorContext,
    options?: {
      cause?: Error;
    }
  ) {
    super(message, code, 'RESOURCE_EXHAUSTION', 'critical', context, {
      retryable: false,
      cause: options?.cause,
    });
    this.name = 'ResourceExhaustionError';
    this.resourceType = resourceType;
    this.currentUsage = currentUsage;
    this.limit = limit;
  }
}

/**
 * Fatal error requiring shutdown.
 */
export class FatalError extends SimulationError {
  constructor(
    message: string,
    code: ErrorCode,
    context: ErrorContext,
    options?: {
      cause?: Error;
    }
  ) {
    super(message, code, 'FATAL', 'critical', context, {
      retryable: false,
      cause: options?.cause,
    });
    this.name = 'FatalError';
  }
}

/**
 * Configuration error.
 */
export class ConfigurationError extends FatalError {
  /** Path to invalid configuration */
  readonly configPath?: string;
  /** Expected value type or format */
  readonly expected?: string;
  /** Actual value received */
  readonly actual?: unknown;

  constructor(
    message: string,
    context: ErrorContext,
    options?: {
      configPath?: string;
      expected?: string;
      actual?: unknown;
      cause?: Error;
    }
  ) {
    super(message, ErrorCodes.CONFIGURATION_INVALID, context, { cause: options?.cause });
    this.name = 'ConfigurationError';
    this.configPath = options?.configPath;
    this.expected = options?.expected;
    this.actual = options?.actual;
  }
}

/**
 * Isolation breach error - CRITICAL.
 * Thrown when simulation attempts to access production systems.
 */
export class IsolationBreachError extends FatalError {
  /** Target that was attempted to access */
  readonly target: string;
  /** Type of access attempted */
  readonly accessType: string;

  constructor(
    target: string,
    accessType: string,
    context: ErrorContext,
    options?: {
      cause?: Error;
    }
  ) {
    super(
      `ISOLATION BREACH: Attempted ${accessType} access to ${target}`,
      ErrorCodes.ISOLATION_BREACH,
      context,
      { cause: options?.cause }
    );
    this.name = 'IsolationBreachError';
    this.target = target;
    this.accessType = accessType;
  }
}

/**
 * Determinism violation error - CRITICAL.
 * Thrown when non-deterministic behavior is detected.
 */
export class DeterminismViolationError extends FatalError {
  /** Expected value or hash */
  readonly expected: unknown;
  /** Actual value or hash */
  readonly actual: unknown;
  /** What was being verified */
  readonly verification: string;

  constructor(
    verification: string,
    expected: unknown,
    actual: unknown,
    context: ErrorContext,
    options?: {
      cause?: Error;
    }
  ) {
    super(
      `DETERMINISM VIOLATION: ${verification} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ErrorCodes.DETERMINISM_VIOLATION,
      context,
      { cause: options?.cause }
    );
    this.name = 'DeterminismViolationError';
    this.expected = expected;
    this.actual = actual;
    this.verification = verification;
  }
}

// ============================================================================
// ERROR CLASSIFICATION HELPER
// ============================================================================

/**
 * Classifies an error into an ErrorClass.
 *
 * @param error - Error to classify
 * @returns ErrorClass for the error
 */
export function classifyError(error: unknown): ErrorClass {
  // Already classified
  if (error instanceof SimulationError) {
    return error.classification;
  }

  // Standard error types
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network/timeout errors are transient
    if (
      name.includes('timeout') ||
      name.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enotfound')
    ) {
      return 'TRANSIENT';
    }

    // Resource errors
    if (
      message.includes('out of memory') ||
      message.includes('heap') ||
      name.includes('rangeerror')
    ) {
      return 'RESOURCE_EXHAUSTION';
    }
  }

  // Default to fatal for unknown errors
  return 'FATAL';
}

/**
 * Wraps an unknown error in a SimulationError.
 *
 * @param error - Error to wrap
 * @param context - Error context
 * @returns SimulationError
 */
export function wrapError(error: unknown, context: ErrorContext): SimulationError {
  if (error instanceof SimulationError) {
    return error;
  }

  const classification = classifyError(error);
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  switch (classification) {
    case 'TRANSIENT':
      return new TransientError(message, ErrorCodes.TEMPORARY_FAILURE, context, { cause });
    case 'RECOVERABLE':
      return new RecoverableError(message, ErrorCodes.RECOVERABLE_ERROR, context, { cause });
    case 'RESOURCE_EXHAUSTION':
      return new ResourceExhaustionError(
        message,
        ErrorCodes.MEMORY_LIMIT_EXCEEDED,
        'memory',
        0,
        0,
        context,
        { cause }
      );
    default:
      return new FatalError(message, ErrorCodes.FATAL_ERROR, context, { cause });
  }
}
