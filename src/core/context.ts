/**
 * Execution Context.
 *
 * Provides a unified context for simulation execution, combining
 * lifecycle management, resource tracking, and state management.
 *
 * @module core/context
 */

import type {
  SimulationId,
  ScenarioId,
  ISOTimestamp,
  ResourceLimits,
} from '../types/common.js';
import type { ExecutionPhase, SimulationState } from '../types/state.js';
import type { SimulationConfig } from '../types/simulation.js';
import { LifecycleManager, createLifecycleManager } from './lifecycle.js';
import { ResourceLimiter, createResourceLimiter } from './resources/limiter.js';
import { TimeoutController, createTimeoutController } from './resources/timeout.js';
import { SimulatedClock, createControlledClock } from './determinism/clock.js';
import { DeterministicRandom, createSeededRandom } from './determinism/random.js';
import { IsolationEnforcer, createStrictEnforcer } from './isolation/enforcer.js';
import { TraceCollector, createTraceCollector } from '../trace/collector.js';
import { StateManager, createStateManager } from '../state/manager.js';
import { DataSnapshotManager, createDataSnapshotManager } from '../state/data-snapshot.js';
import { EventStore, createEventStore } from '../state/store.js';

// ============================================================================
// EXECUTION CONTEXT CONFIGURATION
// ============================================================================

/**
 * Configuration for execution context.
 */
export interface ExecutionContextConfig {
  readonly simulationId: SimulationId;
  readonly scenarioId: ScenarioId;
  readonly config: SimulationConfig;
}

// ============================================================================
// EXECUTION CONTEXT CLASS
// ============================================================================

/**
 * Unified execution context for a simulation.
 *
 * Provides access to all core simulation components:
 * - Lifecycle management
 * - Resource limiting
 * - Deterministic time and random
 * - Isolation enforcement
 * - State management
 * - Trace collection
 */
export class ExecutionContext {
  readonly simulationId: SimulationId;
  readonly scenarioId: ScenarioId;
  readonly config: SimulationConfig;

  // Core components
  readonly lifecycle: LifecycleManager;
  readonly resources: ResourceLimiter;
  readonly timeout: TimeoutController;
  readonly clock: SimulatedClock;
  readonly random: DeterministicRandom;
  readonly isolation: IsolationEnforcer;
  readonly trace: TraceCollector;
  readonly state: StateManager;
  readonly dataSnapshots: DataSnapshotManager;
  readonly eventStore: EventStore;

  private readonly startTime: Date;
  private disposed = false;

  constructor(contextConfig: ExecutionContextConfig) {
    this.simulationId = contextConfig.simulationId;
    this.scenarioId = contextConfig.scenarioId;
    this.config = contextConfig.config;
    this.startTime = new Date();

    // Create time provider for deterministic components
    const getTime = () => this.clock.getTime();

    // Initialize clock first (other components depend on it)
    this.clock = createControlledClock(contextConfig.config.timing.simulatedStartTime);

    // Initialize lifecycle
    this.lifecycle = createLifecycleManager(this.simulationId, getTime);

    // Initialize resource management
    this.resources = createResourceLimiter(
      this.simulationId,
      contextConfig.config.resourceLimits,
      undefined,
      getTime
    );
    this.timeout = createTimeoutController(getTime);

    // Initialize deterministic random
    this.random = createSeededRandom(contextConfig.config.metadata.seed ?? Date.now());

    // Initialize isolation enforcer
    this.isolation = createStrictEnforcer(this.simulationId);

    // Initialize trace collection
    this.trace = createTraceCollector(this.simulationId, getTime);

    // Initialize state management
    this.state = createStateManager(
      this.simulationId,
      this.scenarioId,
      contextConfig.config.timing.simulatedStartTime,
      { getTime }
    );

    // Initialize data snapshots
    this.dataSnapshots = createDataSnapshotManager(this.simulationId, getTime);

    // Initialize event store
    this.eventStore = createEventStore(this.simulationId, undefined, getTime);
  }

  // ==========================================================================
  // CONVENIENCE ACCESSORS
  // ==========================================================================

  /**
   * Gets the current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.lifecycle.getPhase();
  }

  /**
   * Gets the current simulation state.
   */
  getState(): Readonly<SimulationState> {
    return this.state.getState();
  }

  /**
   * Gets the current simulated time.
   */
  getTime(): ISOTimestamp {
    return this.clock.getTime();
  }

