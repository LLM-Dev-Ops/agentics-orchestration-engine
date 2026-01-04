/**
 * Trace Collector.
 *
 * Collects and manages trace events during simulation execution.
 * Provides audit trail and observability for all simulation operations.
 *
 * @module trace/collector
 */

import type {
  TraceId,
  SpanId,
  EventId,
  SimulationId,
  ISOTimestamp,
  ContentHash,
} from '../types/common.js';
import type { SimulationEvent } from '../types/events.js';
import type { TraceSpanData } from './span.js';
import { createEventId, createTraceId } from '../types/common.js';
import { createContentHash } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// TRACE EVENT TYPES
// ============================================================================

/**
 * A collected trace event with full context.
 */
export interface CollectedTraceEvent {
  /** Unique event ID */
  readonly eventId: EventId;
  /** Trace this event belongs to */
  readonly traceId: TraceId;
  /** Span this event belongs to (if any) */
  readonly spanId?: SpanId;
  /** Simulation this event is part of */
  readonly simulationId: SimulationId;
  /** When the event occurred */
  readonly timestamp: ISOTimestamp;
  /** Sequence number within the simulation */
  readonly sequenceNumber: number;
  /** Event type */
  readonly eventType: string;
  /** Event category */
  readonly category: TraceEventCategory;
  /** Event payload */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Hash of previous event for chain integrity */
  readonly previousHash: ContentHash | null;
  /** Hash of this event */
  readonly eventHash: ContentHash;
}

/**
 * Categories of trace events.
 */
export type TraceEventCategory =
  | 'lifecycle'
  | 'scenario'
  | 'policy'
  | 'state'
  | 'artifact'
  | 'integration'
  | 'error'
  | 'custom';

// ============================================================================
// TRACE QUERY TYPES
// ============================================================================

/**
 * Query parameters for filtering trace events.
 */
export interface TraceQuery {
  readonly traceId?: TraceId;
  readonly spanId?: SpanId;
  readonly eventTypes?: ReadonlyArray<string>;
  readonly categories?: ReadonlyArray<TraceEventCategory>;
  readonly startTime?: ISOTimestamp;
  readonly endTime?: ISOTimestamp;
  readonly minSequence?: number;
  readonly maxSequence?: number;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Result of a trace query.
 */
export interface TraceQueryResult {
  readonly events: ReadonlyArray<CollectedTraceEvent>;
  readonly totalCount: number;
  readonly hasMore: boolean;
}

// ============================================================================
// TRACE COLLECTOR CONFIGURATION
// ============================================================================

/**
 * Configuration for the trace collector.
 */
export interface TraceCollectorConfig {
  /** Maximum number of events to retain */
  readonly maxEvents: number;
  /** Whether to enable hash chain verification */
  readonly enableHashChain: boolean;
  /** Event emission latency target (ms) */
  readonly emissionTargetMs: number;
  /** Whether to log events to console */
  readonly consoleLogging: boolean;
  /** Event categories to collect (null = all) */
  readonly collectCategories: ReadonlyArray<TraceEventCategory> | null;
}

/**
 * Default trace collector configuration.
 */
export const DEFAULT_TRACE_CONFIG: TraceCollectorConfig = {
  maxEvents: 100_000,
  enableHashChain: true,
  emissionTargetMs: 100, // F-005 requirement
  consoleLogging: false,
  collectCategories: null,
};

// ============================================================================
// TRACE COLLECTOR CLASS
// ============================================================================

/**
 * Collects and manages trace events for simulation observability.
 *
 * Key features:
 * - Event collection with hash chain integrity
 * - Query interface for event retrieval
 * - Span management integration
 * - Export capabilities for audit
 */
export class TraceCollector {
  private readonly simulationId: SimulationId;
  private readonly traceId: TraceId;
  private readonly config: TraceCollectorConfig;
  private readonly events: CollectedTraceEvent[] = [];
  private readonly spans: Map<string, TraceSpanData> = new Map();
  private readonly listeners: Set<TraceEventListener> = new Set();
  private sequenceNumber = 0;
  private lastHash: ContentHash | null = null;
  private readonly startTime: Date;
  private readonly getTime: () => ISOTimestamp;

