/**
 * External Data Snapshot.
 *
 * Manages immutable snapshots of external data for deterministic
 * simulation replay. External data is captured at simulation start
 * and cannot be modified during execution.
 *
 * @module state/data-snapshot
 */

import type {
  SimulationId,
  ISOTimestamp,
  ContentHash,
  EntityReference,
} from '../types/common.js';
import type { NormalizedEntity, NormalizedEntitySet } from '../integration/adapters/erp-surface.js';
import type { Policy, PolicySet } from '../types/policy.js';
import type { CostBaseline, CostBaselineSet } from '../integration/adapters/costops.js';
import { createContentHash } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// DATA SNAPSHOT TYPES
// ============================================================================

/**
 * A snapshot of external entity data.
 */
export interface EntityDataSnapshot {
  readonly type: 'entity';
  readonly snapshotId: string;
  readonly simulationId: SimulationId;
  readonly createdAt: ISOTimestamp;
  readonly entityType: string;
  readonly entities: ReadonlyArray<NormalizedEntity>;
  readonly totalCount: number;
  readonly contentHash: ContentHash;
}

/**
 * A snapshot of policy data.
 */
export interface PolicyDataSnapshot {
  readonly type: 'policy';
  readonly snapshotId: string;
  readonly simulationId: SimulationId;
  readonly createdAt: ISOTimestamp;
  readonly policies: ReadonlyArray<Policy>;
  readonly contentHash: ContentHash;
}

/**
 * A snapshot of cost baseline data.
 */
export interface CostDataSnapshot {
  readonly type: 'cost';
  readonly snapshotId: string;
  readonly simulationId: SimulationId;
  readonly createdAt: ISOTimestamp;
  readonly baselines: ReadonlyArray<CostBaseline>;
  readonly contentHash: ContentHash;
}

/**
 * Union of all data snapshot types.
 */
export type DataSnapshot = EntityDataSnapshot | PolicyDataSnapshot | CostDataSnapshot;

// ============================================================================
// DATA SNAPSHOT MANIFEST
// ============================================================================

/**
 * Manifest of all data snapshots for a simulation.
 */
export interface DataSnapshotManifest {
  readonly simulationId: SimulationId;
  readonly createdAt: ISOTimestamp;
  readonly snapshots: ReadonlyArray<{
    readonly type: DataSnapshot['type'];
    readonly snapshotId: string;
    readonly contentHash: ContentHash;
  }>;
  readonly manifestHash: ContentHash;
}

// ============================================================================
// DATA SNAPSHOT MANAGER
// ============================================================================

/**
 * Manages external data snapshots for simulation isolation.
 *
 * CRITICAL: Once created, data snapshots are immutable.
 * All reads during simulation must come from the snapshot,
 * not from live external systems.
 */
export class DataSnapshotManager {
  private readonly simulationId: SimulationId;
  private readonly entitySnapshots: Map<string, EntityDataSnapshot> = new Map();
  private readonly policySnapshots: Map<string, PolicyDataSnapshot> = new Map();
  private readonly costSnapshots: Map<string, CostDataSnapshot> = new Map();
  private manifest: DataSnapshotManifest | null = null;
  private sealed = false;
  private readonly getTime: () => ISOTimestamp;

