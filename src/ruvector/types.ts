/**
 * Ruvector Event Types.
 *
 * Defines the event types used for communication with Ruvector,
 * the execution substrate and event source of truth.
 *
 * @module ruvector/types
 */

import type { SimulationId, ExecutionId, ISOTimestamp, SpanId, TraceId } from '../types/common.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

declare const __brand: unique symbol;
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

/** Unique identifier for a plan */
export type PlanId = Brand<string, 'PlanId'>;

/** Unique identifier for a Ruvector event */
export type RuvectorEventId = Brand<string, 'RuvectorEventId'>;

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a PlanId from a string.
 */
export function createPlanId(value: string): PlanId {
  return value as PlanId;
}

/**
 * Creates a RuvectorEventId from a string.
 */
export function createRuvectorEventId(value: string): RuvectorEventId {
  return value as RuvectorEventId;
}

// ============================================================================
// DECISION EVENT TYPES
// ============================================================================

/**
 * Decision event types emitted by Ruvector.
 */
export type DecisionEventType =
  | 'plan_approved'
  | 'plan_rejected'
  | 'plan_superseded'
  | 'execution_requested';

/**
 * Execution tier for plan execution.
 */
export type ExecutionTier = 'tier1' | 'tier2' | 'tier3';

/**
 * Execution mode for plan execution.
 */
export type ExecutionMode = 'execute' | 'advisory' | 'dry_run';

/**
 * Execution profile configuration.
 */
export interface ExecutionProfile {
  readonly tier: ExecutionTier;
  readonly mode: ExecutionMode;
  readonly priority?: 'low' | 'normal' | 'high' | 'critical';
  readonly constraints?: {
    readonly maxDurationMs?: number;
    readonly maxResourceBytes?: number;
    readonly isolationLevel?: 'none' | 'partial' | 'full';
  };
}

/**
 * Base interface for all Ruvector decision events.
 */
export interface BaseDecisionEvent<TType extends DecisionEventType = DecisionEventType> {
  /** Unique event identifier */
  readonly event_id: RuvectorEventId;
  /** Event type discriminator */
  readonly type: TType;
  /** Plan identifier */
  readonly plan_id: PlanId;
  /** Simulation identifier (required for execution) */
  readonly simulation_id?: SimulationId;
  /** Event timestamp */
  readonly timestamp: ISOTimestamp;
  /** Source system that emitted the event */
  readonly source?: string;
  /** Correlation ID for tracing */
  readonly correlation_id?: string;
}

/**
 * Event emitted when a plan is approved for execution.
 * This is the authoritative event shape from Ruvector.
 */
export interface PlanApprovedEvent extends BaseDecisionEvent<'plan_approved'> {
  /** Required simulation ID for execution */
  readonly simulation_id: SimulationId;
  /** Execution profile configuration */
  readonly execution_profile: ExecutionProfile;
  /** Approver information */
  readonly approver?: {
    readonly id: string;
    readonly type: 'user' | 'system' | 'policy';
    readonly name?: string;
  };
  /** Optional approval reason */
  readonly reason?: string;
}

/**
 * Event emitted when a plan is rejected.
 */
export interface PlanRejectedEvent extends BaseDecisionEvent<'plan_rejected'> {
  /** Rejection reason */
  readonly reason: string;
  /** Rejector information */
  readonly rejector?: {
    readonly id: string;
    readonly type: 'user' | 'system' | 'policy';
  };
}

/**
 * Event emitted when a plan is superseded by a newer version.
 */
export interface PlanSupersededEvent extends BaseDecisionEvent<'plan_superseded'> {
  /** ID of the new plan that supersedes this one */
  readonly superseded_by: PlanId;
}

/**
 * Union type of all decision events.
 */
export type DecisionEvent =
  | PlanApprovedEvent
  | PlanRejectedEvent
  | PlanSupersededEvent;

// ============================================================================
// EXECUTION LIFECYCLE EVENTS
// ============================================================================

/**
 * Execution lifecycle event types emitted back to Ruvector.
 */
export type ExecutionLifecycleEventType =
  | 'simulation_execution_started'
  | 'simulation_execution_completed'
  | 'simulation_execution_failed'
  | 'simulation_execution_cancelled';

/**
 * Base interface for execution lifecycle events.
 */
export interface BaseExecutionLifecycleEvent<TType extends ExecutionLifecycleEventType> {
  /** Event type */
  readonly type: TType;
  /** Plan that triggered execution */
  readonly plan_id: PlanId;
  /** Simulation being executed */
  readonly simulation_id: SimulationId;
  /** Event timestamp */
  readonly timestamp: ISOTimestamp;
  /** Source engine identifier */
  readonly source: string;
  /** Correlation ID for tracing */
  readonly correlation_id?: string;
}

/**
 * Event emitted when simulation execution starts.
 */
export interface SimulationExecutionStartedEvent
  extends BaseExecutionLifecycleEvent<'simulation_execution_started'> {
  /** Execution profile used */
  readonly execution_profile: ExecutionProfile;
  /** Advisory mode flag (MUST be false for real execution) */
  readonly advisory: false;
}

/**
 * Event emitted when simulation execution completes successfully.
 */
