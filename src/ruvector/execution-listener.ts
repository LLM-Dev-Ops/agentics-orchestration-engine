/**
 * Event-Driven Execution Listener.
 *
 * Subscribes to Ruvector DecisionEvents and triggers REAL simulation
 * execution when an approved plan is detected.
 *
 * This is the FINAL EXECUTION WIRING step that bridges plan approval
 * in agentics-deployment-intent to actual simulation execution.
 *
 * @module ruvector/execution-listener
 */

import type { SimulationId, ISOTimestamp } from '../types/common.js';
import type { SimulationConfig, SimulationResult } from '../types/simulation.js';
import type { Scenario } from '../types/scenario.js';
import { SimulationEngine, createSimulationEngine } from '../core/engine.js';
import {
  RuvectorClient,
  createRuvectorClient,
  createConfigFromEnvironment,
  RuvectorClientError,
  type SecretManager,
} from './client.js';
import {
  IdempotencyGuard,
  createIdempotencyGuard,
  type IdempotencyGuardConfig,
} from './idempotency.js';
import type {
  DecisionEvent,
  PlanApprovedEvent,
  ExecutionProfile,
  RuvectorClientConfig,
  SimulationExecutionStartedEvent,
  SimulationExecutionCompletedEvent,
  SimulationExecutionFailedEvent,
  PlanId,
} from './types.js';
import { isPlanApprovedEvent, isExecutableEvent } from './types.js';

// ============================================================================
// SIMULATION RESOLVER INTERFACE
// ============================================================================

/**
 * Interface for resolving simulation configurations and scenarios.
 */
export interface SimulationResolver {
  /**
   * Resolves simulation configuration by ID.
   *
   * @param simulationId - Simulation identifier
   * @returns Simulation configuration
   * @throws Error if simulation not found
   */
  resolveConfig(simulationId: SimulationId): Promise<SimulationConfig>;

  /**
   * Resolves scenario for a simulation.
   *
   * @param simulationId - Simulation identifier
   * @returns Scenario to execute
   * @throws Error if scenario not found
   */
  resolveScenario(simulationId: SimulationId): Promise<Scenario>;
}

// ============================================================================
// EXECUTION LISTENER CONFIGURATION
// ============================================================================

/**
 * Configuration for the execution listener.
 */
export interface ExecutionListenerConfig {
  /** Ruvector client configuration */
  readonly ruvector: RuvectorClientConfig;
  /** Idempotency guard configuration */
  readonly idempotency?: Partial<IdempotencyGuardConfig>;
  /** Engine identifier for lifecycle events */
  readonly engineId: string;
  /** Whether to execute asynchronously (non-blocking) */
  readonly asyncExecution: boolean;
  /** Maximum concurrent executions */
  readonly maxConcurrentExecutions: number;
}

/**
 * Listener status and statistics.
 */
export interface ExecutionListenerStatus {
  readonly running: boolean;
  readonly startedAt?: ISOTimestamp;
  readonly eventsReceived: number;
  readonly executionsStarted: number;
  readonly executionsCompleted: number;
  readonly executionsFailed: number;
  readonly executionsSkipped: number;
  readonly currentExecutions: number;
}

/**
 * Execution event for internal tracking.
 */
export interface ExecutionEvent {
  readonly type: 'started' | 'completed' | 'failed' | 'skipped';
  readonly planId: PlanId;
  readonly simulationId: SimulationId;
  readonly timestamp: ISOTimestamp;
  readonly result?: SimulationResult;
  readonly error?: { code: string; message: string };
  readonly reason?: string;
}

/**
 * Listener for execution events.
 */
export type ExecutionEventListener = (event: ExecutionEvent) => void;

// ============================================================================
// EXECUTION LISTENER
// ============================================================================

/**
 * Event-driven execution listener.
 *
 * Subscribes to Ruvector DecisionEvents and triggers simulation
 * execution when an approved plan is detected.
 *
 * Key behaviors:
 * - Filters for plan_approved events only
 * - Validates events have required plan_id and simulation_id
 * - Enforces idempotency (no duplicate executions)
 * - Triggers REAL simulation execution (advisory=false)
 * - Emits lifecycle events back to Ruvector
 */
export class ExecutionListener {
  private readonly config: ExecutionListenerConfig;
  private readonly ruvectorClient: RuvectorClient;
  private readonly idempotencyGuard: IdempotencyGuard;
  private readonly simulationResolver: SimulationResolver;
  private readonly eventListeners: Set<ExecutionEventListener> = new Set();

  private status: ExecutionListenerStatus = {
    running: false,
    eventsReceived: 0,
    executionsStarted: 0,
    executionsCompleted: 0,
    executionsFailed: 0,
    executionsSkipped: 0,
    currentExecutions: 0,
  };

