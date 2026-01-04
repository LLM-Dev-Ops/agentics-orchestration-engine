/**
 * Simulation state types for the Agentics Simulation Engine.
 *
 * State is managed immutably with event sourcing for complete
 * auditability and replay capability.
 *
 * @module types/state
 */

import type {
  SimulationId,
  ScenarioId,
  StepId,
  SnapshotId,
  AgentId,
  ResourceId,
  ArtifactId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
} from './common.js';
import type { PolicyDecision } from './policy.js';
import type { PolicyId } from './common.js';

// ============================================================================
// EXECUTION PHASE
// ============================================================================

/**
 * Current phase of simulation execution.
 */
export type ExecutionPhase =
  | 'initializing'
  | 'configuring'
  | 'validating'
  | 'setup'
  | 'executing'
  | 'paused'
  | 'teardown'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ============================================================================
// SCENARIO STATE
// ============================================================================

/**
 * State of a completed step.
 */
export interface CompletedStep {
  readonly stepId: StepId;
  readonly status: 'success' | 'failure' | 'skipped';
  readonly completedAt: ISOTimestamp;
  readonly durationMs: number;
  readonly output?: unknown;
}

/**
 * State of an active step.
 */
export interface ActiveStep {
  readonly stepId: StepId;
  readonly startedAt: ISOTimestamp;
  readonly progress?: number;
}

/**
 * State of scenario execution.
 */
export interface ScenarioState {
  /** Reference to the scenario being executed */
  readonly scenarioId: ScenarioId;
  /** Steps that have completed */
  readonly completedSteps: ReadonlyArray<CompletedStep>;
  /** Steps currently executing */
  readonly activeSteps: ReadonlyArray<ActiveStep>;
  /** Steps waiting to execute */
  readonly pendingSteps: ReadonlyArray<StepId>;
  /** Results of completed steps (keyed by step ID) */
  readonly stepResults: Readonly<Record<string, unknown>>;
  /** Current branch state for conditional execution */
  readonly branchState: BranchState;
  /** Loop iteration state */
  readonly loopState?: LoopState;
}

/**
 * State of conditional branching.
 */
export interface BranchState {
  /** Currently active branches */
  readonly activeBranches: ReadonlyArray<string>;
  /** Branch decisions made */
  readonly decisions: Readonly<Record<string, boolean>>;
}

/**
 * State of loop execution.
 */
export interface LoopState {
  readonly loopId: string;
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly itemVariable?: string;
  readonly currentItem?: unknown;
}

// ============================================================================
// ENTITY STATE
// ============================================================================

/**
 * State of a simulated agent.
 */
