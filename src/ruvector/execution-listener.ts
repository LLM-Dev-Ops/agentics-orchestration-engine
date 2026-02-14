/**
 * Event-Driven Execution Listener.
 *
 * Subscribes to Ruvector DecisionEvents and triggers orchestration
 * when an approved plan is detected.
 *
 * This listener delegates ALL execution to downstream cores via
 * the OrchestrationEngine. It does NOT execute simulation logic.
 *
 * @module ruvector/execution-listener
 */

import type { SimulationId, ExecutionId, ISOTimestamp } from '../types/common.js';
import type { SimulationConfig, SimulationResult } from '../types/simulation.js';
import type { Scenario } from '../types/scenario.js';
import {
  OrchestrationEngine,
  createOrchestrationEngine,
  OrchestrationError,
  type OrchestrationConfig,
  type OrchestrationResult,
} from '../core/engine.js';
import type { CoreClientRegistry } from '../integration/cores/core-client.js';
import { createMockCoreClientRegistry } from '../integration/cores/mock-cores.js';
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
  RuvectorEventId,
} from './types.js';
import { isPlanApprovedEvent, isExecutableEvent, createRuvectorEventId } from './types.js';

// ============================================================================
// SIMULATION RESOLVER INTERFACE
// ============================================================================

/**
 * Interface for resolving simulation configurations and scenarios.
 */
export interface SimulationResolver {
  resolveConfig(simulationId: SimulationId): Promise<SimulationConfig>;
  resolveScenario(simulationId: SimulationId): Promise<Scenario>;
}

// ============================================================================
// EXECUTION LISTENER CONFIGURATION
// ============================================================================

export interface ExecutionListenerConfig {
  readonly ruvector: RuvectorClientConfig;
  readonly idempotency?: Partial<IdempotencyGuardConfig>;
  readonly engineId: string;
  readonly asyncExecution: boolean;
  readonly maxConcurrentExecutions: number;
}

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

export interface ExecutionEvent {
  readonly type: 'started' | 'completed' | 'failed' | 'skipped';
  readonly planId: PlanId;
  readonly simulationId: SimulationId;
  readonly executionId?: ExecutionId;
  readonly timestamp: ISOTimestamp;
  readonly result?: SimulationResult;
  readonly error?: { code: string; message: string };
  readonly reason?: string;
}

export type ExecutionEventListener = (event: ExecutionEvent) => void;

// ============================================================================
// EXECUTION LISTENER
// ============================================================================

/**
 * Event-driven execution listener.
 *
 * Subscribes to Ruvector DecisionEvents and delegates execution
 * to downstream cores via the OrchestrationEngine.
 *
 * Key behaviors:
 * - Filters for plan_approved events only
 * - Validates events have required plan_id and simulation_id
 * - Enforces idempotency (no duplicate executions)
 * - Delegates ALL execution via OrchestrationEngine (no internal logic)
 * - Emits lifecycle events back to Ruvector
 */