export interface SimulationExecutionCompletedEvent
  extends BaseExecutionLifecycleEvent<'simulation_execution_completed'> {
  /** Final simulation status */
  readonly status: 'success' | 'partial_success';
  /** Execution duration in milliseconds */
  readonly duration_ms: number;
  /** Summary metrics */
  readonly metrics?: {
    readonly steps_executed: number;
    readonly steps_passed: number;
    readonly steps_failed: number;
    readonly policies_evaluated: number;
  };
  /** Reference to full result */
  readonly result_ref?: string;
}

/**
 * Event emitted when simulation execution fails.
 */
export interface SimulationExecutionFailedEvent
  extends BaseExecutionLifecycleEvent<'simulation_execution_failed'> {
  /** Error code */
  readonly error_code: string;
  /** Error message */
  readonly error_message: string;
  /** Whether the failure is recoverable */
  readonly recoverable: boolean;
  /** Execution duration before failure */
  readonly duration_ms?: number;
  /** Stack trace (if available) */
  readonly stack?: string;
}

/**
 * Event emitted when simulation execution is cancelled.
 */
export interface SimulationExecutionCancelledEvent
  extends BaseExecutionLifecycleEvent<'simulation_execution_cancelled'> {
  /** Cancellation reason */
  readonly reason: string;
  /** Who/what cancelled the execution */
  readonly cancelled_by?: string;
  /** Execution duration before cancellation */
  readonly duration_ms?: number;
}

/**
 * Union type of all execution lifecycle events.
 */
export type ExecutionLifecycleEvent =
  | SimulationExecutionStartedEvent
  | SimulationExecutionCompletedEvent
  | SimulationExecutionFailedEvent
  | SimulationExecutionCancelledEvent;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if an event is a plan_approved event.
 */
export function isPlanApprovedEvent(event: DecisionEvent): event is PlanApprovedEvent {
  return event.type === 'plan_approved' && event.simulation_id !== undefined;
}

/**
 * Type guard to check if a decision event has the required fields for execution.
 */
export function isExecutableEvent(event: DecisionEvent): event is PlanApprovedEvent {
  return (
    event.type === 'plan_approved' &&
    event.simulation_id !== undefined &&
    event.plan_id !== undefined &&
    (event as PlanApprovedEvent).execution_profile !== undefined
  );
}

// ============================================================================
// RUVECTOR CLIENT CONFIGURATION
// ============================================================================

/**
 * Configuration for connecting to Ruvector.
 */
export interface RuvectorClientConfig {
  /** Ruvector endpoint URL */
  readonly endpoint: string;
  /** Authentication credentials reference (from Google Secret Manager) */
  readonly credentialsRef: string;
  /** Client identifier for this engine instance */
  readonly clientId: string;
  /** Subscription mode */
  readonly mode: 'polling' | 'streaming';
  /** Polling interval in milliseconds (for polling mode) */
  readonly pollIntervalMs?: number;
  /** Connection timeout in milliseconds */
  readonly connectionTimeoutMs?: number;
  /** Retry configuration */
  readonly retry?: {
    readonly maxAttempts: number;
    readonly backoffMs: number;
    readonly maxBackoffMs: number;
  };
}

/**
 * Ruvector connection status.
 */
export interface RuvectorConnectionStatus {
  readonly connected: boolean;
  readonly lastConnectedAt?: ISOTimestamp;
  readonly lastEventAt?: ISOTimestamp;
  readonly eventsReceived: number;
  readonly eventsProcessed: number;
  readonly errors: number;
}

// ============================================================================
// EXECUTION ACCEPTANCE PROTOCOL
// ============================================================================

/**
 * Request to ruvector-service for execution acceptance.
 * The engine sends this to request permission to execute.
 * Ruvector mints the canonical execution_id if accepted.
 */
export interface ExecutionAcceptanceRequest {
  /** The scenario being submitted for execution */
  readonly simulation_id: SimulationId;
  /** Plan that triggered this execution (if event-driven) */
  readonly plan_id?: PlanId;
  /** Requesting engine identifier */
  readonly source: string;
  /** Request timestamp */
  readonly timestamp: ISOTimestamp;
  /** Scenario metadata for ruvector to evaluate */
  readonly scenario_metadata: {
    readonly scenario_id: string;
    readonly name: string;
    readonly category: string;
    readonly step_count: number;
  };
}

/**
 * Response from ruvector-service for execution acceptance.
 * Contains the canonical execution_id minted by ruvector.
 */
export interface ExecutionAcceptanceResponse {
  /** Whether the execution was accepted */
  readonly accepted: boolean;
  /** Ruvector-minted canonical execution ID (only present if accepted) */
  readonly execution_id?: ExecutionId;
  /** Root span ID for this execution (only present if accepted) */
  readonly root_span_id?: SpanId;
  /** Trace ID for distributed tracing (only present if accepted) */
  readonly trace_id?: TraceId;
  /** Simulation resolution from upstream context */
  readonly simulation_resolution?: string;
  /** Rejection reason (only present if rejected) */
  readonly rejection_reason?: string;
  /** Rejection code (only present if rejected) */
  readonly rejection_code?: string;
  /** Timestamp of the response */
  readonly timestamp: ISOTimestamp;
}