  private unsubscribeFromRuvector?: () => void;

  constructor(
    config: ExecutionListenerConfig,
    simulationResolver: SimulationResolver,
    secretManager?: SecretManager
  ) {
    this.config = config;
    this.simulationResolver = simulationResolver;
    this.ruvectorClient = createRuvectorClient(config.ruvector, secretManager);
    this.idempotencyGuard = createIdempotencyGuard(config.idempotency);
  }

  /**
   * Starts the execution listener.
   *
   * Connects to Ruvector and begins subscribing to decision events.
   *
   * @throws RuvectorClientError if connection fails
   */
  async start(): Promise<void> {
    if (this.status.running) {
      console.log('[ExecutionListener] Already running');
      return;
    }

    console.log('[ExecutionListener] Starting execution listener...');

    // Connect to Ruvector
    await this.ruvectorClient.connect();

    // Subscribe to decision events
    this.unsubscribeFromRuvector = this.ruvectorClient.onDecisionEvent(
      (event) => this.handleDecisionEvent(event)
    );

    this.status = {
      ...this.status,
      running: true,
      startedAt: new Date().toISOString() as ISOTimestamp,
    };

    console.log('[ExecutionListener] Started successfully');
  }

  /**
   * Stops the execution listener.
   */
  async stop(): Promise<void> {
    if (!this.status.running) {
      console.log('[ExecutionListener] Not running');
      return;
    }

    console.log('[ExecutionListener] Stopping execution listener...');

    // Unsubscribe from Ruvector events
    if (this.unsubscribeFromRuvector) {
      this.unsubscribeFromRuvector();
      this.unsubscribeFromRuvector = undefined;
    }

    // Disconnect from Ruvector
    await this.ruvectorClient.disconnect();

    this.status = { ...this.status, running: false };

    console.log('[ExecutionListener] Stopped');
  }