  /**
   * Creates a new trace collector.
   *
   * @param simulationId - Simulation this collector belongs to
   * @param config - Collector configuration
   * @param getTime - Function to get current time (for determinism)
   */
  constructor(
    simulationId: SimulationId,
    config?: Partial<TraceCollectorConfig>,
    getTime?: () => ISOTimestamp
  ) {
    this.simulationId = simulationId;
    this.traceId = createTraceId(`trace-${simulationId}-${Date.now()}`);
    this.config = { ...DEFAULT_TRACE_CONFIG, ...config };
    this.startTime = new Date();
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // EVENT COLLECTION
  // ==========================================================================

  /**
   * Records a simulation event.
   *
   * @param event - Event to record
   * @param spanId - Optional span ID
   * @returns Collected trace event
   */
  recordEvent(event: SimulationEvent, spanId?: SpanId): CollectedTraceEvent {
    return this.recordRawEvent(
      event.eventType,
      this.categorizeEvent(event.eventType),
      event as unknown as Record<string, unknown>,
      spanId
    );
  }

  /**
   * Records a raw trace event.
   *
   * @param eventType - Event type string
   * @param category - Event category
   * @param payload - Event payload
   * @param spanId - Optional span ID
   * @returns Collected trace event
   */
  recordRawEvent(
    eventType: string,
    category: TraceEventCategory,
    payload: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    // Check if we should collect this category
    if (
      this.config.collectCategories !== null &&
      !this.config.collectCategories.includes(category)
    ) {
      // Return a minimal event without storing
      return this.createMinimalEvent(eventType, category, payload, spanId);
    }

    // Check event limit
    if (this.events.length >= this.config.maxEvents) {
      this.handleEventOverflow();
    }

    const collectedEvent = this.createEvent(eventType, category, payload, spanId);
    this.events.push(collectedEvent);

    // Update hash chain
    if (this.config.enableHashChain) {
      this.lastHash = collectedEvent.eventHash;
    }

    // Notify listeners
    this.notifyListeners(collectedEvent);

    // Console logging if enabled
    if (this.config.consoleLogging) {
      console.log(`[TRACE] ${eventType}:`, payload);
    }

    return collectedEvent;
  }

  /**
   * Records a lifecycle event.
   */
  recordLifecycleEvent(
    eventType: string,
    details: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    return this.recordRawEvent(eventType, 'lifecycle', details, spanId);
  }

  /**
   * Records a policy event.
   */
  recordPolicyEvent(
    eventType: string,
    details: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    return this.recordRawEvent(eventType, 'policy', details, spanId);
  }

  /**
   * Records a state event.
   */
  recordStateEvent(
    eventType: string,
    details: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    return this.recordRawEvent(eventType, 'state', details, spanId);
  }

  /**
   * Records an error event.
   */
  recordErrorEvent(
    error: Error | string,
    context: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    const errorPayload = {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    };
    return this.recordRawEvent('error', 'error', errorPayload, spanId);
  }

  // ==========================================================================
  // SPAN MANAGEMENT
  // ==========================================================================

  /**
   * Records a completed span.
   *
   * @param spanData - Span data to record
   */
  recordSpan(spanData: TraceSpanData): void {
    this.spans.set(spanData.spanId, spanData);

    // Also record as an event
    this.recordRawEvent('span_completed', 'lifecycle', {
      spanId: spanData.spanId,
      operationName: spanData.operationName,
      durationMs: spanData.durationMs,
      status: spanData.status,
    }, spanData.spanId);
  }

  /**
   * Gets a recorded span by ID.
   */
  getSpan(spanId: SpanId): TraceSpanData | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Gets all recorded spans.
   */
  getAllSpans(): ReadonlyArray<TraceSpanData> {
    return Array.from(this.spans.values());
  }

  // ==========================================================================
  // QUERYING
  // ==========================================================================

  /**
   * Queries collected events.
   *
   * @param query - Query parameters
   * @returns Query result
   */
  query(query: TraceQuery): TraceQueryResult {
    let filtered = [...this.events];

    // Apply filters
    if (query.traceId) {
      filtered = filtered.filter((e) => e.traceId === query.traceId);
    }
    if (query.spanId) {
      filtered = filtered.filter((e) => e.spanId === query.spanId);
    }
    if (query.eventTypes && query.eventTypes.length > 0) {
      filtered = filtered.filter((e) => query.eventTypes!.includes(e.eventType));
    }
    if (query.categories && query.categories.length > 0) {
      filtered = filtered.filter((e) => query.categories!.includes(e.category));
    }
    if (query.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= query.endTime!);
    }
    if (query.minSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequenceNumber >= query.minSequence!);
    }
    if (query.maxSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequenceNumber <= query.maxSequence!);
    }