export interface SimulatedAgent {
  readonly agentId: AgentId;
  readonly type: string;
  readonly name?: string;
  readonly state: 'active' | 'idle' | 'busy' | 'error';
  readonly capabilities: ReadonlyArray<string>;
  readonly lastAction?: ISOTimestamp;
  readonly actionHistory: ReadonlyArray<AgentAction>;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * An action performed by an agent.
 */
export interface AgentAction {
  readonly actionId: string;
  readonly type: string;
  readonly timestamp: ISOTimestamp;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly durationMs: number;
}

/**
 * State of a simulated resource.
 */
export interface SimulatedResource {
  readonly resourceId: ResourceId;
  readonly type: string;
  readonly name?: string;
  readonly status: 'available' | 'in_use' | 'reserved' | 'unavailable';
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly usedBy?: AgentId;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

/**
 * A relationship between entities.
 */
export interface EntityRelationship {
  readonly relationshipId: string;
  readonly type: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * Reference to an artifact.
 */
export interface ArtifactReference {
  readonly artifactId: ArtifactId;
  readonly type: string;
  readonly location: string;
  readonly createdAt: ISOTimestamp;
}

/**
 * Registry of all entities in the simulation.
 */
export interface EntityRegistry {
  readonly agents: Readonly<Record<string, SimulatedAgent>>;
  readonly resources: Readonly<Record<string, SimulatedResource>>;
  readonly artifacts: Readonly<Record<string, ArtifactReference>>;
  readonly relationships: ReadonlyArray<EntityRelationship>;
}

// ============================================================================
// POLICY STATE
// ============================================================================

/**
 * Record of an applied policy.
 */
export interface AppliedPolicy {
  readonly policyId: PolicyId;
  readonly version: string;
  readonly loadedAt: ISOTimestamp;
}

/**
 * Record of a policy violation.
 */
export interface PolicyViolationRecord {
  readonly policyId: PolicyId;
  readonly ruleId: string;
  readonly timestamp: ISOTimestamp;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly description: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * Record of a policy override.
 */
export interface PolicyOverride {
  readonly policyId: PolicyId;
  readonly ruleId?: string;
  readonly overrideType: 'disable' | 'change_enforcement' | 'modify_decision';
  readonly reason: string;
  readonly approvedBy?: string;
  readonly expiresAt?: ISOTimestamp;
}

/**
 * State of policy evaluation.
 */
export interface PolicyState {
  /** Policies currently applied */
  readonly appliedPolicies: ReadonlyArray<AppliedPolicy>;
  /** Violations detected */
  readonly violations: ReadonlyArray<PolicyViolationRecord>;
  /** Active overrides */
  readonly overrides: ReadonlyArray<PolicyOverride>;
  /** History of policy decisions */
  readonly decisionHistory: ReadonlyArray<{
    readonly policyId: PolicyId;
    readonly timestamp: ISOTimestamp;
    readonly decision: PolicyDecision;
    readonly stepId?: StepId;
  }>;
}

// ============================================================================
// ENVIRONMENT STATE
// ============================================================================

/**
 * Configuration for a mock service.
 */
export interface MockConfiguration {
  readonly mockId: string;
  readonly service: string;
  readonly behavior: 'record' | 'replay' | 'passthrough' | 'error';
  readonly latencyMs?: number;
  readonly errorRate?: number;
}

/**
 * State of an injected data set.
 */
export interface DataInjection {
  readonly injectionId: string;
  readonly source: string;
  readonly entityType: string;
  readonly recordCount: number;
  readonly injectedAt: ISOTimestamp;
  readonly dataHash: ContentHash;
}

/**
 * State of the simulated clock.
 */
export interface SimulatedClockState {
  readonly currentTime: ISOTimestamp;
  readonly mode: 'controlled' | 'accelerated' | 'real';
  readonly accelerationFactor?: number;
  readonly stepDurationMs?: number;
}

/**
 * State of the simulation environment.
 */
export interface EnvironmentState {
  /** Configured mocks */
  readonly mocks: ReadonlyArray<MockConfiguration>;
  /** Data injections */
  readonly injections: ReadonlyArray<DataInjection>;
  /** Simulated clock state */
  readonly clock: SimulatedClockState;
  /** Feature flags */
  readonly featureFlags: Readonly<Record<string, boolean>>;
  /** Environment variables */
  readonly variables: Readonly<Record<string, string>>;
}

// ============================================================================
// STATE METRICS
// ============================================================================

/**
 * Metrics about state operations.
 */
export interface StateMetrics {
  /** Total number of steps executed */
  readonly stepCount: number;
  /** Total number of policy evaluations */
  readonly policyEvaluationCount: number;
  /** Total number of state transitions */
  readonly stateTransitionCount: number;
  /** Total number of snapshots created */
  readonly snapshotCount: number;
  /** Total number of events recorded */
  readonly eventCount: number;
  /** Current memory usage estimate */
  readonly memoryUsageBytes?: number;
}

// ============================================================================
// PENDING OPERATIONS
// ============================================================================

/**
 * A pending operation in the state.
 */
export interface PendingOperation {
  readonly operationId: string;
  readonly type: string;
  readonly startedAt: ISOTimestamp;
  readonly timeoutAt?: ISOTimestamp;
  readonly context?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SIMULATION STATE
// ============================================================================

/**
 * Complete simulation state.
 * This is the central data structure that tracks all simulation progress.
 */
export interface SimulationState {
  /** State version for event sourcing */
  readonly version: StateVersion;
  /** When this state was created */
  readonly timestamp: ISOTimestamp;
  /** Current simulated time */
  readonly simulatedTime: ISOTimestamp;
  /** Current execution phase */
  readonly phase: ExecutionPhase;
  /** Scenario execution state */
  readonly scenarioState: ScenarioState;
  /** Entity registry */
  readonly entities: EntityRegistry;
  /** Policy evaluation state */
  readonly policyState: PolicyState;
  /** Environment state */
  readonly environment: EnvironmentState;
  /** State metrics */
  readonly metrics: StateMetrics;
  /** Pending operations */
  readonly pendingOperations: ReadonlyArray<PendingOperation>;
}

// ============================================================================
// STATE CHANGES
// ============================================================================

/**
 * Types of state changes.
 */
export type StateChangeType = 'set' | 'append' | 'remove' | 'increment' | 'merge';

/**
 * A single state change to apply.
 */
export interface StateChange {
  /** Type of change */
  readonly type: StateChangeType;
  /** Path to the value (dot notation) */
  readonly path: string;
  /** New value (for set, append, merge) */
  readonly value?: unknown;
  /** Key to remove (for remove) */
  readonly key?: string;
  /** Amount to increment (for increment) */
  readonly delta?: number;
  /** Entity type affected */
  readonly entityType?: string;
  /** Entity ID affected */
  readonly entityId?: string;
  /** What triggered this change */
  readonly trigger: {
    readonly type: 'step' | 'policy' | 'system' | 'recovery';
    readonly id?: string;
  };
}

// ============================================================================
// STATE SNAPSHOT
// ============================================================================

/**
 * A snapshot of simulation state.
 */
export interface StateSnapshot {
  /** Snapshot identifier */
  readonly snapshotId: SnapshotId;
  /** Simulation this snapshot belongs to */
  readonly simulationId: SimulationId;
  /** State version at snapshot */
  readonly version: StateVersion;
  /** Label for this snapshot */
  readonly label: string;
  /** When snapshot was created */
  readonly createdAt: ISOTimestamp;
  /** Content hash for integrity */
  readonly contentHash: ContentHash;
  /** Compressed state data */
  readonly compressedData: string;
  /** Size in bytes */
  readonly sizeBytes: number;
}

// ============================================================================
// STATE DIFF
// ============================================================================

/**
 * Difference between two states.
 */
export interface StateDiff {
  /** From version */
  readonly fromVersion: StateVersion;
  /** To version */
  readonly toVersion: StateVersion;
  /** List of changes */
  readonly changes: ReadonlyArray<{
    readonly path: string;
    readonly type: 'added' | 'modified' | 'removed';
    readonly oldValue?: unknown;
    readonly newValue?: unknown;
  }>;
  /** Summary statistics */
  readonly summary: {
    readonly added: number;
    readonly modified: number;
    readonly removed: number;
  };
}

// ============================================================================
// STATE QUERY
// ============================================================================

/**
 * Query to retrieve data from state.
 */
export interface StateQuery {
  /** Path to query (supports dot notation and array indexing) */
  readonly path: string;
  /** Filter expression (optional) */
  readonly filter?: {
    readonly expression: string;
    readonly values?: Readonly<Record<string, unknown>>;
  };
  /** Fields to project (optional) */
  readonly projection?: ReadonlyArray<string>;
}

/**
 * Result of a state query.
 */
export interface StateQueryResult {
  readonly found: boolean;
  readonly value?: unknown;
  readonly path: string;
}

// ============================================================================
// INITIAL STATE FACTORY
// ============================================================================

/**
 * Creates an initial empty simulation state.
 */
export function createInitialState(
  simulationId: SimulationId,
  scenarioId: ScenarioId,
  simulatedStartTime: ISOTimestamp
): SimulationState {
  return {
    version: 0 as StateVersion,
    timestamp: new Date().toISOString() as ISOTimestamp,
    simulatedTime: simulatedStartTime,
    phase: 'initializing',
    scenarioState: {
      scenarioId,
      completedSteps: [],
      activeSteps: [],
      pendingSteps: [],
      stepResults: {},
      branchState: {
        activeBranches: [],
        decisions: {},
      },
    },
    entities: {
      agents: {},
      resources: {},
      artifacts: {},
      relationships: [],
    },
    policyState: {
      appliedPolicies: [],
      violations: [],
      overrides: [],
      decisionHistory: [],
    },
    environment: {
      mocks: [],
      injections: [],
      clock: {
        currentTime: simulatedStartTime,
        mode: 'controlled',
      },
      featureFlags: {},
      variables: {},
    },
    metrics: {
      stepCount: 0,
      policyEvaluationCount: 0,
      stateTransitionCount: 0,
      snapshotCount: 0,
      eventCount: 0,
    },
    pendingOperations: [],
  };
}
