/**
 * Trace Span Management.
 *
 * Provides span-based tracing for simulation execution.
 * Spans represent units of work with start/end times and metadata.
 *
 * @module trace/span
 */

import type {
  SpanId,
  TraceId,
  ISOTimestamp,
  SimulationId,
} from '../types/common.js';
import { createSpanId, createTraceId } from '../types/common.js';

// ============================================================================
// SPAN STATUS TYPES
// ============================================================================

/**
 * Status of a trace span.
 */
export type SpanStatus = 'active' | 'completed' | 'failed' | 'cancelled';

/**
 * Severity level for span events.
 */
export type SpanEventSeverity = 'debug' | 'info' | 'warn' | 'error';

// ============================================================================
// SPAN EVENT TYPE
// ============================================================================

/**
 * An event that occurred within a span.
 */
export interface SpanEvent {
  readonly name: string;
  readonly timestamp: ISOTimestamp;
  readonly severity: SpanEventSeverity;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SPAN LINK TYPE
// ============================================================================

/**
 * A link to another span (for async relationships).
 */
export interface SpanLink {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly relationship: 'follows_from' | 'child_of' | 'related_to';
  readonly attributes?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// TRACE SPAN DATA
// ============================================================================

/**
 * Complete data for a trace span.
 */
export interface TraceSpanData {
  readonly spanId: SpanId;
  readonly traceId: TraceId;
  readonly parentSpanId: SpanId | null;
  readonly operationName: string;
  readonly serviceName: string;
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

// ============================================================================
// TRACE SPAN CLASS
// ============================================================================

/**
 * Represents a single unit of work in a trace.
 *
 * Spans can have child spans, events, and attributes.
 * They track timing and status for observability.
 */
export class TraceSpan {
  private readonly _spanId: SpanId;
  private readonly _traceId: TraceId;
  private readonly _parentSpanId: SpanId | null;
  private readonly _operationName: string;
  private readonly _serviceName: string;
  private readonly _startTime: Date;
  private _endTime: Date | null = null;
  private _status: SpanStatus = 'active';
  private readonly _attributes: Map<string, unknown> = new Map();
  private readonly _events: SpanEvent[] = [];
  private readonly _links: SpanLink[] = [];
  private readonly _children: TraceSpan[] = [];
  private _errorMessage?: string;
  private _errorStack?: string;
  private readonly _getTime: () => ISOTimestamp;

  constructor(
    operationName: string,
    serviceName: string,
    options?: {
      traceId?: TraceId;
      parentSpanId?: SpanId;
      startTime?: ISOTimestamp;
      attributes?: Record<string, unknown>;
      getTime?: () => ISOTimestamp;
    }
  ) {
    this._spanId = createSpanId(generateId());
    this._traceId = options?.traceId ?? createTraceId(generateId());
    this._parentSpanId = options?.parentSpanId ?? null;
    this._operationName = operationName;
    this._serviceName = serviceName;
    this._startTime = options?.startTime ? new Date(options.startTime) : new Date();
    this._getTime = options?.getTime ?? (() => new Date().toISOString() as ISOTimestamp);

    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        this._attributes.set(key, value);
      }
    }
  }

  // ==========================================================================
  // GETTERS
  // ==========================================================================

  get spanId(): SpanId {
    return this._spanId;
  }

  get traceId(): TraceId {
    return this._traceId;
  }

  get parentSpanId(): SpanId | null {
    return this._parentSpanId;
  }

  get operationName(): string {
    return this._operationName;
  }

  get serviceName(): string {
    return this._serviceName;
  }

  get status(): SpanStatus {
    return this._status;
  }

  get isActive(): boolean {
    return this._status === 'active';
  }

  get durationMs(): number | null {
    if (!this._endTime) return null;
    return this._endTime.getTime() - this._startTime.getTime();
  }

  get children(): ReadonlyArray<TraceSpan> {
    return [...this._children];
  }

  // ==========================================================================
  // SPAN LIFECYCLE
  // ==========================================================================

  /**
   * Ends the span successfully.
   */
  end(): void {
    if (!this.isActive) {
      throw new Error(`Cannot end span with status: ${this._status}`);
    }
    this._endTime = new Date(this._getTime());
    this._status = 'completed';
  }

  /**
   * Ends the span with a failure.
   *
   * @param error - Error that caused the failure
   */
  fail(error: Error | string): void {
    if (!this.isActive) {
      throw new Error(`Cannot fail span with status: ${this._status}`);
    }
    this._endTime = new Date(this._getTime());
    this._status = 'failed';

    if (error instanceof Error) {
      this._errorMessage = error.message;
      this._errorStack = error.stack;
    } else {
      this._errorMessage = error;
    }

    this.addEvent('error', 'error', { message: this._errorMessage });
  }

  /**
   * Cancels the span.
   *
   * @param reason - Reason for cancellation
   */
  cancel(reason?: string): void {
    if (!this.isActive) {
      throw new Error(`Cannot cancel span with status: ${this._status}`);
    }
    this._endTime = new Date(this._getTime());
    this._status = 'cancelled';

    if (reason) {
      this.addEvent('cancelled', 'info', { reason });
    }
  }

  // ==========================================================================
  // ATTRIBUTES
  // ==========================================================================

  /**
   * Sets an attribute on the span.
   *
   * @param key - Attribute key
   * @param value - Attribute value
   */
  setAttribute(key: string, value: unknown): this {
    this._attributes.set(key, value);
    return this;
  }

