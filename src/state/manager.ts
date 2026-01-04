/**
 * State Manager.
 *
 * Manages simulation state with immutable updates and event sourcing.
 * All state changes are tracked and can be replayed for determinism.
 *
 * @module state/manager
 */

import type {
  SimulationId,
  ScenarioId,
  StepId,
  SnapshotId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
} from '../types/common.js';
import type {
  SimulationState,
  ExecutionPhase,
  StateChange,
  StateSnapshot,
  StateDiff,
  StateQuery,
  StateQueryResult,
  CompletedStep,
  ActiveStep,
  SimulatedAgent,
  SimulatedResource,
  ArtifactReference,
  PolicyViolationRecord,
  DataInjection,
} from '../types/state.js';
import type { SimulationEvent } from '../types/events.js';
import { createInitialState } from '../types/state.js';
import { createSnapshotId, createStateVersion } from '../types/common.js';
import { deepClone, deepEquals, getValueAtPath, setValueAtPath } from '../utils/clone.js';
import { createContentHash } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// STATE MANAGER CONFIGURATION
// ============================================================================

/**
 * Configuration for the state manager.
 */
export interface StateManagerConfig {
  /** Maximum snapshots to retain */
  readonly maxSnapshots: number;
  /** Auto-snapshot interval (by version count) */
  readonly snapshotInterval: number;
  /** Whether to validate state integrity on mutation */
  readonly validateOnMutation: boolean;
  /** Whether to enable diff computation */
  readonly enableDiffs: boolean;
  /** Function to get current time */
  readonly getTime: () => ISOTimestamp;
}

/**
 * Default state manager configuration.
 */
export const DEFAULT_STATE_MANAGER_CONFIG: StateManagerConfig = {
  maxSnapshots: 100,
  snapshotInterval: 50,
  validateOnMutation: true,
  enableDiffs: true,
  getTime: () => new Date().toISOString() as ISOTimestamp,
};

// ============================================================================
// STATE MUTATION RESULT
// ============================================================================

/**
 * Result of a state mutation.
 */
export interface StateMutationResult {
  readonly previousState: SimulationState;
  readonly newState: SimulationState;
  readonly changes: ReadonlyArray<StateChange>;
  readonly diff?: StateDiff;
  readonly snapshotCreated?: SnapshotId;
}

// ============================================================================
// STATE MANAGER CLASS
// ============================================================================

/**
 * Manages simulation state with immutable updates.
 *
 * Key features:
 * - Immutable state management
 * - Event sourcing for replay capability
 * - Automatic snapshotting
 * - State validation
 * - Query interface
 */
export class StateManager {
  private readonly simulationId: SimulationId;
  private state: SimulationState;
  private readonly config: StateManagerConfig;
  private readonly snapshots: Map<string, StateSnapshot> = new Map();
  private readonly events: SimulationEvent[] = [];
  private readonly stateHistory: SimulationState[] = [];
  private readonly maxHistory = 10;

  /**
   * Creates a new state manager.
   *
   * @param simulationId - Simulation this manager belongs to
   * @param scenarioId - Scenario being executed
   * @param simulatedStartTime - Simulated start time
   * @param config - Manager configuration
   */
  constructor(
    simulationId: SimulationId,
    scenarioId: ScenarioId,
    simulatedStartTime: ISOTimestamp,
    config?: Partial<StateManagerConfig>
  ) {
    this.simulationId = simulationId;
    this.config = { ...DEFAULT_STATE_MANAGER_CONFIG, ...config };
    this.state = createInitialState(simulationId, scenarioId, simulatedStartTime);
  }

  // ==========================================================================
  // STATE ACCESS
  // ==========================================================================

  /**
   * Gets the current state (read-only).
   */
  getState(): Readonly<SimulationState> {
    return this.state;
  }

  /**
   * Gets the current state version.
   */
  getVersion(): StateVersion {
    return this.state.version;
  }

  /**
   * Gets the current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.state.phase;
  }

  /**
   * Queries a value from the state.
   *
   * @param query - State query
   * @returns Query result
   */
  query(query: StateQuery): StateQueryResult {
    const value = getValueAtPath(this.state, query.path);
    return {
      found: value !== undefined,
      value,
      path: query.path,
    };
  }

  /**
   * Gets a value at a path.
   *
   * @param path - Path to the value
   * @returns Value at path or undefined
   */
  getValue(path: string): unknown {
    return getValueAtPath(this.state, path);
  }

  // ==========================================================================
  // STATE MUTATIONS
  // ==========================================================================

