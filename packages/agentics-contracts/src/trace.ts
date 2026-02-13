/**
 * Trace contract types.
 *
 * Data interfaces for trace spans. The TraceSpan class implementation
 * stays in the engine; only data shapes are canonical contracts.
 */

import type { SpanId, TraceId, ISOTimestamp } from './ids.js';

/**
 * Status of a trace span.
 */
export type SpanStatus = 'active' | 'completed' | 'failed' | 'cancelled';

/**
 * Severity level for span events.
 */
export type SpanEventSeverity = 'debug' | 'info' | 'warn' | 'error';

/**
 * An event that occurred within a span.
 */
export interface SpanEvent {
  readonly name: string;
  readonly timestamp: ISOTimestamp;
  readonly severity: SpanEventSeverity;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * A link to another span (for async relationships).
 */
export interface SpanLink {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly relationship: 'follows_from' | 'child_of' | 'related_to';
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * Complete data for a trace span.
 */
export interface TraceSpanData {
  readonly spanId: SpanId;
  readonly traceId: TraceId;
  readonly parentSpanId: SpanId | null;
  readonly operationName: string;
  readonly serviceName: string;
  readonly repo_name?: string;
  readonly startTime: ISOTimestamp;
  readonly endTime: ISOTimestamp | null;
  readonly status: SpanStatus;
  readonly durationMs: number | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: ReadonlyArray<SpanEvent>;
  readonly links: ReadonlyArray<SpanLink>;
  readonly errorMessage?: string;
  readonly errorStack?: string;
}

/**
 * Extracted span context for propagation.
 */
export interface SpanContext {
  readonly spanId: SpanId;
  readonly traceId: TraceId;
  readonly parentSpanId: SpanId | null;
  readonly serviceName: string;
  readonly repo_name?: string;
}