  /**
   * Gets the elapsed real time since simulation start.
   */
  getElapsedRealTime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Gets the elapsed simulated time since simulation start.
   */
  getElapsedSimulatedTime(): number {
    return this.clock.getElapsedMs();
  }

  /**
   * Checks if the simulation is in a terminal state.
   */
  isTerminal(): boolean {
    return this.lifecycle.isTerminal();
  }

  /**
   * Checks if resources are within limits.
   */
  checkResources(): boolean {
    return this.resources.check().withinLimits;
  }

  // ==========================================================================
  // TIME CONTROL
  // ==========================================================================

  /**
   * Advances simulated time by the specified duration.
   */
  advanceTime(ms: number): void {
    this.clock.advance(ms);
    this.state.updateSimulatedTime(this.clock.getTime());
  }

  /**
   * Advances simulated time to a specific point.
   */
  advanceTimeTo(time: ISOTimestamp): void {
    this.clock.advanceTo(time);
    this.state.updateSimulatedTime(time);
  }

  // ==========================================================================
  // ISOLATION
  // ==========================================================================

  /**
   * Checks network endpoint access.
   */
  checkNetworkAccess(
    protocol: string,
    host: string,
    port: number | null
  ): boolean {
    return this.isolation.checkNetworkEndpoint(protocol, host, port, undefined).allowed;
  }

  /**
   * Verifies production isolation.
   */
  verifyIsolation(): boolean {
    return (
      this.isolation.verifyNoProductionEndpoints() &&
      this.isolation.verifyNoProductionCredentials()
    );
  }

  // ==========================================================================
  // TRACING
  // ==========================================================================

  /**
   * Records a lifecycle event to the trace.
   */
  recordLifecycleEvent(
    eventType: string,
    details: Record<string, unknown>
  ): void {
    this.trace.recordLifecycleEvent(eventType, {
      ...details,
      simulationId: this.simulationId,
      phase: this.getPhase(),
    });
  }

  /**
   * Records an error to the trace.
   */
  recordError(error: Error, context: Record<string, unknown>): void {
    this.trace.recordErrorEvent(error, {
      ...context,
      simulationId: this.simulationId,
      phase: this.getPhase(),
    });
  }

  // ==========================================================================
  // RESOURCE MANAGEMENT
  // ==========================================================================

  /**
   * Executes an operation with timeout.
   */
  async withTimeout<T>(
    operation: () => Promise<T>,
    durationMs: number,
    description?: string
  ): Promise<T> {
    return this.timeout.withSimpleTimeout(operation, durationMs, description);
  }

  /**
   * Executes an operation with concurrency limiting.
   */
  async withConcurrency<T>(operation: () => Promise<T>): Promise<T> {
    return this.resources.withConcurrency(operation);
  }

  // ==========================================================================
  // CONTEXT SUMMARY
  // ==========================================================================

  /**
   * Gets a summary of the current context state.
   */
  getSummary(): ExecutionContextSummary {
    return {
      simulationId: this.simulationId,
      scenarioId: this.scenarioId,
      phase: this.getPhase(),
      simulatedTime: this.getTime(),
      elapsedRealTimeMs: this.getElapsedRealTime(),
      elapsedSimulatedTimeMs: this.getElapsedSimulatedTime(),
      stateVersion: this.state.getVersion(),
      resourceUsage: this.resources.getUsage(),
      traceEventCount: this.trace.getEventCount(),
      isolationBreaches: this.isolation.getBreachLog().length,
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Disposes of the execution context.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.resources.dispose();
    this.timeout.dispose();
  }

  /**
   * Checks if the context has been disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

// ============================================================================
// CONTEXT SUMMARY TYPE
// ============================================================================

/**
 * Summary of execution context state.
 */
export interface ExecutionContextSummary {
  readonly simulationId: SimulationId;
  readonly scenarioId: ScenarioId;
  readonly phase: ExecutionPhase;
  readonly simulatedTime: ISOTimestamp;
  readonly elapsedRealTimeMs: number;
  readonly elapsedSimulatedTimeMs: number;
  readonly stateVersion: number;
  readonly resourceUsage: {
    readonly elapsedTimeMs: number;
    readonly memoryBytes: number;
    readonly concurrency: number;
    readonly snapshots: number;
    readonly traceEvents: number;
  };
  readonly traceEventCount: number;
  readonly isolationBreaches: number;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an execution context.
 */
export function createExecutionContext(
  config: ExecutionContextConfig
): ExecutionContext {
  return new ExecutionContext(config);
}