  /**
   * Applies changes to the state immutably.
   *
   * @param changes - Changes to apply
   * @returns Mutation result
   */
  applyChanges(changes: StateChange[]): StateMutationResult {
    const previousState = this.state;
    let newState = deepClone(this.state);

    // Apply each change
    for (const change of changes) {
      newState = this.applyChange(newState, change);
    }

    // Increment version
    newState = {
      ...newState,
      version: createStateVersion(newState.version + 1),
      timestamp: this.config.getTime(),
    };

    // Update metrics
    newState = {
      ...newState,
      metrics: {
        ...newState.metrics,
        stateTransitionCount: newState.metrics.stateTransitionCount + 1,
      },
    };

    // Validate if enabled
    if (this.config.validateOnMutation) {
      this.validateState(newState);
    }

    // Store in history
    this.stateHistory.push(previousState);
    if (this.stateHistory.length > this.maxHistory) {
      this.stateHistory.shift();
    }

    // Update current state
    this.state = newState;

    // Compute diff if enabled
    const diff = this.config.enableDiffs
      ? this.computeDiff(previousState, newState)
      : undefined;

    // Auto-snapshot if needed
    let snapshotCreated: SnapshotId | undefined;
    if (
      newState.version > 0 &&
      newState.version % this.config.snapshotInterval === 0
    ) {
      const snapshot = this.createSnapshot(`auto-${newState.version}`);
      snapshotCreated = snapshot.snapshotId;
    }

    return {
      previousState,
      newState,
      changes,
      diff,
      snapshotCreated,
    };
  }