    const totalCount = filtered.length;

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? filtered.length;
    filtered = filtered.slice(offset, offset + limit);

    return {
      events: filtered,
      totalCount,
      hasMore: offset + filtered.length < totalCount,
    };
  }

  /**
   * Gets the most recent events.
   *
   * @param count - Number of events to retrieve
   */
  getRecentEvents(count: number): ReadonlyArray<CollectedTraceEvent> {
    return this.events.slice(-count);
  }

  /**
   * Gets all events.
   */
  getAllEvents(): ReadonlyArray<CollectedTraceEvent> {
    return [...this.events];
  }

  /**
   * Gets the event count.
   */
  getEventCount(): number {
    return this.events.length;
  }

  // ==========================================================================
  // HASH CHAIN VERIFICATION
  // ==========================================================================

  /**
   * Verifies the integrity of the hash chain.
   *
   * @returns True if hash chain is valid
   */
  verifyHashChain(): boolean {
    if (!this.config.enableHashChain) {
      return true;
    }

    let expectedPreviousHash: ContentHash | null = null;

    for (const event of this.events) {
      // Check previous hash link
      if (event.previousHash?.value !== expectedPreviousHash?.value) {
        return false;
      }

      // Verify event hash
      const computedHash = this.computeEventHash(event);
      if (computedHash.value !== event.eventHash.value) {
        return false;
      }

      expectedPreviousHash = event.eventHash;
    }

    return true;
  }

  /**
   * Gets the current chain hash (hash of the last event).
   */
  getChainHash(): ContentHash | null {
    return this.lastHash;
  }

  // ==========================================================================
  // LISTENERS
  // ==========================================================================

  /**
   * Subscribes to trace events.
   *
   * @param listener - Event listener
   * @returns Unsubscribe function
   */
  onEvent(listener: TraceEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /**
   * Exports the trace data for external storage or analysis.
   */
  export(): TraceExport {
    return {
      traceId: this.traceId,
      simulationId: this.simulationId,
      startTime: this.startTime.toISOString() as ISOTimestamp,
      exportTime: this.getTime(),
      eventCount: this.events.length,
      spanCount: this.spans.size,
      events: [...this.events],
      spans: Array.from(this.spans.values()),
      chainHash: this.lastHash,
      integrityValid: this.verifyHashChain(),
    };
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Gets collection statistics.
   */
  getStatistics(): TraceStatistics {
    const categoryCounts: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};

    for (const event of this.events) {
      categoryCounts[event.category] = (categoryCounts[event.category] ?? 0) + 1;
      eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
    }

    return {
      traceId: this.traceId,
      simulationId: this.simulationId,
      totalEvents: this.events.length,
      totalSpans: this.spans.size,
      categoryCounts,
      eventTypeCounts,
      startTime: this.startTime.toISOString() as ISOTimestamp,
      currentTime: this.getTime(),
      hashChainValid: this.verifyHashChain(),
    };
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private createEvent(
    eventType: string,
    category: TraceEventCategory,
    payload: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    this.sequenceNumber++;

    const eventData = {
      eventId: createEventId(`evt-${this.sequenceNumber}-${Date.now()}`),
      traceId: this.traceId,
      spanId,
      simulationId: this.simulationId,
      timestamp: this.getTime(),
      sequenceNumber: this.sequenceNumber,
      eventType,
      category,
      payload,
      previousHash: this.lastHash,
    };

    const eventHash = this.computeEventHash(eventData);

    return {
      ...eventData,
      eventHash,
    };
  }

  private createMinimalEvent(
    eventType: string,
    category: TraceEventCategory,
    payload: Record<string, unknown>,
    spanId?: SpanId
  ): CollectedTraceEvent {
    // Create event without storing
    const eventId = createEventId(`evt-skip-${Date.now()}`);
    const eventHash = createContentHash('skipped');

    return {
      eventId,
      traceId: this.traceId,
      spanId,
      simulationId: this.simulationId,
      timestamp: this.getTime(),
      sequenceNumber: -1,
      eventType,
      category,
      payload,
      previousHash: null,
      eventHash,
    };
  }

  private computeEventHash(event: Omit<CollectedTraceEvent, 'eventHash'>): ContentHash {
    const hashInput = canonicalSerialize({
      eventId: event.eventId,
      traceId: event.traceId,
      sequenceNumber: event.sequenceNumber,
      eventType: event.eventType,
      timestamp: event.timestamp,
      payload: event.payload,
      previousHash: event.previousHash?.value ?? null,
    });
    return createContentHash(hashInput);
  }

  private categorizeEvent(eventType: string): TraceEventCategory {
    if (eventType.includes('simulation') || eventType.includes('lifecycle')) {
      return 'lifecycle';
    }
    if (eventType.includes('scenario') || eventType.includes('step')) {
      return 'scenario';
    }
    if (eventType.includes('policy')) {
      return 'policy';
    }
    if (eventType.includes('state') || eventType.includes('snapshot')) {
      return 'state';
    }
    if (eventType.includes('artifact')) {
      return 'artifact';
    }
    if (eventType.includes('error') || eventType.includes('fail')) {
      return 'error';
    }
    return 'custom';
  }

  private handleEventOverflow(): void {
    // Remove oldest 10% of events
    const removeCount = Math.floor(this.config.maxEvents * 0.1);
    this.events.splice(0, removeCount);

    // Record overflow event
    this.recordRawEvent('trace_overflow', 'lifecycle', {
      removedCount: removeCount,
      maxEvents: this.config.maxEvents,
    });
  }

  private notifyListeners(event: CollectedTraceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in trace event listener:', error);
      }
    }
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Listener for trace events.
 */
export type TraceEventListener = (event: CollectedTraceEvent) => void;

/**
 * Exported trace data.
 */
export interface TraceExport {
  readonly traceId: TraceId;
  readonly simulationId: SimulationId;
  readonly startTime: ISOTimestamp;
  readonly exportTime: ISOTimestamp;
  readonly eventCount: number;
  readonly spanCount: number;
  readonly events: ReadonlyArray<CollectedTraceEvent>;
  readonly spans: ReadonlyArray<TraceSpanData>;
  readonly chainHash: ContentHash | null;
  readonly integrityValid: boolean;
}

/**
 * Trace collection statistics.
 */
export interface TraceStatistics {
  readonly traceId: TraceId;
  readonly simulationId: SimulationId;
  readonly totalEvents: number;
  readonly totalSpans: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly eventTypeCounts: Readonly<Record<string, number>>;
  readonly startTime: ISOTimestamp;
  readonly currentTime: ISOTimestamp;
  readonly hashChainValid: boolean;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a trace collector with default configuration.
 */
export function createTraceCollector(
  simulationId: SimulationId,
  getTime?: () => ISOTimestamp
): TraceCollector {
  return new TraceCollector(simulationId, undefined, getTime);
}

/**
 * Creates a trace collector with custom configuration.
 */
export function createConfiguredTraceCollector(
  simulationId: SimulationId,
  config: Partial<TraceCollectorConfig>,
  getTime?: () => ISOTimestamp
): TraceCollector {
  return new TraceCollector(simulationId, config, getTime);
}
