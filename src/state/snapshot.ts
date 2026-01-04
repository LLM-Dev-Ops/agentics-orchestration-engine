/**
 * State Snapshot Management.
 *
 * Provides utilities for creating, storing, and restoring
 * simulation state snapshots.
 *
 * @module state/snapshot
 */

import type {
  SimulationId,
  SnapshotId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
} from '../types/common.js';
import type { SimulationState, StateSnapshot } from '../types/state.js';
import { createSnapshotId } from '../types/common.js';
import { createContentHash } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// SNAPSHOT CONFIGURATION
// ============================================================================

/**
 * Configuration for snapshot management.
 */
export interface SnapshotConfig {
  /** Maximum snapshots to retain */
  readonly maxSnapshots: number;
  /** Compression enabled */
  readonly enableCompression: boolean;
  /** Verify integrity on restore */
  readonly verifyOnRestore: boolean;
}

/**
 * Default snapshot configuration.
 */
export const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfig = {
  maxSnapshots: 100,
  enableCompression: true,
  verifyOnRestore: true,
};

// ============================================================================
// SNAPSHOT STORE
// ============================================================================

/**
 * Stores and manages state snapshots.
 */
export class SnapshotStore {
  private readonly config: SnapshotConfig;
  private readonly snapshots: Map<string, StateSnapshot> = new Map();
  private readonly snapshotOrder: string[] = [];

  constructor(config?: Partial<SnapshotConfig>) {
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
  }

  /**
   * Creates a snapshot from the current state.
   *
   * @param state - State to snapshot
   * @param simulationId - Simulation ID
   * @param label - Snapshot label
   * @returns Created snapshot
   */
  create(
    state: SimulationState,
    simulationId: SimulationId,
    label: string
  ): StateSnapshot {
    const serialized = canonicalSerialize(state);
    const compressed = this.config.enableCompression
      ? Buffer.from(serialized).toString('base64')
      : serialized;

    const snapshot: StateSnapshot = {
      snapshotId: createSnapshotId(`snap-${state.version}-${Date.now()}`),
      simulationId,
      version: state.version,
      label,
      createdAt: new Date().toISOString() as ISOTimestamp,
      contentHash: createContentHash(serialized),
      compressedData: compressed,
      sizeBytes: compressed.length,
    };

    this.store(snapshot);
    return snapshot;
  }

  /**
   * Stores a snapshot.
   *
   * @param snapshot - Snapshot to store
   */
  store(snapshot: StateSnapshot): void {
    // Enforce max snapshots (FIFO eviction)
    while (this.snapshotOrder.length >= this.config.maxSnapshots) {
      const oldest = this.snapshotOrder.shift();
      if (oldest) {
        this.snapshots.delete(oldest);
      }
    }

    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.snapshotOrder.push(snapshot.snapshotId);
  }

  /**
   * Restores state from a snapshot.
   *
   * @param snapshotId - Snapshot ID
   * @returns Restored state
   */
  restore(snapshotId: SnapshotId): SimulationState {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const serialized = this.config.enableCompression
      ? Buffer.from(snapshot.compressedData, 'base64').toString()
      : snapshot.compressedData;

    // Verify integrity if enabled
    if (this.config.verifyOnRestore) {
      const hash = createContentHash(serialized);
      if (hash.value !== snapshot.contentHash.value) {
        throw new Error(`Snapshot integrity check failed: ${snapshotId}`);
      }
    }

    return JSON.parse(serialized) as SimulationState;
  }