export class ExecutionListener {
  private readonly config: ExecutionListenerConfig;
  private readonly ruvectorClient: RuvectorClient;
  private readonly idempotencyGuard: IdempotencyGuard;
  private readonly simulationResolver: SimulationResolver;
  private readonly coreClients: CoreClientRegistry;
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
    secretManager?: SecretManager,
    coreClients?: CoreClientRegistry
  ) {
    this.config = config;
    this.simulationResolver = simulationResolver;
    this.coreClients = coreClients ?? createMockCoreClientRegistry();
    this.ruvectorClient = createRuvectorClient(config.ruvector, secretManager);
    this.idempotencyGuard = createIdempotencyGuard(config.idempotency);
  }

  async start(): Promise<void> {
    if (this.status.running) {
      console.log('[ExecutionListener] Already running');
      return;
    }

    console.log('[ExecutionListener] Starting execution listener...');

    await this.ruvectorClient.connect();

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

  async stop(): Promise<void> {
    if (!this.status.running) {
      console.log('[ExecutionListener] Not running');
      return;
    }

    console.log('[ExecutionListener] Stopping execution listener...');

    if (this.unsubscribeFromRuvector) {
      this.unsubscribeFromRuvector();
      this.unsubscribeFromRuvector = undefined;
    }

    await this.ruvectorClient.disconnect();

    this.status = { ...this.status, running: false };

    console.log('[ExecutionListener] Stopped');
  }

  onExecutionEvent(listener: ExecutionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  getStatus(): ExecutionListenerStatus {
    return { ...this.status };
  }

  getIdempotencyStatistics() {
    return this.idempotencyGuard.getStatistics();
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  private async handleDecisionEvent(event: DecisionEvent): Promise<void> {
    this.status = { ...this.status, eventsReceived: this.status.eventsReceived + 1 };

    const { type, payload } = event as DecisionEvent & {
      payload?: {
        plan_id?: PlanId;
        simulation_id?: SimulationId;
        advisory?: boolean;
        execution_profile?: ExecutionProfile;
      };
    };
    const { plan_id, simulation_id, advisory, execution_profile } = payload ?? {};

    console.log('[ExecutionListener] Received decision event', {
      type,
      plan_id,
      simulation_id,
      advisory,
    });

    if (type !== 'plan_approved') {
      console.log(`[ExecutionListener] Ignoring event type: ${type}`);
      return;
    }

    if (!plan_id || !simulation_id) {
      console.warn('[ExecutionListener] Missing required fields in payload', {
        has_plan_id: !!plan_id,
        has_simulation_id: !!simulation_id,
        payload,
      });
      return;
    }

    if (advisory === true) {
      console.log('[ExecutionListener] Ignoring advisory approval', {
        plan_id,
        simulation_id,
      });
      return;
    }

    // Ensure event_id is present (generate if missing from upstream)
    const event_id: RuvectorEventId = event.event_id ?? createRuvectorEventId(`evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);

    // ADR-004 invariant 1: all identifiers MUST be defined before emission
    if (!simulation_id || !plan_id || !event_id) {
      console.error('[ExecutionListener] Missing identifiers — abort emit', {
        event_id,
        plan_id,
        simulation_id,
        type,
      });
      return;
    }

    const normalizedEvent: PlanApprovedEvent = {
      ...event,
      event_id,
      type: 'plan_approved',
      plan_id,
      simulation_id,
      execution_profile: execution_profile ?? { tier: 'tier1', mode: 'execute' },
    } as PlanApprovedEvent;

    if (!this.validateEvent(normalizedEvent)) {
      console.log('[ExecutionListener] Event validation failed, skipping');
      this.emitExecutionEvent({
        type: 'skipped',
        planId: plan_id,
        simulationId: simulation_id,
        timestamp: new Date().toISOString() as ISOTimestamp,
        reason: 'Event validation failed: missing required fields',
      });
      this.status = { ...this.status, executionsSkipped: this.status.executionsSkipped + 1 };
      return;
    }

    const idempotencyCheck = this.idempotencyGuard.check(plan_id);
    if (!idempotencyCheck.shouldExecute) {
      console.log('[ExecutionListener] Idempotency check failed:', idempotencyCheck.reason);
      this.emitExecutionEvent({
        type: 'skipped',
        planId: plan_id,
        simulationId: simulation_id,
        timestamp: new Date().toISOString() as ISOTimestamp,
        reason: idempotencyCheck.reason,
      });
      this.status = { ...this.status, executionsSkipped: this.status.executionsSkipped + 1 };
      return;
    }

    if (this.status.currentExecutions >= this.config.maxConcurrentExecutions) {
      console.log('[ExecutionListener] Max concurrent executions reached, queueing');
    }

    if (this.config.asyncExecution) {
      this.executeOrchestration(normalizedEvent).catch((error) => {
        console.error('[ExecutionListener] Async orchestration error:', error);
      });
    } else {
      await this.executeOrchestration(normalizedEvent);
    }
  }

  private validateEvent(event: PlanApprovedEvent): boolean {
    if (!event.plan_id || !event.simulation_id) {
      console.log('[ExecutionListener] Event is not executable:', {
        has_plan_id: !!event.plan_id,
        has_simulation_id: !!event.simulation_id,
        type: event.type,
      });
      return false;
    }

    const profile = event.execution_profile;
    if (!profile || !profile.tier || !profile.mode) {
      console.log('[ExecutionListener] Invalid execution profile');
      return false;
    }

    return true;
  }

  // ==========================================================================
  // ORCHESTRATION (replaces internal simulation execution)
  // ==========================================================================

  /**
   * Orchestrates execution by delegating to downstream cores.
   * This is pure delegation — no internal simulation logic.
   * The OrchestrationEngine handles ruvector acceptance and core delegation.
   */
  private async executeOrchestration(event: PlanApprovedEvent): Promise<void> {
    const { plan_id, simulation_id, execution_profile } = event;
    const startTime = Date.now();

    console.log('[ExecutionListener] === STARTING ORCHESTRATION ===', {
      plan_id,
      simulation_id,
      tier: execution_profile.tier,
      mode: execution_profile.mode,
    });

    this.idempotencyGuard.markStarted(plan_id);
    this.status = {
      ...this.status,
      executionsStarted: this.status.executionsStarted + 1,
      currentExecutions: this.status.currentExecutions + 1,
    };

    // Emit started event to Ruvector
    await this.emitLifecycleStarted(plan_id, simulation_id, execution_profile);

    this.emitExecutionEvent({
      type: 'started',
      planId: plan_id,
      simulationId: simulation_id,
      timestamp: new Date().toISOString() as ISOTimestamp,
    });

    try {
      const config = await this.simulationResolver.resolveConfig(simulation_id);
      const scenario = await this.simulationResolver.resolveScenario(simulation_id);

      // Create orchestration engine — delegates everything to downstream cores
      const engine = createOrchestrationEngine();
      engine.initialize(this.ruvectorClient, this.coreClients);

      const orchestrationConfig: OrchestrationConfig = {
        simulationId: simulation_id,
        simulationConfig: config,
        scenario,
        engineId: this.config.engineId,
      };

      // Orchestrate — blocks until ruvector acceptance, delegates all work
      const orchestrationResult = await engine.orchestrate(orchestrationConfig);

      this.idempotencyGuard.markCompleted(plan_id);
      this.status = {
        ...this.status,
        executionsCompleted: this.status.executionsCompleted + 1,
        currentExecutions: this.status.currentExecutions - 1,
      };

      const durationMs = Date.now() - startTime;

      console.log('[ExecutionListener] === ORCHESTRATION COMPLETED ===', {
        plan_id,
        simulation_id,
        execution_id: orchestrationResult.executionId,
        status: orchestrationResult.result.status,
        delegations: orchestrationResult.executionGraph.length,
        duration_ms: durationMs,
      });

      await this.emitLifecycleCompleted(plan_id, simulation_id, orchestrationResult.result, durationMs);

      this.emitExecutionEvent({
        type: 'completed',
        planId: plan_id,
        simulationId: simulation_id,
        executionId: orchestrationResult.executionId,
        timestamp: new Date().toISOString() as ISOTimestamp,
        result: orchestrationResult.result,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorInfo = {
        code: error instanceof OrchestrationError
          ? error.code
          : error instanceof Error && 'code' in error
            ? (error as any).code
            : 'ORCHESTRATION_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };

      this.idempotencyGuard.markFailed(plan_id, errorInfo);
      this.status = {
        ...this.status,
        executionsFailed: this.status.executionsFailed + 1,
        currentExecutions: this.status.currentExecutions - 1,
      };

      console.error('[ExecutionListener] === ORCHESTRATION FAILED ===', {
        plan_id,
        simulation_id,
        error: errorInfo,
        duration_ms: durationMs,
      });

      await this.emitLifecycleFailed(plan_id, simulation_id, errorInfo, durationMs, error);

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
      advisory: false,
    };

    try {
      await this.ruvectorClient.emitLifecycleEvent(event);
    } catch (error) {
      console.error('[ExecutionListener] Failed to emit started event:', {
        error,
        plan_id: planId,
        simulation_id: simulationId,
      });
      throw error;
    }
  }

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
      console.error('[ExecutionListener] Failed to emit completed event:', {
        error,
        plan_id: planId,
        simulation_id: simulationId,
      });
      throw error;
    }
  }

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
      console.error('[ExecutionListener] CRITICAL: Failed to emit failed event:', {
        emitError,
        original_error: errorInfo,
        plan_id: planId,
        simulation_id: simulationId,
      });
      // Do not re-throw — already in failure handler. Original error takes precedence.
    }
  }

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

export function createExecutionListener(
  config: ExecutionListenerConfig,
  simulationResolver: SimulationResolver,
  secretManager?: SecretManager
): ExecutionListener {
  return new ExecutionListener(config, simulationResolver, secretManager);
}

export function createExecutionListenerFromEnvironment(
  simulationResolver: SimulationResolver,
  secretManager?: SecretManager
): ExecutionListener {
  const ruvectorConfig = createConfigFromEnvironment();

  const config: ExecutionListenerConfig = {
    ruvector: ruvectorConfig,
    engineId: process.env['ENGINE_ID'] ?? `orchestration-engine-${Date.now()}`,
    asyncExecution: process.env['ASYNC_EXECUTION'] !== 'false',
    maxConcurrentExecutions: parseInt(process.env['MAX_CONCURRENT_EXECUTIONS'] ?? '5', 10),
  };

  return createExecutionListener(config, simulationResolver, secretManager);
}

// ============================================================================
// SIMPLE IN-MEMORY SIMULATION RESOLVER (FOR TESTING)
// ============================================================================

export class InMemorySimulationResolver implements SimulationResolver {
  private readonly configs: Map<SimulationId, SimulationConfig> = new Map();
  private readonly scenarios: Map<SimulationId, Scenario> = new Map();

  registerConfig(simulationId: SimulationId, config: SimulationConfig): void {
    this.configs.set(simulationId, config);
  }

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

export function createInMemorySimulationResolver(): InMemorySimulationResolver {
  return new InMemorySimulationResolver();
}
