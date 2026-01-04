/**
 * Event Store.
 *
 * Provides event sourcing capabilities for simulation replay.
 * All state changes are recorded as events that can be replayed
 * to reconstruct any historical state.
 *
 * @module state/store
 */

import type {
  SimulationId,
  EventId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
} from '../types/common.js';
import type { SimulationEvent } from '../types/events.js';
import { createEventId } from '../types/common.js';
import { createContentHash } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// STORED EVENT TYPE
// ============================================================================

/**
 * An event stored in the event store.
 */
export interface StoredEvent {
  /** Unique event identifier */
  readonly eventId: EventId;
  /** Simulation this event belongs to */
  readonly simulationId: SimulationId;
  /** Sequence number within the simulation */
  readonly sequenceNumber: number;
  /** State version after this event */
  readonly version: StateVersion;
  /** When the event occurred */
  readonly timestamp: ISOTimestamp;
  /** Event type */
  readonly eventType: string;
  /** Event payload */
  readonly payload: SimulationEvent;
  /** Hash of previous event */
  readonly previousHash: ContentHash | null;
  /** Hash of this event */
  readonly eventHash: ContentHash;
}

// ============================================================================
// EVENT STORE CONFIGURATION
// ============================================================================

/**
 * Configuration for the event store.
 */
export interface EventStoreConfig {
  /** Maximum events to retain */
  readonly maxEvents: number;
  /** Enable hash chain for integrity */
  readonly enableHashChain: boolean;
  /** Enable compression for stored events */
  readonly enableCompression: boolean;
}

/**
 * Default event store configuration.
 */
export const DEFAULT_EVENT_STORE_CONFIG: EventStoreConfig = {
  maxEvents: 100_000,
  enableHashChain: true,
  enableCompression: false,
};

// ============================================================================
// EVENT STORE CLASS
// ============================================================================

/**
 * Stores simulation events for replay capability.
 *
 * Key features:
 * - Event sourcing with hash chain integrity
 * - Query interface for event retrieval
 * - Replay capability for state reconstruction
 * - Audit trail for compliance
 */
export class EventStore {
  private readonly simulationId: SimulationId;
  private readonly config: EventStoreConfig;
  private readonly events: StoredEvent[] = [];
  private sequenceNumber = 0;
  private lastHash: ContentHash | null = null;
  private readonly getTime: () => ISOTimestamp;

