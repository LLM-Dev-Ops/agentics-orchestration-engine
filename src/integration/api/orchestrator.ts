/**
 * Orchestrator API Interface.
 *
 * Defines the interface for simulation orchestration operations.
 * This is the primary entry point for external systems to interact
 * with the simulation engine.
 *
 * @module integration/api/orchestrator
 */

import type {
  SimulationId,
  ISOTimestamp,
} from '../../types/common.js';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationStatus,
} from '../../types/simulation.js';
import type { Scenario } from '../../types/scenario.js';
import type { ArtifactManifest } from '../../types/artifact.js';

// ============================================================================
// ORCHESTRATOR REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to create a new simulation.
 */
export interface CreateSimulationRequest {
  /** Simulation configuration */
  readonly config: SimulationConfig;
  /** Whether to start immediately */
  readonly autoStart?: boolean;
  /** Request metadata */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Response from simulation creation.
 */
export interface CreateSimulationResponse {
  /** Created simulation ID */
  readonly simulationId: SimulationId;
  /** Current status */
  readonly status: SimulationStatus;
  /** Creation timestamp */
  readonly createdAt: ISOTimestamp;
}

/**
 * Request to execute a simulation.
 */
export interface ExecuteSimulationRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Scenario to execute */
  readonly scenario: Scenario;
  /** Execution options */
  readonly options?: {
    /** Continue from a checkpoint */
    readonly checkpoint?: string;
    /** Override resource limits */
    readonly resourceLimits?: Partial<import('../../types/common.js').ResourceLimits>;
  };
}

/**
 * Response from simulation execution.
 */
export interface ExecuteSimulationResponse {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Final status */
  readonly status: SimulationStatus;
  /** Execution result */
  readonly result?: SimulationResult;
  /** Generated artifacts */
  readonly artifacts?: ArtifactManifest;
  /** Error information if failed */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * Simulation status query.
 */
export interface GetSimulationStatusRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Include detailed metrics */
  readonly includeMetrics?: boolean;
}

/**
 * Detailed simulation status.
 */
export interface SimulationStatusResponse {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Current status */
  readonly status: SimulationStatus;
  /** Progress percentage (0-100) */
  readonly progress: number;
  /** Current execution phase */
  readonly phase?: string;
  /** Current step being executed */
  readonly currentStep?: string;
  /** Elapsed time in milliseconds */
  readonly elapsedMs: number;
  /** Metrics if requested */
  readonly metrics?: {
    readonly stepsExecuted: number;
    readonly stepsRemaining: number;
    readonly policiesEvaluated: number;
    readonly memoryUsedBytes: number;
  };
}

/**
 * Request to pause a simulation.
 */
export interface PauseSimulationRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Create checkpoint before pausing */
  readonly createCheckpoint?: boolean;
}

/**
 * Request to resume a simulation.
 */
export interface ResumeSimulationRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Checkpoint to resume from */
  readonly checkpoint?: string;
}

/**
 * Request to cancel a simulation.
 */
export interface CancelSimulationRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Cancellation reason */
  readonly reason: string;
  /** Force immediate cancellation */
  readonly force?: boolean;
}

/**
 * List simulations query.
 */
export interface ListSimulationsRequest {
  /** Filter by status */
  readonly status?: SimulationStatus;
  /** Created after this time */
  readonly createdAfter?: ISOTimestamp;
  /** Created before this time */
  readonly createdBefore?: ISOTimestamp;
  /** Maximum results */
  readonly limit?: number;
  /** Pagination offset */
  readonly offset?: number;
}

/**
 * Simulation list response.
 */
export interface ListSimulationsResponse {
  /** Simulations matching query */
  readonly simulations: ReadonlyArray<{
    readonly simulationId: SimulationId;
    readonly status: SimulationStatus;
    readonly createdAt: ISOTimestamp;
    readonly scenarioId?: string;
  }>;
  /** Total count matching query */
  readonly totalCount: number;
  /** Has more results */
  readonly hasMore: boolean;
}

// ============================================================================
// ORCHESTRATOR INTERFACE
// ============================================================================

/**
 * Orchestrator API for simulation management.
 *
 * This interface defines all operations available for managing simulations.
 * Implementations should handle authentication, rate limiting, and error
 * handling appropriately.
 */
export interface OrchestratorAPI {
  /**
   * Creates a new simulation.
   *
   * @param request - Creation request
   * @returns Created simulation information
   */
  createSimulation(request: CreateSimulationRequest): Promise<CreateSimulationResponse>;

  /**
   * Executes a simulation.
   *
   * @param request - Execution request
   * @returns Execution result
   */
  executeSimulation(request: ExecuteSimulationRequest): Promise<ExecuteSimulationResponse>;

  /**
   * Gets simulation status.
   *
   * @param request - Status query
   * @returns Current status
   */
  getStatus(request: GetSimulationStatusRequest): Promise<SimulationStatusResponse>;

  /**
   * Pauses a running simulation.
   *
   * @param request - Pause request
   */
  pauseSimulation(request: PauseSimulationRequest): Promise<void>;

  /**
   * Resumes a paused simulation.
   *
   * @param request - Resume request
   */
  resumeSimulation(request: ResumeSimulationRequest): Promise<void>;

  /**
   * Cancels a simulation.
   *
   * @param request - Cancel request
   */
  cancelSimulation(request: CancelSimulationRequest): Promise<void>;

  /**
   * Lists simulations.
   *
   * @param request - List query
   * @returns Matching simulations
   */
  listSimulations(request: ListSimulationsRequest): Promise<ListSimulationsResponse>;

  /**
   * Gets simulation result.
   *
   * @param simulationId - Simulation ID
   * @returns Simulation result if completed
   */
  getResult(simulationId: SimulationId): Promise<SimulationResult | undefined>;

  /**
   * Gets artifact manifest.
   *
   * @param simulationId - Simulation ID
   * @returns Artifact manifest if available
   */
  getArtifacts(simulationId: SimulationId): Promise<ArtifactManifest | undefined>;
}

// ============================================================================
// ORCHESTRATOR EVENTS
// ============================================================================

/**
 * Events emitted by the orchestrator.
 */
export type OrchestratorEvent =
  | { type: 'simulation_created'; simulationId: SimulationId; timestamp: ISOTimestamp }
  | { type: 'simulation_started'; simulationId: SimulationId; timestamp: ISOTimestamp }
  | { type: 'simulation_progress'; simulationId: SimulationId; progress: number; phase: string; timestamp: ISOTimestamp }
  | { type: 'simulation_paused'; simulationId: SimulationId; timestamp: ISOTimestamp }
  | { type: 'simulation_resumed'; simulationId: SimulationId; timestamp: ISOTimestamp }
  | { type: 'simulation_completed'; simulationId: SimulationId; status: SimulationStatus; timestamp: ISOTimestamp }
  | { type: 'simulation_failed'; simulationId: SimulationId; error: string; timestamp: ISOTimestamp }
  | { type: 'simulation_cancelled'; simulationId: SimulationId; reason: string; timestamp: ISOTimestamp };

/**
 * Listener for orchestrator events.
 */
export type OrchestratorEventListener = (event: OrchestratorEvent) => void;

/**
 * Extended orchestrator with event subscription.
 */
export interface OrchestratorAPIWithEvents extends OrchestratorAPI {
  /**
   * Subscribes to orchestrator events.
   *
   * @param listener - Event listener
   * @returns Unsubscribe function
   */
  subscribe(listener: OrchestratorEventListener): () => void;
}
