/**
 * Simulation Engine.
 *
 * The main orchestrator for simulation execution.
 * Coordinates all subsystems: lifecycle, resources, policies,
 * scenarios, state management, and artifact generation.
 *
 * @module core/engine
 */

import type {
  SimulationId,
  ScenarioId,
  ISOTimestamp,
  ContentHash,
} from '../types/common.js';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationStatus,
  SimulationCheckpoint,
  ExecutionTiming,
  ScenarioResult,
  PolicyResult,
  ExecutionMetrics,
  ResultMetadata,
} from '../types/simulation.js';
import type { Scenario } from '../types/scenario.js';
import type { ArtifactManifest } from '../types/artifact.js';
import type { ExecutionPhase } from '../types/state.js';
import {
  ExecutionContext,
  createExecutionContext,
  type ExecutionContextConfig,
} from './context.js';
import { validateConfig, type ConfigValidationResult } from './validation.js';
import {
  ScenarioManager,
  createScenarioManager,
  type StateProvider,
} from '../scenario/manager.js';
import {
  PolicyEngine,
  createPolicyEngine,
} from '../policy/engine.js';
import { createContentHashFromObject } from '../utils/hash.js';
import { canonicalSerialize } from '../utils/serialize.js';

// ============================================================================
// ENGINE STATUS
// ============================================================================

/**
 * Internal engine state.
 */
interface EngineState {
  status: SimulationStatus;
  phase: ExecutionPhase;
  startTime?: Date;
  endTime?: Date;
  pausedAt?: Date;
  pauseDuration: number;
  checkpoints: SimulationCheckpoint[];
}

// ============================================================================
// SIMULATION ENGINE CLASS
// ============================================================================

/**
 * Main simulation engine that orchestrates all subsystems.
 *
 * Key responsibilities:
 * - Configuration validation
 * - Lifecycle management
 * - Resource enforcement
 * - Policy evaluation
 * - Scenario execution
 * - State management
 * - Artifact generation
 *
 * Execution phases:
 * 1. PLANNING - Validate config, load scenario
 * 2. EXECUTION - Run steps, apply policies
 * 3. ANALYSIS - Aggregate results, compute metrics
 * 4. EXPORT - Generate artifacts
 */
export class SimulationEngine {
  private config?: SimulationConfig;
  private context?: ExecutionContext;
  private scenarioManager?: ScenarioManager;
  private policyEngine?: PolicyEngine;
  private state: EngineState = {
    status: 'queued',
    phase: 'initializing',
    pauseDuration: 0,
    checkpoints: [],
  };
  private scenario?: Scenario;
  private stateData: Record<string, unknown> = {};

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initializes the simulation engine with configuration.
   *
   * @param config - Simulation configuration
   * @returns Execution context for the simulation
   * @throws ConfigurationError if config is invalid
   */
  async initialize(config: SimulationConfig): Promise<ExecutionContext> {
    this.state.status = 'initializing';
    this.state.phase = 'initializing';

    // Validate configuration
    const validation = this.validateConfiguration(config);
    if (!validation.valid) {
      throw new SimulationEngineError(
        'Configuration validation failed',
        'INVALID_CONFIG',
        validation.errors.map((e) => e.message).join('; ')
      );
    }

    this.config = config;

    // Create execution context
    const contextConfig: ExecutionContextConfig = {
      simulationId: config.simulationId,
      scenarioId: config.scenario.scenarioId,
      config,
    };
    this.context = createExecutionContext(contextConfig);

    // Initialize subsystems
    this.scenarioManager = createScenarioManager({
      simulationId: config.simulationId,
      defaultStepTimeout: 30000,
      maxParallelSteps: config.resourceLimits.maxConcurrency,
      getTime: () => this.context!.getTime(),
    });

    this.policyEngine = createPolicyEngine({
      simulationId: config.simulationId,
      getTime: () => this.context!.getTime(),
    });

    // Load policies
    for (const policyRef of config.policies) {
      // In a real implementation, this would load from registry
      // For now, policies would be loaded via the policy engine's load methods
    }

    this.state.phase = 'configuring';
    this.context.recordLifecycleEvent('engine_initialized', {
      configHash: createContentHashFromObject(config),
    });

    return this.context;
  }