  /**
   * Gets a snapshot by ID.
   *
   * @param snapshotId - Snapshot ID
   * @returns Snapshot or undefined
   */
  get(snapshotId: SnapshotId): StateSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Finds the closest snapshot to a version.
   *
   * @param targetVersion - Target version
   * @param direction - Search direction ('before' or 'after')
   * @returns Closest snapshot or undefined
   */
  findClosest(
    targetVersion: StateVersion,
    direction: 'before' | 'after' = 'before'
  ): StateSnapshot | undefined {
    let best: StateSnapshot | undefined;

    for (const snapshot of this.snapshots.values()) {
      if (direction === 'before') {
        if (
          snapshot.version <= targetVersion &&
          (!best || snapshot.version > best.version)
        ) {
          best = snapshot;
        }
      } else {
        if (
          snapshot.version >= targetVersion &&
          (!best || snapshot.version < best.version)
        ) {
          best = snapshot;
        }
      }
    }

    return best;
  }

  /**
   * Gets all snapshots.
   */
  getAll(): ReadonlyArray<StateSnapshot> {
    return Array.from(this.snapshots.values());
  }

  /**
   * Gets snapshots by label pattern.
   *
   * @param pattern - Label pattern (supports * wildcard)
   */
  findByLabel(pattern: string): ReadonlyArray<StateSnapshot> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.snapshots.values()).filter((s) =>
      regex.test(s.label)
    );
  }

  /**
   * Deletes a snapshot.
   *
   * @param snapshotId - Snapshot ID
   * @returns True if deleted
   */
  delete(snapshotId: SnapshotId): boolean {
    const index = this.snapshotOrder.indexOf(snapshotId);
    if (index >= 0) {
      this.snapshotOrder.splice(index, 1);
    }
    return this.snapshots.delete(snapshotId);
  }

  /**
   * Clears all snapshots.
   */
  clear(): void {
    this.snapshots.clear();
    this.snapshotOrder.length = 0;
  }

  /**
   * Gets the total size of all snapshots.
   */
  getTotalSize(): number {
    let total = 0;
    for (const snapshot of this.snapshots.values()) {
      total += snapshot.sizeBytes;
    }
    return total;
  }

  /**
   * Gets the number of stored snapshots.
   */
  get size(): number {
    return this.snapshots.size;
  }
}

// ============================================================================
// SNAPSHOT COMPARISON
// ============================================================================

/**
 * Compares two snapshots.
 */
export interface SnapshotComparison {
  readonly snapshot1: SnapshotId;
  readonly snapshot2: SnapshotId;
  readonly versionDiff: number;
  readonly sizeDiff: number;
  readonly identical: boolean;
}

/**
 * Compares two snapshots.
 *
 * @param store - Snapshot store
 * @param id1 - First snapshot ID
 * @param id2 - Second snapshot ID
 * @returns Comparison result
 */
export function compareSnapshots(
  store: SnapshotStore,
  id1: SnapshotId,
  id2: SnapshotId
): SnapshotComparison {
  const s1 = store.get(id1);
  const s2 = store.get(id2);

  if (!s1 || !s2) {
    throw new Error('One or both snapshots not found');
  }

  return {
    snapshot1: id1,
    snapshot2: id2,
    versionDiff: s2.version - s1.version,
    sizeDiff: s2.sizeBytes - s1.sizeBytes,
    identical: s1.contentHash.value === s2.contentHash.value,
  };
}

// ============================================================================
// SNAPSHOT METADATA
// ============================================================================

/**
 * Extracts metadata from a snapshot without restoring it.
 */
export interface SnapshotMetadata {
  readonly snapshotId: SnapshotId;
  readonly simulationId: SimulationId;
  readonly version: StateVersion;
  readonly label: string;
  readonly createdAt: ISOTimestamp;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
}

/**
 * Gets metadata for a snapshot.
 */
export function getSnapshotMetadata(snapshot: StateSnapshot): SnapshotMetadata {
  return {
    snapshotId: snapshot.snapshotId,
    simulationId: snapshot.simulationId,
    version: snapshot.version,
    label: snapshot.label,
    createdAt: snapshot.createdAt,
    sizeBytes: snapshot.sizeBytes,
    contentHash: snapshot.contentHash,
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a snapshot store.
 */
export function createSnapshotStore(config?: Partial<SnapshotConfig>): SnapshotStore {
  return new SnapshotStore(config);
}
