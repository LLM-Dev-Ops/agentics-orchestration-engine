/**
 * Simulation configuration and result types.
 *
 * Re-exports canonical types from @agentics/contracts.
 * Local-only types (SimulationHandle, SimulationCheckpoint) stay here.
 *
 * @module types/simulation
 */

// Contract types
export type {
  SimulationStatus,
  SimulationOutcome,
  ScenarioReference,
  PolicyReference,
  DataSourceConfig,
  ArtifactConfig,
  ObservabilityConfig,
  SimulationMetadata,
  SimulationConfig,
  ExecutionTiming,
  ScenarioResult,
  StepResult,
  ExpectationResult,
  PolicyResult,
  PolicyViolation,
  IndividualPolicyResult,
  ExecutionMetrics,
  ResultMetadata,
  TraceReference,
  SimulationResult,
} from '@agentics/contracts';

export {
  DEFAULT_ARTIFACT_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
} from '@agentics/contracts';

// ============================================================================
// LOCAL-ONLY TYPES (not part of cross-service contracts)
// ============================================================================

import type {
  SimulationId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
  SimulationStatus,
  SimulationConfig,
} from '@agentics/contracts';

/**
 * Handle returned when a simulation is started.
 * Used for tracking and controlling the simulation.
 */
export interface SimulationHandle {
  readonly simulationId: SimulationId;
  readonly status: SimulationStatus;
  readonly estimatedCompletionTime?: ISOTimestamp;
  readonly queuePosition?: number;
  readonly resultLocation?: string;
}

/**
 * A checkpoint for pausing and resuming simulations.
 */
export interface SimulationCheckpoint {
  readonly checkpointId: string;
  readonly simulationId: SimulationId;
  readonly stateVersion: StateVersion;
  readonly createdAt: ISOTimestamp;
  readonly config: SimulationConfig;
  readonly scenarioProgress: {
    readonly currentStepIndex: number;
    readonly completedSteps: ReadonlyArray<string>;
    readonly pendingSteps: ReadonlyArray<string>;
  };
  readonly contentHash: ContentHash;
}