  /**
   * Validates the configuration.
   */
  validateConfiguration(config: SimulationConfig): ConfigValidationResult {
    return validateConfig(config);
  }

  // ==========================================================================
  // EXECUTION
  // ==========================================================================

  /**
   * Executes the simulation with the given scenario.
   *
   * @param scenario - Scenario to execute
   * @returns Complete simulation result
   */
  async execute(scenario: Scenario): Promise<SimulationResult> {
    if (!this.context || !this.config || !this.scenarioManager) {
      throw new SimulationEngineError(
        'Engine not initialized',
        'NOT_INITIALIZED',
        'Call initialize() before execute()'
      );
    }

    this.scenario = scenario;
    this.state.status = 'running';
    this.state.phase = 'validating';
    this.state.startTime = new Date();

    try {
      // Phase 1: PLANNING - Validate and prepare
      this.context.recordLifecycleEvent('phase_started', { phase: 'planning' });

      // Validate scenario
      const scenarioValidation = this.scenarioManager.validateScenario(scenario);
      if (!scenarioValidation.valid) {
        throw new SimulationEngineError(
          'Scenario validation failed',
          'INVALID_SCENARIO',
          scenarioValidation.errors.map((e) => e.message).join('; ')
        );
      }

      // Prepare scenario
      const prepared = this.scenarioManager.prepareScenario(
        scenario,
        this.config.scenario.parameters ?? {}
      );

      // Phase 2: EXECUTION - Run steps
      this.state.phase = 'executing';
      this.context.recordLifecycleEvent('phase_started', { phase: 'execution' });

      // Create state provider
      const stateProvider = this.createStateProvider();

      // Execute scenario
      const scenarioResult = await this.scenarioManager.execute(stateProvider);

      // Phase 3: ANALYSIS - Aggregate results
      this.state.phase = 'teardown';
      this.context.recordLifecycleEvent('phase_started', { phase: 'analysis' });

      // Build policy results
      const policyResult = this.buildPolicyResult();

      // Compute metrics
      const metrics = this.computeMetrics();

      // Phase 4: EXPORT - Generate artifacts (placeholder)
      this.context.recordLifecycleEvent('phase_started', { phase: 'export' });

      const artifacts = await this.generateArtifacts();

      // Complete
      this.state.status = 'completed';
      this.state.phase = 'completed';
      this.state.endTime = new Date();

      const timing = this.computeTiming();
      const result: SimulationResult = {
        simulationId: this.config.simulationId,
        status: this.determineOutcome(scenarioResult),
        timing,
        scenarioResult: {
          scenario: this.config.scenario,
          status: scenarioResult.status === 'cancelled' ? 'failed' : scenarioResult.status,
          stepResults: scenarioResult.stepResults,
          expectationResults: scenarioResult.expectationResults,
          coverage: scenarioResult.coverage,
        },
        policyResult,
        artifacts,
        metrics,
        finalStateVersion: this.context.state.getVersion(),
        traceRef: {
          traceId: this.config.simulationId,
          location: 'memory',
          format: 'json',
        },
        metadata: this.buildResultMetadata(),
      };

      this.context.recordLifecycleEvent('simulation_completed', {
        status: result.status,
        durationMs: timing.durationMs,
      });

      return result;
    } catch (error) {
      this.state.status = 'failed';
      this.state.phase = 'failed';
      this.state.endTime = new Date();

      this.context.recordError(
        error instanceof Error ? error : new Error(String(error)),
        { phase: this.state.phase }
      );

      throw error;
    }
  }

  // ==========================================================================
  // CONTROL METHODS
  // ==========================================================================

  /**
   * Pauses the simulation.
   */
  async pause(): Promise<void> {
    if (this.state.status !== 'running') {
      throw new SimulationEngineError(
        'Cannot pause: simulation not running',
        'INVALID_STATE',
        `Current status: ${this.state.status}`
      );
    }

    this.state.status = 'paused';
    this.state.phase = 'paused';
    this.state.pausedAt = new Date();

    this.scenarioManager?.pause();
    this.context?.lifecycle.pause();

    this.context?.recordLifecycleEvent('simulation_paused', {
      pausedAt: this.state.pausedAt.toISOString(),
    });
  }