  /**
   * Sets multiple attributes on the span.
   *
   * @param attributes - Attributes to set
   */
  setAttributes(attributes: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(attributes)) {
      this._attributes.set(key, value);
    }
    return this;
  }

  /**
   * Gets an attribute value.
   *
   * @param key - Attribute key
   * @returns Attribute value or undefined
   */
  getAttribute(key: string): unknown {
    return this._attributes.get(key);
  }

  /**
   * Gets all attributes.
   */
  getAttributes(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this._attributes);
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  /**
   * Adds an event to the span.
   *
   * @param name - Event name
   * @param severity - Event severity
   * @param attributes - Event attributes
   */
  addEvent(
    name: string,
    severity: SpanEventSeverity = 'info',
    attributes?: Record<string, unknown>
  ): this {
    this._events.push({
      name,
      timestamp: this._getTime(),
      severity,
      attributes: attributes ? { ...attributes } : undefined,
    });
    return this;
  }

  /**
   * Gets all events.
   */
  getEvents(): ReadonlyArray<SpanEvent> {
    return [...this._events];
  }

  // ==========================================================================
  // LINKS
  // ==========================================================================

  /**
   * Adds a link to another span.
   *
   * @param traceId - Linked trace ID
   * @param spanId - Linked span ID
   * @param relationship - Relationship type
   * @param attributes - Link attributes
   */
  addLink(
    traceId: TraceId,
    spanId: SpanId,
    relationship: 'follows_from' | 'child_of' | 'related_to' = 'related_to',
    attributes?: Record<string, unknown>
  ): this {
    this._links.push({
      traceId,
      spanId,
      relationship,
      attributes: attributes ? { ...attributes } : undefined,
    });
    return this;
  }

  /**
   * Gets all links.
   */
  getLinks(): ReadonlyArray<SpanLink> {
    return [...this._links];
  }

  // ==========================================================================
  // CHILD SPANS
  // ==========================================================================

  /**
   * Creates a child span.
   *
   * @param operationName - Name of the child operation
   * @param attributes - Initial attributes
   * @returns New child span
   */
  startChild(operationName: string, attributes?: Record<string, unknown>): TraceSpan {
    const child = new TraceSpan(operationName, this._serviceName, {
      traceId: this._traceId,
      parentSpanId: this._spanId,
      startTime: this._getTime(),
      attributes,
      getTime: this._getTime,
    });
    this._children.push(child);
    return child;
  }

  /**
   * Ends all active child spans.
   */
  endChildren(): void {
    for (const child of this._children) {
      if (child.isActive) {
        child.end();
      }
    }
  }

  // ==========================================================================
  // SERIALIZATION
  // ==========================================================================

  /**
   * Converts the span to a data object.
   */
  toData(): TraceSpanData {
    return {
      spanId: this._spanId,
      traceId: this._traceId,
      parentSpanId: this._parentSpanId,
      operationName: this._operationName,
      serviceName: this._serviceName,
      startTime: this._startTime.toISOString() as ISOTimestamp,
      endTime: this._endTime?.toISOString() as ISOTimestamp | null,
      status: this._status,
      durationMs: this.durationMs,
      attributes: Object.fromEntries(this._attributes),
      events: [...this._events],
      links: [...this._links],
      errorMessage: this._errorMessage,
      errorStack: this._errorStack,
    };
  }

  /**
   * Converts the span and all children to data objects.
   */
  toDataWithChildren(): TraceSpanData[] {
    const result: TraceSpanData[] = [this.toData()];
    for (const child of this._children) {
      result.push(...child.toDataWithChildren());
    }
    return result;
  }
}

// ============================================================================
// SPAN CONTEXT
// ============================================================================

/**
 * Context for propagating trace information.
 */
export interface SpanContext {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly sampled: boolean;
}

/**
 * Extracts span context from a span.
 */
export function extractSpanContext(span: TraceSpan): SpanContext {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: true,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates a unique ID.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Creates a root span for a new trace.
 *
 * @param operationName - Name of the operation
 * @param serviceName - Name of the service
 * @param options - Span options
 * @returns New root span
 */
export function createRootSpan(
  operationName: string,
  serviceName: string,
  options?: {
    startTime?: ISOTimestamp;
    attributes?: Record<string, unknown>;
    getTime?: () => ISOTimestamp;
  }
): TraceSpan {
  return new TraceSpan(operationName, serviceName, options);
}

/**
 * Creates a child span from a parent context.
 *
 * @param context - Parent span context
 * @param operationName - Name of the operation
 * @param serviceName - Name of the service
 * @param options - Span options
 * @returns New child span
 */
export function createChildSpan(
  context: SpanContext,
  operationName: string,
  serviceName: string,
  options?: {
    startTime?: ISOTimestamp;
    attributes?: Record<string, unknown>;
    getTime?: () => ISOTimestamp;
  }
): TraceSpan {
  return new TraceSpan(operationName, serviceName, {
    ...options,
    traceId: context.traceId,
    parentSpanId: context.spanId,
  });
}

/**
 * Wraps an async function with span tracking.
 *
 * @param span - Parent span
 * @param operationName - Name of the operation
 * @param fn - Function to wrap
 * @returns Result of the function
 */
export async function withSpan<T>(
  span: TraceSpan,
  operationName: string,
  fn: (childSpan: TraceSpan) => Promise<T>
): Promise<T> {
  const childSpan = span.startChild(operationName);
  try {
    const result = await fn(childSpan);
    childSpan.end();
    return result;
  } catch (error) {
    childSpan.fail(error instanceof Error ? error : String(error));
    throw error;
  }
}