  /**
   * Sets the execution phase.
   */
  setPhase(phase: ExecutionPhase): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: 'phase',
        value: phase,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Updates the simulated time.
   */
  updateSimulatedTime(time: ISOTimestamp): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: 'simulatedTime',
        value: time,
        trigger: { type: 'system' },
      },
      {
        type: 'set',
        path: 'environment.clock.currentTime',
        value: time,
        trigger: { type: 'system' },
      },
    ]);
  }

  // ==========================================================================
  // STEP MANAGEMENT
  // ==========================================================================

  /**
   * Marks a step as started.
   */
  startStep(stepId: StepId): StateMutationResult {
    const activeStep: ActiveStep = {
      stepId,
      startedAt: this.config.getTime(),
    };

    return this.applyChanges([
      {
        type: 'append',
        path: 'scenarioState.activeSteps',
        value: activeStep,
        trigger: { type: 'step', id: stepId },
      },
      {
        type: 'remove',
        path: 'scenarioState.pendingSteps',
        value: stepId,
        trigger: { type: 'step', id: stepId },
      },
    ]);
  }

  /**
   * Marks a step as completed.
   */
  completeStep(
    stepId: StepId,
    status: 'success' | 'failure' | 'skipped',
    output?: unknown
  ): StateMutationResult {
    const activeSteps = this.state.scenarioState.activeSteps;
    const activeStep = activeSteps.find((s) => s.stepId === stepId);
    const durationMs = activeStep
      ? Date.now() - new Date(activeStep.startedAt).getTime()
      : 0;

    const completedStep: CompletedStep = {
      stepId,
      status,
      completedAt: this.config.getTime(),
      durationMs,
      output,
    };

    const changes: StateChange[] = [
      {
        type: 'append',
        path: 'scenarioState.completedSteps',
        value: completedStep,
        trigger: { type: 'step', id: stepId },
      },
      {
        type: 'set',
        path: `scenarioState.stepResults.${stepId}`,
        value: output,
        trigger: { type: 'step', id: stepId },
      },
      {
        type: 'increment',
        path: 'metrics.stepCount',
        delta: 1,
        trigger: { type: 'step', id: stepId },
      },
    ];

    // Remove from active steps
    const newActiveSteps = activeSteps.filter((s) => s.stepId !== stepId);
    changes.push({
      type: 'set',
      path: 'scenarioState.activeSteps',
      value: newActiveSteps,
      trigger: { type: 'step', id: stepId },
    });

    return this.applyChanges(changes);
  }

  /**
   * Adds pending steps.
   */
  addPendingSteps(stepIds: StepId[]): StateMutationResult {
    return this.applyChanges(
      stepIds.map((stepId) => ({
        type: 'append' as const,
        path: 'scenarioState.pendingSteps',
        value: stepId,
        trigger: { type: 'system' as const },
      }))
    );
  }

  // ==========================================================================
  // ENTITY MANAGEMENT
  // ==========================================================================

  /**
   * Registers an agent.
   */
  registerAgent(agent: SimulatedAgent): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: `entities.agents.${agent.agentId}`,
        value: agent,
        entityType: 'agent',
        entityId: agent.agentId,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Updates an agent.
   */
  updateAgent(
    agentId: string,
    updates: Partial<SimulatedAgent>
  ): StateMutationResult {
    const agent = this.state.entities.agents[agentId];
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return this.applyChanges([
      {
        type: 'merge',
        path: `entities.agents.${agentId}`,
        value: updates,
        entityType: 'agent',
        entityId: agentId,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Registers a resource.
   */
  registerResource(resource: SimulatedResource): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: `entities.resources.${resource.resourceId}`,
        value: resource,
        entityType: 'resource',
        entityId: resource.resourceId,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Registers an artifact.
   */
  registerArtifact(artifact: ArtifactReference): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: `entities.artifacts.${artifact.artifactId}`,
        value: artifact,
        entityType: 'artifact',
        entityId: artifact.artifactId,
        trigger: { type: 'system' },
      },
    ]);
  }

  // ==========================================================================
  // POLICY MANAGEMENT
  // ==========================================================================

  /**
   * Records a policy evaluation.
   */
  recordPolicyEvaluation(
    policyId: string,
    decision: { outcome: string; reason: string },
    stepId?: StepId
  ): StateMutationResult {
    return this.applyChanges([
      {
        type: 'append',
        path: 'policyState.decisionHistory',
        value: {
          policyId,
          timestamp: this.config.getTime(),
          decision,
          stepId,
        },
        trigger: { type: 'policy', id: policyId },
      },
      {
        type: 'increment',
        path: 'metrics.policyEvaluationCount',
        delta: 1,
        trigger: { type: 'policy', id: policyId },
      },
    ]);
  }

  /**
   * Records a policy violation.
   */
  recordViolation(violation: PolicyViolationRecord): StateMutationResult {
    return this.applyChanges([
      {
        type: 'append',
        path: 'policyState.violations',
        value: violation,
        trigger: { type: 'policy', id: violation.policyId },
      },
    ]);
  }

  // ==========================================================================
  // ENVIRONMENT MANAGEMENT
  // ==========================================================================

  /**
   * Records a data injection.
   */
  recordDataInjection(injection: DataInjection): StateMutationResult {
    return this.applyChanges([
      {
        type: 'append',
        path: 'environment.injections',
        value: injection,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Sets an environment variable.
   */
  setEnvironmentVariable(name: string, value: string): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: `environment.variables.${name}`,
        value,
        trigger: { type: 'system' },
      },
    ]);
  }

  /**
   * Sets a feature flag.
   */
  setFeatureFlag(name: string, enabled: boolean): StateMutationResult {
    return this.applyChanges([
      {
        type: 'set',
        path: `environment.featureFlags.${name}`,
        value: enabled,
        trigger: { type: 'system' },
      },
    ]);
  }

  // ==========================================================================
  // SNAPSHOTS
  // ==========================================================================

  /**
   * Creates a snapshot of the current state.
   *
   * @param label - Label for the snapshot
   * @returns Created snapshot
   */
  createSnapshot(label: string): StateSnapshot {
    const serialized = canonicalSerialize(this.state);
    const compressed = Buffer.from(serialized).toString('base64');

    const snapshot: StateSnapshot = {
      snapshotId: createSnapshotId(`snap-${this.state.version}-${Date.now()}`),
      simulationId: this.simulationId,
      version: this.state.version,
      label,
      createdAt: this.config.getTime(),
      contentHash: createContentHash(serialized),
      compressedData: compressed,
      sizeBytes: compressed.length,
    };

    // Enforce max snapshots
    if (this.snapshots.size >= this.config.maxSnapshots) {
      const oldest = Array.from(this.snapshots.keys())[0];
      if (oldest) {
        this.snapshots.delete(oldest);
      }
    }

    this.snapshots.set(snapshot.snapshotId, snapshot);

    // Update metrics
    this.applyChanges([
      {
        type: 'increment',
        path: 'metrics.snapshotCount',
        delta: 1,
        trigger: { type: 'system' },
      },
    ]);

    return snapshot;
  }

  /**
   * Restores state from a snapshot.
   *
   * @param snapshotId - Snapshot to restore
   * @returns Restored state
   */
  restoreSnapshot(snapshotId: SnapshotId): SimulationState {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const decompressed = Buffer.from(snapshot.compressedData, 'base64').toString();
    const restoredState = JSON.parse(decompressed) as SimulationState;

    // Verify integrity
    const hash = createContentHash(decompressed);
    if (hash.value !== snapshot.contentHash.value) {
      throw new Error('Snapshot integrity check failed');
    }

    this.state = restoredState;
    return this.state;
  }

  /**
   * Gets all snapshots.
   */
  getSnapshots(): ReadonlyArray<StateSnapshot> {
    return Array.from(this.snapshots.values());
  }

  /**
   * Gets a snapshot by ID.
   */
  getSnapshot(snapshotId: SnapshotId): StateSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  // ==========================================================================
  // ROLLBACK
  // ==========================================================================

  /**
   * Rolls back to a previous version.
   *
   * @param targetVersion - Version to roll back to
   * @returns Rolled back state
   */
  rollbackToVersion(targetVersion: StateVersion): SimulationState {
    // Find snapshot closest to target version
    let bestSnapshot: StateSnapshot | null = null;
    for (const snapshot of this.snapshots.values()) {
      if (
        snapshot.version <= targetVersion &&
        (!bestSnapshot || snapshot.version > bestSnapshot.version)
      ) {
        bestSnapshot = snapshot;
      }
    }

    if (!bestSnapshot) {
      throw new Error(`No snapshot available for rollback to version ${targetVersion}`);
    }

    return this.restoreSnapshot(bestSnapshot.snapshotId);
  }

  /**
   * Rolls back to the previous state.
   */
  rollbackToPrevious(): SimulationState | null {
    const previous = this.stateHistory.pop();
    if (previous) {
      this.state = previous;
      return this.state;
    }
    return null;
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  /**
   * Records an event.
   */
  recordEvent(event: SimulationEvent): void {
    this.events.push(event);
  }

  /**
   * Gets all recorded events.
   */
  getEvents(): ReadonlyArray<SimulationEvent> {
    return [...this.events];
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private applyChange(state: SimulationState, change: StateChange): SimulationState {
    switch (change.type) {
      case 'set':
        return setValueAtPath(state, change.path, change.value);

      case 'append': {
        const currentArray = getValueAtPath(state, change.path);
        if (!Array.isArray(currentArray)) {
          return setValueAtPath(state, change.path, [change.value]);
        }
        return setValueAtPath(state, change.path, [...currentArray, change.value]);
      }

      case 'remove': {
        const currentValue = getValueAtPath(state, change.path);
        if (Array.isArray(currentValue)) {
          const filtered = currentValue.filter((item) => !deepEquals(item, change.value));
          return setValueAtPath(state, change.path, filtered);
        }
        if (typeof currentValue === 'object' && currentValue !== null && change.key) {
          const newObj = { ...currentValue as Record<string, unknown> };
          delete newObj[change.key];
          return setValueAtPath(state, change.path, newObj);
        }
        return state;
      }

      case 'increment': {
        const currentNum = getValueAtPath(state, change.path);
        const newNum = (typeof currentNum === 'number' ? currentNum : 0) + (change.delta ?? 1);
        return setValueAtPath(state, change.path, newNum);
      }

      case 'merge': {
        const currentObj = getValueAtPath(state, change.path);
        if (typeof currentObj === 'object' && currentObj !== null) {
          const merged = { ...currentObj as Record<string, unknown>, ...change.value as Record<string, unknown> };
          return setValueAtPath(state, change.path, merged);
        }
        return setValueAtPath(state, change.path, change.value);
      }

      default:
        return state;
    }
  }

  private validateState(state: SimulationState): void {
    // Basic validation
    if (state.version < 0) {
      throw new Error('Invalid state: version cannot be negative');
    }
    if (!state.phase) {
      throw new Error('Invalid state: phase is required');
    }
    if (!state.scenarioState) {
      throw new Error('Invalid state: scenarioState is required');
    }
  }

  private computeDiff(oldState: SimulationState, newState: SimulationState): StateDiff {
    const changes: Array<{
      readonly path: string;
      readonly type: 'added' | 'modified' | 'removed';
      readonly oldValue?: unknown;
      readonly newValue?: unknown;
    }> = [];
    let added = 0;
    let modified = 0;
    let removed = 0;

    // Compare top-level properties
    const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

    for (const key of allKeys) {
      const oldValue = (oldState as unknown as Record<string, unknown>)[key];
      const newValue = (newState as unknown as Record<string, unknown>)[key];

      if (oldValue === undefined && newValue !== undefined) {
        changes.push({ path: key, type: 'added', newValue });
        added++;
      } else if (oldValue !== undefined && newValue === undefined) {
        changes.push({ path: key, type: 'removed', oldValue });
        removed++;
      } else if (!deepEquals(oldValue, newValue)) {
        changes.push({ path: key, type: 'modified', oldValue, newValue });
        modified++;
      }
    }

    return {
      fromVersion: oldState.version,
      toVersion: newState.version,
      changes,
      summary: { added, modified, removed },
    };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a state manager.
 */
export function createStateManager(
  simulationId: SimulationId,
  scenarioId: ScenarioId,
  simulatedStartTime: ISOTimestamp,
  config?: Partial<StateManagerConfig>
): StateManager {
  return new StateManager(simulationId, scenarioId, simulatedStartTime, config);
}