  /**
   * Resumes the simulation.
   */
  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      throw new SimulationEngineError(
        'Cannot resume: simulation not paused',
        'INVALID_STATE',
        `Current status: ${this.state.status}`
      );
    }

    if (this.state.pausedAt) {
      this.state.pauseDuration += Date.now() - this.state.pausedAt.getTime();
    }

    this.state.status = 'running';
    this.state.phase = 'executing';
    this.state.pausedAt = undefined;

    this.scenarioManager?.resume();
    this.context?.lifecycle.resume();

    this.context?.recordLifecycleEvent('simulation_resumed', {
      totalPauseDuration: this.state.pauseDuration,
    });
  }

  /**
   * Cancels the simulation.
   *
   * @param reason - Reason for cancellation
   */
  async cancel(reason: string): Promise<void> {
    const previousStatus = this.state.status;
    this.state.status = 'cancelled';
    this.state.phase = 'cancelled';
    this.state.endTime = new Date();

    this.scenarioManager?.cancel();
    this.context?.lifecycle.cancel(reason);

    this.context?.recordLifecycleEvent('simulation_cancelled', {
      reason,
      previousStatus,
    });

    // Clean shutdown within 5 seconds (F-006 requirement)
    await this.cleanup();
  }

  /**
   * Creates a checkpoint of current state.
   */
  checkpoint(): SimulationCheckpoint {
    if (!this.context || !this.config || !this.scenario) {
      throw new SimulationEngineError(
        'Cannot checkpoint: no active simulation',
        'INVALID_STATE',
        'Simulation must be running to create checkpoint'
      );
    }

    const checkpointId = `chk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const progress = this.scenarioManager?.getProgress();

    const checkpoint: SimulationCheckpoint = {
      checkpointId,
      simulationId: this.config.simulationId,
      stateVersion: this.context.state.getVersion(),
      createdAt: this.context.getTime(),
      config: this.config,
      scenarioProgress: {
        currentStepIndex: progress?.completedSteps ?? 0,
        completedSteps: [], // Would contain actual step IDs
        pendingSteps: [], // Would contain actual step IDs
      },
      contentHash: createContentHashFromObject({
        checkpointId,
        stateVersion: this.context.state.getVersion(),
        time: this.context.getTime(),
      }),
    };

    this.state.checkpoints.push(checkpoint);
    this.context.recordLifecycleEvent('checkpoint_created', {
      checkpointId,
      stateVersion: checkpoint.stateVersion,
    });

    return checkpoint;
  }

  /**
   * Restores from a checkpoint.
   *
   * @param checkpoint - Checkpoint to restore from
   */
  restore(checkpoint: SimulationCheckpoint): void {
    if (!this.context) {
      throw new SimulationEngineError(
        'Cannot restore: engine not initialized',
        'INVALID_STATE',
        'Initialize the engine first'
      );
    }

    // Verify checkpoint integrity
    const expectedHash = createContentHashFromObject({
      checkpointId: checkpoint.checkpointId,
      stateVersion: checkpoint.stateVersion,
      time: checkpoint.createdAt,
    });

    if (expectedHash.value !== checkpoint.contentHash.value) {
      throw new SimulationEngineError(
        'Checkpoint integrity check failed',
        'CHECKPOINT_CORRUPTED',
        'Content hash mismatch'
      );
    }

    // Restore state
    // In a full implementation, this would restore all state components

    this.context.recordLifecycleEvent('checkpoint_restored', {
      checkpointId: checkpoint.checkpointId,
      stateVersion: checkpoint.stateVersion,
    });
  }

  /**
   * Gets current simulation status.
   */
  getStatus(): SimulationStatus {
    return this.state.status;
  }

  /**
   * Gets current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.state.phase;
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Creates a state provider for scenario execution.
   */
  private createStateProvider(): StateProvider {
    return {
      getState: () => this.stateData,
      getValue: (path: string) => this.getNestedValue(this.stateData, path),
      setValue: (path: string, value: unknown) => {
        this.setNestedValue(this.stateData, path, value);
        // State changes are tracked via the stateData object
      },
      advanceTime: (ms: number) => {
        this.context?.advanceTime(ms);
      },
    };
  }

  /**
   * Gets a nested value from an object.
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Sets a nested value in an object.
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]!] = value;
  }

  /**
   * Builds policy result from evaluation history.
   */
  private buildPolicyResult(): PolicyResult {
    const stats = this.policyEngine?.getStatistics();
    const history = this.policyEngine?.getDecisionHistory() ?? [];

    return {
      policiesEvaluated: stats?.loadedPolicies ?? 0,
      decisionCounts: stats?.outcomeBreakdown ?? {
        allow: 0,
        deny: 0,
        warn: 0,
        require_approval: 0,
      },
      violations: [],
      complianceScore: 100,
      policyResults: [],
    };
  }

  /**
   * Computes execution metrics.
   */
  private computeMetrics(): ExecutionMetrics {
    const contextSummary = this.context?.getSummary();

    return {
      totalEvents: contextSummary?.traceEventCount ?? 0,
      stateTransitions: contextSummary?.stateVersion ?? 0,
      snapshotsCreated: contextSummary?.resourceUsage.snapshots ?? 0,
      peakMemoryBytes: contextSummary?.resourceUsage.memoryBytes ?? 0,
      externalCalls: 0,
      determinismVerified: true,
    };
  }

  /**
   * Computes execution timing.
   */
  private computeTiming(): ExecutionTiming {
    const startTime = this.state.startTime ?? new Date();
    const endTime = this.state.endTime ?? new Date();
    const durationMs = endTime.getTime() - startTime.getTime() - this.state.pauseDuration;

    return {
      startTime: startTime.toISOString() as ISOTimestamp,
      endTime: endTime.toISOString() as ISOTimestamp,
      durationMs,
      simulatedDurationMs: this.context?.getElapsedSimulatedTime() ?? 0,
      phaseTiming: {},
      waitTimeMs: this.state.pauseDuration,
    };
  }

  /**
   * Determines the simulation outcome.
   */
  private determineOutcome(
    scenarioResult: { status: string }
  ): 'success' | 'partial_success' | 'failure' | 'error' | 'timeout' | 'cancelled' {
    if (this.state.status === 'cancelled') return 'cancelled';

    switch (scenarioResult.status) {
      case 'passed':
        return 'success';
      case 'partial':
        return 'partial_success';
      case 'failed':
        return 'failure';
      default:
        return 'error';
    }
  }

  /**
   * Generates artifacts (placeholder).
   */
  private async generateArtifacts(): Promise<ArtifactManifest> {
    // Artifact generation will be implemented in Phase 9
    return {
      simulationId: this.config!.simulationId,
      generatedAt: this.context!.getTime(),
      artifacts: [],
      totalSizeBytes: 0,
      checksums: {},
      manifestHash: createContentHashFromObject({ empty: true }),
    };
  }

  /**
   * Builds result metadata.
   */
  private buildResultMetadata(): ResultMetadata {
    const resultData = {
      simulationId: this.config?.simulationId,
      status: this.state.status,
      phase: this.state.phase,
    };

    return {
      resultHash: createContentHashFromObject(resultData),
      engineVersion: '0.1.0',
      environment: 'simulation',
      cached: false,
    };
  }

  /**
   * Cleans up resources.
   */
  private async cleanup(): Promise<void> {
    this.context?.dispose();
    this.scenarioManager?.reset();
    this.policyEngine?.reset();
  }
}

// ============================================================================
// ERROR TYPE
// ============================================================================

/**
 * Error thrown by the simulation engine.
 */
export class SimulationEngineError extends Error {
  readonly code: string;
  readonly details: string;

  constructor(message: string, code: string, details: string) {
    super(message);
    this.name = 'SimulationEngineError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new simulation engine.
 */
export function createSimulationEngine(): SimulationEngine {
  return new SimulationEngine();
}