  constructor(
    simulationId: SimulationId,
    config?: Partial<EventStoreConfig>,
    getTime?: () => ISOTimestamp
  ) {
    this.simulationId = simulationId;
    this.config = { ...DEFAULT_EVENT_STORE_CONFIG, ...config };
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // EVENT APPENDING
  // ==========================================================================

  /**
   * Appends an event to the store.
   *
   * @param event - Event to append
   * @param version - State version after the event
   * @returns Stored event
   */
  append(event: SimulationEvent, version: StateVersion): StoredEvent {
    // Check event limit
    if (this.events.length >= this.config.maxEvents) {
      this.handleOverflow();
    }

    this.sequenceNumber++;

    const storedEvent: StoredEvent = {
      eventId: createEventId(`evt-${this.sequenceNumber}-${Date.now()}`),
      simulationId: this.simulationId,
      sequenceNumber: this.sequenceNumber,
      version,
      timestamp: this.getTime(),
      eventType: event.eventType,
      payload: event,
      previousHash: this.lastHash,
      eventHash: null as unknown as ContentHash, // Will be set below
    };

    // Compute hash
    const hashInput = canonicalSerialize({
      eventId: storedEvent.eventId,
      sequenceNumber: storedEvent.sequenceNumber,
      eventType: storedEvent.eventType,
      timestamp: storedEvent.timestamp,
      payload: storedEvent.payload,
      previousHash: storedEvent.previousHash?.value ?? null,
    });

    const finalEvent: StoredEvent = {
      ...storedEvent,
      eventHash: createContentHash(hashInput),
    };

    this.events.push(finalEvent);

    if (this.config.enableHashChain) {
      this.lastHash = finalEvent.eventHash;
    }

    return finalEvent;
  }

  /**
   * Appends multiple events.
   *
   * @param events - Events to append
   * @param startVersion - Starting version
   * @returns Stored events
   */
  appendBatch(
    events: SimulationEvent[],
    startVersion: StateVersion
  ): StoredEvent[] {
    const stored: StoredEvent[] = [];
    let version = startVersion;

    for (const event of events) {
      version = (version + 1) as StateVersion;
      stored.push(this.append(event, version));
    }

    return stored;
  }

  // ==========================================================================
  // EVENT RETRIEVAL
  // ==========================================================================

  /**
   * Gets all events.
   */
  getAll(): ReadonlyArray<StoredEvent> {
    return [...this.events];
  }

  /**
   * Gets events by sequence range.
   *
   * @param fromSequence - Start sequence (inclusive)
   * @param toSequence - End sequence (inclusive)
   */
  getBySequenceRange(
    fromSequence: number,
    toSequence: number
  ): ReadonlyArray<StoredEvent> {
    return this.events.filter(
      (e) => e.sequenceNumber >= fromSequence && e.sequenceNumber <= toSequence
    );
  }

  /**
   * Gets events by version range.
   *
   * @param fromVersion - Start version (inclusive)
   * @param toVersion - End version (inclusive)
   */
  getByVersionRange(
    fromVersion: StateVersion,
    toVersion: StateVersion
  ): ReadonlyArray<StoredEvent> {
    return this.events.filter(
      (e) => e.version >= fromVersion && e.version <= toVersion
    );
  }

  /**
   * Gets events by type.
   *
   * @param eventTypes - Event types to filter
   */
  getByType(eventTypes: string[]): ReadonlyArray<StoredEvent> {
    return this.events.filter((e) => eventTypes.includes(e.eventType));
  }

  /**
   * Gets events by time range.
   *
   * @param startTime - Start time (inclusive)
   * @param endTime - End time (inclusive)
   */
  getByTimeRange(
    startTime: ISOTimestamp,
    endTime: ISOTimestamp
  ): ReadonlyArray<StoredEvent> {
    return this.events.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  /**
   * Gets events since a specific version.
   *
   * @param version - Version to start from (exclusive)
   */
  getSinceVersion(version: StateVersion): ReadonlyArray<StoredEvent> {
    return this.events.filter((e) => e.version > version);
  }

  /**
   * Gets an event by ID.
   *
   * @param eventId - Event ID
   */
  getById(eventId: EventId): StoredEvent | undefined {
    return this.events.find((e) => e.eventId === eventId);
  }

  /**
   * Gets the most recent events.
   *
   * @param count - Number of events
   */
  getRecent(count: number): ReadonlyArray<StoredEvent> {
    return this.events.slice(-count);
  }

  /**
   * Gets the last event.
   */
  getLast(): StoredEvent | undefined {
    return this.events[this.events.length - 1];
  }

  // ==========================================================================
  // REPLAY
  // ==========================================================================

  /**
   * Creates an iterator for replaying events.
   *
   * @param fromSequence - Starting sequence (default: 1)
   * @param toSequence - Ending sequence (default: last)
   */
  *replay(
    fromSequence?: number,
    toSequence?: number
  ): Generator<StoredEvent, void, unknown> {
    const start = fromSequence ?? 1;
    const end = toSequence ?? this.sequenceNumber;

    for (const event of this.events) {
      if (event.sequenceNumber >= start && event.sequenceNumber <= end) {
        yield event;
      }
    }
  }

  /**
   * Replays events by calling a handler for each.
   *
   * @param handler - Event handler
   * @param fromSequence - Starting sequence
   * @param toSequence - Ending sequence
   */
  async replayWithHandler(
    handler: (event: StoredEvent) => Promise<void> | void,
    fromSequence?: number,
    toSequence?: number
  ): Promise<number> {
    let count = 0;
    for (const event of this.replay(fromSequence, toSequence)) {
      await handler(event);
      count++;
    }
    return count;
  }

  // ==========================================================================
  // HASH CHAIN VERIFICATION
  // ==========================================================================

  /**
   * Verifies the integrity of the hash chain.
   *
   * @returns True if valid
   */
  verifyHashChain(): boolean {
    if (!this.config.enableHashChain) {
      return true;
    }

    let expectedPreviousHash: ContentHash | null = null;

    for (const event of this.events) {
      // Check previous hash link
      if (
        (event.previousHash?.value ?? null) !==
        (expectedPreviousHash?.value ?? null)
      ) {
        return false;
      }

      // Verify event hash
      const hashInput = canonicalSerialize({
        eventId: event.eventId,
        sequenceNumber: event.sequenceNumber,
        eventType: event.eventType,
        timestamp: event.timestamp,
        payload: event.payload,
        previousHash: event.previousHash?.value ?? null,
      });

      const computedHash = createContentHash(hashInput);
      if (computedHash.value !== event.eventHash.value) {
        return false;
      }

      expectedPreviousHash = event.eventHash;
    }

    return true;
  }

  /**
   * Gets the current chain hash.
   */
  getChainHash(): ContentHash | null {
    return this.lastHash;
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Gets the event count.
   */
  getCount(): number {
    return this.events.length;
  }

  /**
   * Gets the current sequence number.
   */
  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  /**
   * Gets store statistics.
   */
  getStatistics(): EventStoreStatistics {
    const eventTypeCounts: Record<string, number> = {};
    for (const event of this.events) {
      eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
    }

    return {
      simulationId: this.simulationId,
      eventCount: this.events.length,
      sequenceNumber: this.sequenceNumber,
      firstTimestamp: this.events[0]?.timestamp,
      lastTimestamp: this.events[this.events.length - 1]?.timestamp,
      eventTypeCounts,
      hashChainValid: this.verifyHashChain(),
    };
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /**
   * Exports the event store.
   */
  export(): EventStoreExport {
    return {
      simulationId: this.simulationId,
      exportedAt: this.getTime(),
      eventCount: this.events.length,
      events: [...this.events],
      chainHash: this.lastHash,
    };
  }

  /**
   * Imports events from an export.
   *
   * @param data - Exported data
   */
  import(data: EventStoreExport): void {
    if (data.simulationId !== this.simulationId) {
      throw new Error('Cannot import events from different simulation');
    }

    for (const event of data.events) {
      this.events.push(event);
      this.sequenceNumber = Math.max(this.sequenceNumber, event.sequenceNumber);
    }

    this.lastHash = data.chainHash;
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private handleOverflow(): void {
    // Remove oldest 10% of events
    const removeCount = Math.floor(this.config.maxEvents * 0.1);
    this.events.splice(0, removeCount);
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Event store statistics.
 */
export interface EventStoreStatistics {
  readonly simulationId: SimulationId;
  readonly eventCount: number;
  readonly sequenceNumber: number;
  readonly firstTimestamp?: ISOTimestamp;
  readonly lastTimestamp?: ISOTimestamp;
  readonly eventTypeCounts: Readonly<Record<string, number>>;
  readonly hashChainValid: boolean;
}

/**
 * Exported event store data.
 */
export interface EventStoreExport {
  readonly simulationId: SimulationId;
  readonly exportedAt: ISOTimestamp;
  readonly eventCount: number;
  readonly events: ReadonlyArray<StoredEvent>;
  readonly chainHash: ContentHash | null;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an event store.
 */
export function createEventStore(
  simulationId: SimulationId,
  config?: Partial<EventStoreConfig>,
  getTime?: () => ISOTimestamp
): EventStore {
  return new EventStore(simulationId, config, getTime);
}