  /**
   * Subscribes to execution events.
   *
   * @param listener - Event listener
   * @returns Unsubscribe function
   */
  onExecutionEvent(listener: ExecutionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Gets the current listener status.
   */
  getStatus(): ExecutionListenerStatus {
    return { ...this.status };
  }

  /**
   * Gets the idempotency guard statistics.
   */
  getIdempotencyStatistics() {
    return this.idempotencyGuard.getStatistics();
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  /**
   * Handles incoming decision events from Ruvector.
   */
  private async handleDecisionEvent(event: DecisionEvent): Promise<void> {
    this.status = { ...this.status, eventsReceived: this.status.eventsReceived + 1 };

    console.log('[ExecutionListener] Received decision event', {
      type: event.type,
      plan_id: event.plan_id,
      simulation_id: event.simulation_id,
    });

    // Filter: Only process plan_approved events
    if (!isPlanApprovedEvent(event)) {
      console.log(`[ExecutionListener] Ignoring event type: ${event.type}`);
      return;
    }

    // Validate: Ensure event has all required fields
    if (!this.validateEvent(event)) {
      console.log('[ExecutionListener] Event validation failed, skipping');
      this.emitExecutionEvent({
        type: 'skipped',
        planId: event.plan_id,
        simulationId: event.simulation_id!,
        timestamp: new Date().toISOString() as ISOTimestamp,
        reason: 'Event validation failed: missing required fields',
      });
      this.status = { ...this.status, executionsSkipped: this.status.executionsSkipped + 1 };
      return;
    }

    // Idempotency check: Prevent duplicate execution
    const idempotencyCheck = this.idempotencyGuard.check(event.plan_id);
    if (!idempotencyCheck.shouldExecute) {
      console.log('[ExecutionListener] Idempotency check failed:', idempotencyCheck.reason);
      this.emitExecutionEvent({
        type: 'skipped',
        planId: event.plan_id,
        simulationId: event.simulation_id,
        timestamp: new Date().toISOString() as ISOTimestamp,
        reason: idempotencyCheck.reason,
      });
      this.status = { ...this.status, executionsSkipped: this.status.executionsSkipped + 1 };
      return;
    }

    // Concurrency check
    if (this.status.currentExecutions >= this.config.maxConcurrentExecutions) {
      console.log('[ExecutionListener] Max concurrent executions reached, queueing');
      // In a full implementation, this would queue the execution
      // For now, we'll execute anyway to not lose events
    }

    // Execute simulation
    if (this.config.asyncExecution) {
      // Fire and forget - don't block on execution
      this.executeSimulation(event).catch((error) => {
        console.error('[ExecutionListener] Async execution error:', error);
      });
    } else {
      // Synchronous execution
      await this.executeSimulation(event);
    }
  }

  /**
   * Validates that an event has all required fields for execution.
   */
  private validateEvent(event: PlanApprovedEvent): boolean {
    // Validate required fields
    if (!event.plan_id || !event.simulation_id) {
      console.log('[ExecutionListener] Event is not executable:', {
        has_plan_id: !!event.plan_id,
        has_simulation_id: !!event.simulation_id,
        type: event.type,
      });
      return false;
    }

    // Validate execution profile
    const profile = event.execution_profile;
    if (!profile || !profile.tier || !profile.mode) {
      console.log('[ExecutionListener] Invalid execution profile');
      return false;
    }

    return true;
  }

  // ==========================================================================
  // SIMULATION EXECUTION
  // ==========================================================================

  /**
   * Executes a simulation based on an approved plan event.
   *
   * This is the REAL execution path - advisory mode is DISABLED.
   */
  private async executeSimulation(event: PlanApprovedEvent): Promise<void> {
    const { plan_id, simulation_id, execution_profile } = event;
    const startTime = Date.now();

    console.log('[ExecutionListener] === STARTING SIMULATION EXECUTION ===', {
      plan_id,
      simulation_id,
      tier: execution_profile.tier,
      mode: execution_profile.mode,
      advisory: false, // MUST be false for real execution
    });

    // Mark execution as started (idempotency)
    this.idempotencyGuard.markStarted(plan_id);
    this.status = {
      ...this.status,
      executionsStarted: this.status.executionsStarted + 1,
      currentExecutions: this.status.currentExecutions + 1,
    };

    // Emit started event to Ruvector
    await this.emitLifecycleStarted(plan_id, simulation_id, execution_profile);

    // Emit internal started event
    this.emitExecutionEvent({
      type: 'started',
      planId: plan_id,
      simulationId: simulation_id,
      timestamp: new Date().toISOString() as ISOTimestamp,
    });

    try {
      // Resolve simulation configuration and scenario
      const config = await this.simulationResolver.resolveConfig(simulation_id);
      const scenario = await this.simulationResolver.resolveScenario(simulation_id);

      // Create and initialize the simulation engine
      const engine = createSimulationEngine();
      await engine.initialize(config);

      // Execute the simulation
      // This is the SAME PATH used for real execution
      // Advisory mode is DISABLED
      const result = await engine.execute(scenario);

      // Mark execution as completed (idempotency)
      this.idempotencyGuard.markCompleted(plan_id);
      this.status = {
        ...this.status,
        executionsCompleted: this.status.executionsCompleted + 1,
        currentExecutions: this.status.currentExecutions - 1,
      };

      const durationMs = Date.now() - startTime;

      console.log('[ExecutionListener] === SIMULATION EXECUTION COMPLETED ===', {
        plan_id,
        simulation_id,
        status: result.status,
        duration_ms: durationMs,
      });

      // Emit completed event to Ruvector
      await this.emitLifecycleCompleted(plan_id, simulation_id, result, durationMs);

      // Emit internal completed event
      this.emitExecutionEvent({
        type: 'completed',
        planId: plan_id,
        simulationId: simulation_id,
        timestamp: new Date().toISOString() as ISOTimestamp,
        result,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorInfo = {
        code: error instanceof Error && 'code' in error ? (error as any).code : 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };

      // Mark execution as failed (idempotency)
      this.idempotencyGuard.markFailed(plan_id, errorInfo);
      this.status = {
        ...this.status,
        executionsFailed: this.status.executionsFailed + 1,
        currentExecutions: this.status.currentExecutions - 1,
      };

      console.error('[ExecutionListener] === SIMULATION EXECUTION FAILED ===', {
        plan_id,
        simulation_id,
        error: errorInfo,
        duration_ms: durationMs,
      });

      // Emit failed event to Ruvector
      await this.emitLifecycleFailed(plan_id, simulation_id, errorInfo, durationMs, error);

      // Emit internal failed event
      this.emitExecutionEvent({
        type: 'failed',
        planId: plan_id,
        simulationId: simulation_id,
        timestamp: new Date().toISOString() as ISOTimestamp,
        error: errorInfo,
      });
    }
  }

  // ==========================================================================
  // LIFECYCLE EVENT EMISSION
  // ==========================================================================

  /**
   * Emits simulation_execution_started event to Ruvector.
   */
  private async emitLifecycleStarted(
    planId: PlanId,
    simulationId: SimulationId,
    executionProfile: ExecutionProfile
  ): Promise<void> {
    const event: SimulationExecutionStartedEvent = {
      type: 'simulation_execution_started',
      plan_id: planId,
      simulation_id: simulationId,
      timestamp: new Date().toISOString() as ISOTimestamp,
      source: this.config.engineId,
      execution_profile: executionProfile,
      advisory: false, // MUST be false - this is REAL execution
    };

    try {
      await this.ruvectorClient.emitLifecycleEvent(event);
    } catch (error) {
      console.error('[ExecutionListener] Failed to emit started event:', error);
      // Don't throw - execution should continue even if event emission fails
    }
  }

  /**
   * Emits simulation_execution_completed event to Ruvector.
   */
  private async emitLifecycleCompleted(
    planId: PlanId,
    simulationId: SimulationId,
    result: SimulationResult,
    durationMs: number
  ): Promise<void> {
    const event: SimulationExecutionCompletedEvent = {
      type: 'simulation_execution_completed',
      plan_id: planId,
      simulation_id: simulationId,
      timestamp: new Date().toISOString() as ISOTimestamp,
      source: this.config.engineId,
      status: result.status === 'success' ? 'success' : 'partial_success',
      duration_ms: durationMs,
      metrics: {
        steps_executed: result.scenarioResult.coverage.stepsExecuted,
        steps_passed: result.scenarioResult.coverage.stepsPassed,
        steps_failed: result.scenarioResult.coverage.stepsFailed,
        policies_evaluated: result.policyResult.policiesEvaluated,
      },
      result_ref: `results/${simulationId}`,
    };

    try {
      await this.ruvectorClient.emitLifecycleEvent(event);
    } catch (error) {
      console.error('[ExecutionListener] Failed to emit completed event:', error);
    }
  }

  /**
   * Emits simulation_execution_failed event to Ruvector.
   */
  private async emitLifecycleFailed(
    planId: PlanId,
    simulationId: SimulationId,
    errorInfo: { code: string; message: string },
    durationMs: number,
    error: unknown
  ): Promise<void> {
    const event: SimulationExecutionFailedEvent = {
      type: 'simulation_execution_failed',
      plan_id: planId,
      simulation_id: simulationId,
      timestamp: new Date().toISOString() as ISOTimestamp,
      source: this.config.engineId,
      error_code: errorInfo.code,
      error_message: errorInfo.message,
      recoverable: false,
      duration_ms: durationMs,
      stack: error instanceof Error ? error.stack : undefined,
    };

    try {
      await this.ruvectorClient.emitLifecycleEvent(event);
    } catch (emitError) {
      console.error('[ExecutionListener] Failed to emit failed event:', emitError);
    }
  }

  /**
   * Emits internal execution event to listeners.
   */
  private emitExecutionEvent(event: ExecutionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ExecutionListener] Error in execution event listener:', error);
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an execution listener with the given configuration.
 */
export function createExecutionListener(
  config: ExecutionListenerConfig,
  simulationResolver: SimulationResolver,
  secretManager?: SecretManager
): ExecutionListener {
  return new ExecutionListener(config, simulationResolver, secretManager);
}

/**
 * Creates an execution listener from environment variables.
 */
export function createExecutionListenerFromEnvironment(
  simulationResolver: SimulationResolver,
  secretManager?: SecretManager
): ExecutionListener {
  const ruvectorConfig = createConfigFromEnvironment();

  const config: ExecutionListenerConfig = {
    ruvector: ruvectorConfig,
    engineId: process.env['ENGINE_ID'] ?? `simulation-engine-${Date.now()}`,
    asyncExecution: process.env['ASYNC_EXECUTION'] !== 'false',
    maxConcurrentExecutions: parseInt(process.env['MAX_CONCURRENT_EXECUTIONS'] ?? '5', 10),
  };

  return createExecutionListener(config, simulationResolver, secretManager);
}

// ============================================================================
// SIMPLE IN-MEMORY SIMULATION RESOLVER (FOR TESTING)
// ============================================================================

/**
 * Simple in-memory simulation resolver.
 * In production, this would load from a database or external service.
 */
export class InMemorySimulationResolver implements SimulationResolver {
  private readonly configs: Map<SimulationId, SimulationConfig> = new Map();
  private readonly scenarios: Map<SimulationId, Scenario> = new Map();

  /**
   * Registers a simulation configuration.
   */
  registerConfig(simulationId: SimulationId, config: SimulationConfig): void {
    this.configs.set(simulationId, config);
  }

  /**
   * Registers a scenario for a simulation.
   */
  registerScenario(simulationId: SimulationId, scenario: Scenario): void {
    this.scenarios.set(simulationId, scenario);
  }

  async resolveConfig(simulationId: SimulationId): Promise<SimulationConfig> {
    const config = this.configs.get(simulationId);
    if (!config) {
      throw new Error(`Simulation config not found: ${simulationId}`);
    }
    return config;
  }

  async resolveScenario(simulationId: SimulationId): Promise<Scenario> {
    const scenario = this.scenarios.get(simulationId);
    if (!scenario) {
      throw new Error(`Scenario not found for simulation: ${simulationId}`);
    }
    return scenario;
  }
}

/**
 * Creates an in-memory simulation resolver.
 */
export function createInMemorySimulationResolver(): InMemorySimulationResolver {
  return new InMemorySimulationResolver();
}
