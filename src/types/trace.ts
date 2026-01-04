/**
 * Trace types for the Agentics Simulation Engine.
 *
 * Traces provide detailed execution information for debugging,
 * auditing, and performance analysis.
 *
 * @module types/trace
 */

import type {
  SimulationId,
  TraceId,
  SpanId,
  EventId,
  ISOTimestamp,
} from './common.js';

// ============================================================================
// SPAN STATUS
// ============================================================================

/**
 * Status of a trace span.
 */
export type SpanStatus = 'unset' | 'ok' | 'error';

// ============================================================================
// SPAN ATTRIBUTES
// ============================================================================

/**
 * Standard attributes for spans.
 */
export interface SpanAttributes {
  /** Component that created the span */
  readonly component?: string;
  /** Operation type */
  readonly operationType?: string;
  /** Resource being operated on */
  readonly resourceType?: string;
  readonly resourceId?: string;
  /** Error information (if status is error) */
  readonly errorCode?: string;
  readonly errorMessage?: string;
  /** Performance metrics */
  readonly durationMs?: number;
  /** Custom attributes */
  readonly custom?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SPAN EVENT
// ============================================================================

/**
 * An event within a span.
 */
export interface SpanEvent {
  readonly name: string;
  readonly timestamp: ISOTimestamp;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// TRACE SPAN
// ============================================================================

/**
 * A span in the execution trace.
 * Spans form a tree structure showing the execution hierarchy.
 */
export interface TraceSpan {
  /** Unique identifier for this span */
  readonly spanId: SpanId;
  /** Parent span (null for root) */
  readonly parentSpanId: SpanId | null;
  /** Name of the operation */
  readonly operationName: string;
  /** When the span started */
  readonly startTime: ISOTimestamp;
  /** When the span ended (undefined if still running) */
  readonly endTime?: ISOTimestamp;
  /** Span status */
  readonly status: SpanStatus;
  /** Span attributes */
  readonly attributes: SpanAttributes;
  /** Child spans */
  readonly children: ReadonlyArray<TraceSpan>;
  /** Events within this span */
  readonly events: ReadonlyArray<SpanEvent>;
}

// ============================================================================
// TRACE EVENT TYPES
// ============================================================================

/**
 * Level of a trace event.
 */
export type TraceEventLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Types of events in the trace.
 */
export type TraceEventType =
  | 'simulation_started'
  | 'simulation_completed'
  | 'simulation_failed'
  | 'scenario_started'
  | 'scenario_completed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'policy_evaluated'
  | 'policy_decision'
  | 'state_snapshot'
  | 'state_rollback'
  | 'artifact_generated'
  | 'mock_invoked'
  | 'data_injected'
  | 'external_call'
  | 'error'
  | 'warning'
  | 'custom';

// ============================================================================
// TRACE EVENT
// ============================================================================

/**
 * Payload for a trace event.
 */
export interface TraceEventPayload {
  readonly message?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * An event in the execution trace.
 */
export interface TraceEvent {
  /** Unique identifier for this event */
  readonly eventId: EventId;
  /** Type of event */
  readonly type: TraceEventType;
  /** When the event occurred */
  readonly timestamp: ISOTimestamp;
  /** Span this event belongs to */
  readonly spanId: SpanId;
  /** Event payload */
  readonly payload: TraceEventPayload;
  /** Events that caused this event */
  readonly causedBy?: ReadonlyArray<EventId>;
  /** Event level */
  readonly level: TraceEventLevel;
}

// ============================================================================
// TRACE ATTRIBUTES
// ============================================================================

/**
 * Attributes for the entire trace.
 */
export interface TraceAttributes {
  /** Simulation identifier */
  readonly simulationId: SimulationId;
  /** Scenario being executed */
  readonly scenarioId: string;
  /** Environment */
  readonly environment: string;
  /** Engine version */
  readonly engineVersion: string;
  /** Custom attributes */
  readonly custom?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SAMPLING
// ============================================================================

/**
 * Decision about trace sampling.
 */
export interface SamplingDecision {
  /** Whether the trace is sampled */
  readonly sampled: boolean;
  /** Sampling rate applied */
  readonly rate: number;
  /** Reason for sampling decision */
  readonly reason: 'always' | 'rate' | 'error' | 'manual';
}

// ============================================================================
// EXECUTION TRACE
// ============================================================================

/**
 * Complete execution trace for a simulation.
 */
export interface ExecutionTrace {
  /** Unique identifier for this trace */
  readonly traceId: TraceId;
  /** Simulation this trace belongs to */
  readonly simulationId: SimulationId;
  /** When tracing started */
  readonly startTime: ISOTimestamp;
  /** When tracing ended */
  readonly endTime?: ISOTimestamp;
  /** Root span of the trace */
  readonly rootSpan: TraceSpan;
  /** All events in chronological order */
  readonly events: ReadonlyArray<TraceEvent>;
  /** Trace-level attributes */
  readonly attributes: TraceAttributes;
  /** Sampling decision */
  readonly sampling: SamplingDecision;
}

// ============================================================================
// TRACE SUMMARY
// ============================================================================

/**
 * Summary statistics for a trace.
 */
export interface TraceSummary {
  readonly traceId: TraceId;
  readonly simulationId: SimulationId;
  readonly duration: {
    readonly totalMs: number;
    readonly spanCount: number;
    readonly eventCount: number;
  };
  readonly status: {
    readonly overall: SpanStatus;
    readonly errorCount: number;
    readonly warningCount: number;
  };
  readonly breakdown: {
    readonly byComponent: Readonly<Record<string, number>>;
    readonly byOperation: Readonly<Record<string, number>>;
  };
}

// ============================================================================
// TRACE QUERY
// ============================================================================

/**
 * Query to find spans in a trace.
 */
export interface SpanQuery {
  /** Filter by operation name (supports wildcards) */
  readonly operationName?: string;
  /** Filter by status */
  readonly status?: SpanStatus;
  /** Filter by minimum duration */
  readonly minDurationMs?: number;
  /** Filter by attributes */
  readonly attributes?: Readonly<Record<string, unknown>>;
  /** Include child spans */
  readonly includeChildren?: boolean;
}

/**
 * Query to find events in a trace.
 */
export interface EventQuery {
  /** Filter by event type */
  readonly type?: TraceEventType;
  /** Filter by level */
  readonly level?: TraceEventLevel;
  /** Filter by time range */
  readonly timeRange?: {
    readonly start: ISOTimestamp;
    readonly end: ISOTimestamp;
  };
  /** Filter by span */
  readonly spanId?: SpanId;
  /** Maximum events to return */
  readonly limit?: number;
}

// ============================================================================
// TRACE EXPORT
// ============================================================================

/**
 * Format for trace export.
 */
export type TraceExportFormat = 'json' | 'otlp' | 'jaeger' | 'zipkin';

/**
 * Options for exporting a trace.
 */
export interface TraceExportOptions {
  readonly format: TraceExportFormat;
  readonly includeEvents: boolean;
  readonly includeAttributes: boolean;
  readonly compress: boolean;
}