  constructor(
    simulationId: SimulationId,
    getTime?: () => ISOTimestamp
  ) {
    this.simulationId = simulationId;
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // ENTITY SNAPSHOTS
  // ==========================================================================

  /**
   * Creates a snapshot of entity data.
   *
   * @param entityType - Type of entities
   * @param entitySet - Entity data to snapshot
   * @returns Created snapshot
   */
  snapshotEntities(
    entityType: string,
    entitySet: NormalizedEntitySet
  ): EntityDataSnapshot {
    this.ensureNotSealed();

    const serialized = canonicalSerialize(entitySet.entities);
    const snapshot: EntityDataSnapshot = {
      type: 'entity',
      snapshotId: `entity-${entityType}-${Date.now()}`,
      simulationId: this.simulationId,
      createdAt: this.getTime(),
      entityType,
      entities: entitySet.entities,
      totalCount: entitySet.totalCount,
      contentHash: createContentHash(serialized),
    };

    this.entitySnapshots.set(entityType, snapshot);
    return snapshot;
  }

  /**
   * Gets an entity snapshot by type.
   */
  getEntitySnapshot(entityType: string): EntityDataSnapshot | undefined {
    return this.entitySnapshots.get(entityType);
  }

  /**
   * Gets entities from a snapshot.
   *
   * @param entityType - Entity type
   * @param filter - Optional filter function
   * @returns Filtered entities
   */
  getEntities(
    entityType: string,
    filter?: (entity: NormalizedEntity) => boolean
  ): ReadonlyArray<NormalizedEntity> {
    const snapshot = this.entitySnapshots.get(entityType);
    if (!snapshot) {
      return [];
    }

    return filter ? snapshot.entities.filter(filter) : snapshot.entities;
  }

  /**
   * Gets a single entity from a snapshot.
   */
  getEntity(reference: EntityReference): NormalizedEntity | undefined {
    const snapshot = this.entitySnapshots.get(reference.entityType);
    if (!snapshot) {
      return undefined;
    }

    return snapshot.entities.find((e) => e.entityId === reference.entityId);
  }

  // ==========================================================================
  // POLICY SNAPSHOTS
  // ==========================================================================

  /**
   * Creates a snapshot of policy data.
   *
   * @param policySet - Policy data to snapshot
   * @returns Created snapshot
   */
  snapshotPolicies(policySet: PolicySet): PolicyDataSnapshot {
    this.ensureNotSealed();

    const serialized = canonicalSerialize(policySet.policies);
    const snapshot: PolicyDataSnapshot = {
      type: 'policy',
      snapshotId: `policy-${Date.now()}`,
      simulationId: this.simulationId,
      createdAt: this.getTime(),
      policies: policySet.policies,
      contentHash: createContentHash(serialized),
    };

    this.policySnapshots.set('default', snapshot);
    return snapshot;
  }

  /**
   * Gets the policy snapshot.
   */
  getPolicySnapshot(): PolicyDataSnapshot | undefined {
    return this.policySnapshots.get('default');
  }

  /**
   * Gets policies from the snapshot.
   */
  getPolicies(): ReadonlyArray<Policy> {
    const snapshot = this.policySnapshots.get('default');
    return snapshot?.policies ?? [];
  }

  // ==========================================================================
  // COST SNAPSHOTS
  // ==========================================================================

  /**
   * Creates a snapshot of cost baseline data.
   *
   * @param baselineSet - Cost data to snapshot
   * @returns Created snapshot
   */
  snapshotCostBaselines(baselineSet: CostBaselineSet): CostDataSnapshot {
    this.ensureNotSealed();

    const serialized = canonicalSerialize(baselineSet.baselines);
    const snapshot: CostDataSnapshot = {
      type: 'cost',
      snapshotId: `cost-${Date.now()}`,
      simulationId: this.simulationId,
      createdAt: this.getTime(),
      baselines: baselineSet.baselines,
      contentHash: createContentHash(serialized),
    };

    this.costSnapshots.set('default', snapshot);
    return snapshot;
  }

  /**
   * Gets the cost snapshot.
   */
  getCostSnapshot(): CostDataSnapshot | undefined {
    return this.costSnapshots.get('default');
  }

  /**
   * Gets cost baselines from the snapshot.
   */
  getCostBaselines(): ReadonlyArray<CostBaseline> {
    const snapshot = this.costSnapshots.get('default');
    return snapshot?.baselines ?? [];
  }

  // ==========================================================================
  // SEALING AND MANIFEST
  // ==========================================================================

  /**
   * Seals the data snapshots, preventing further modifications.
   * This must be called before simulation execution starts.
   */
  seal(): DataSnapshotManifest {
    if (this.sealed) {
      if (this.manifest) {
        return this.manifest;
      }
      throw new Error('Data snapshots already sealed but manifest is missing');
    }

    const snapshots: Array<{
      readonly type: DataSnapshot['type'];
      readonly snapshotId: string;
      readonly contentHash: ContentHash;
    }> = [];

    for (const snapshot of this.entitySnapshots.values()) {
      snapshots.push({
        type: 'entity',
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
      });
    }

    for (const snapshot of this.policySnapshots.values()) {
      snapshots.push({
        type: 'policy',
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
      });
    }

    for (const snapshot of this.costSnapshots.values()) {
      snapshots.push({
        type: 'cost',
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
      });
    }

    const manifestData = canonicalSerialize({ simulationId: this.simulationId, snapshots });

    this.manifest = {
      simulationId: this.simulationId,
      createdAt: this.getTime(),
      snapshots,
      manifestHash: createContentHash(manifestData),
    };

    this.sealed = true;
    return this.manifest;
  }

  /**
   * Gets the manifest (must be sealed first).
   */
  getManifest(): DataSnapshotManifest {
    if (!this.manifest) {
      throw new Error('Data snapshots not sealed yet');
    }
    return this.manifest;
  }

  /**
   * Checks if snapshots are sealed.
   */
  isSealed(): boolean {
    return this.sealed;
  }

  // ==========================================================================
  // VERIFICATION
  // ==========================================================================

  /**
   * Verifies the integrity of all snapshots.
   *
   * @returns True if all snapshots are valid
   */
  verifyIntegrity(): boolean {
    for (const snapshot of this.entitySnapshots.values()) {
      const serialized = canonicalSerialize(snapshot.entities);
      const hash = createContentHash(serialized);
      if (hash.value !== snapshot.contentHash.value) {
        return false;
      }
    }

    for (const snapshot of this.policySnapshots.values()) {
      const serialized = canonicalSerialize(snapshot.policies);
      const hash = createContentHash(serialized);
      if (hash.value !== snapshot.contentHash.value) {
        return false;
      }
    }

    for (const snapshot of this.costSnapshots.values()) {
      const serialized = canonicalSerialize(snapshot.baselines);
      const hash = createContentHash(serialized);
      if (hash.value !== snapshot.contentHash.value) {
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Gets statistics about the data snapshots.
   */
  getStatistics(): DataSnapshotStatistics {
    let totalEntities = 0;
    for (const snapshot of this.entitySnapshots.values()) {
      totalEntities += snapshot.totalCount;
    }

    let totalPolicies = 0;
    for (const snapshot of this.policySnapshots.values()) {
      totalPolicies += snapshot.policies.length;
    }

    let totalBaselines = 0;
    for (const snapshot of this.costSnapshots.values()) {
      totalBaselines += snapshot.baselines.length;
    }

    return {
      entitySnapshotCount: this.entitySnapshots.size,
      policySnapshotCount: this.policySnapshots.size,
      costSnapshotCount: this.costSnapshots.size,
      totalEntities,
      totalPolicies,
      totalBaselines,
      sealed: this.sealed,
    };
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private ensureNotSealed(): void {
    if (this.sealed) {
      throw new Error('Cannot modify sealed data snapshots');
    }
  }
}

// ============================================================================
// STATISTICS TYPE
// ============================================================================

/**
 * Statistics about data snapshots.
 */
export interface DataSnapshotStatistics {
  readonly entitySnapshotCount: number;
  readonly policySnapshotCount: number;
  readonly costSnapshotCount: number;
  readonly totalEntities: number;
  readonly totalPolicies: number;
  readonly totalBaselines: number;
  readonly sealed: boolean;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a data snapshot manager.
 */
export function createDataSnapshotManager(
  simulationId: SimulationId,
  getTime?: () => ISOTimestamp
): DataSnapshotManager {
  return new DataSnapshotManager(simulationId, getTime);
}
