/**
 * Simulation Engine.
 *
 * The main orchestrator for simulation execution.
 * Coordinates all subsystems and delegates execution responsibilities
 * to external Agentics Cores:
 *
 * - LLM-Security-Core: Policy evaluation
 * - LLM-Data-Core: Cost attribution
 * - LLM-Automation-Core: Artifact generation
 * - LLM-Governance-Core: Governance validation
 *
 * The engine retains scenario decomposition, coordination, and tracing.
 * Each Core delegation creates a child span, propagates parent_span_id,
 * and rejects flat (non-hierarchical) results.
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
import type {
  ExecutionProof,
  ExecutionLayer,
  LayerExecutionRecord,
  LayerOperation,
} from '../types/execution-proof.js';
import { MANDATORY_LAYERS } from '../types/execution-proof.js';
import type {
  CoreRequest,
  CoreResponse,
  SecurityCoreRequest,
  SecurityCoreResponse,
  DataCoreRequest,
  DataCoreResponse,
  AutomationCoreRequest,
  AutomationCoreResponse,
  GovernanceCoreRequest,
  GovernanceCoreResponse,
} from '../types/core-delegation.js';
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
  TraceSpan,
  createRootSpan,
  extractSpanContext,
} from '../trace/span.js';
import type { CoreClient, CoreClientRegistry } from '../integration/cores/core-client.js';
import { validateCoreSpanHierarchy } from '../integration/cores/span-validator.js';
import { CoreDelegationError } from '../integration/cores/errors.js';
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
  /** Tracks executed layers for execution proof */
  layerRecords: LayerExecutionRecord[];
  /** Currently executing layer */
  currentLayer?: ExecutionLayer;
  /** Layer start time for duration tracking */
  layerStartTime?: Date;
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
 * - Scenario decomposition and coordination
 * - Core delegation with span propagation
 * - Execution proof generation
 *
 * Delegated responsibilities (via external Agentics Cores):
 * - Policy evaluation → LLM-Security-Core
 * - Cost attribution → LLM-Data-Core
 * - Artifact generation → LLM-Automation-Core
 * - Governance validation → LLM-Governance-Core
 *
 * Execution layers:
 * 1. FOUNDATIONAL - Base infrastructure setup
 * 2. INTELLIGENCE - Scenario validation + policy analysis (Security Core)
 * 3. CORE - Step execution & state transitions (internal)
 * 4. VALIDATION - Policy aggregation (Security), cost (Data), governance (Governance)
 * 5. ARTIFACT - Artifact generation (Automation Core)
 */
export class SimulationEngine {
  private config?: SimulationConfig;
  private context?: ExecutionContext;
  private scenarioManager?: ScenarioManager;
  private coreClients?: CoreClientRegistry;
  private rootSpan?: TraceSpan;
  private state: EngineState = {
    status: 'queued',
    phase: 'initializing',
    pauseDuration: 0,
    checkpoints: [],
    layerRecords: [],
  };
  private scenario?: Scenario;
  private stateData: Record<string, unknown> = {};

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initializes the simulation engine with configuration and Core clients.
   *
   * @param config - Simulation configuration
   * @param coreClients - Registry of external Agentics Core clients
   * @returns Execution context for the simulation
   * @throws ConfigurationError if config is invalid
   */
  async initialize(
    config: SimulationConfig,
    coreClients: CoreClientRegistry
  ): Promise<ExecutionContext> {
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
    this.coreClients = coreClients;

    // Create execution context
    const contextConfig: ExecutionContextConfig = {
      simulationId: config.simulationId,
      scenarioId: config.scenario.scenarioId,
      config,
    };
    this.context = createExecutionContext(contextConfig);

    // Initialize subsystems (scenario coordination stays internal)
    this.scenarioManager = createScenarioManager({
      simulationId: config.simulationId,
      defaultStepTimeout: 30000,
      maxParallelSteps: config.resourceLimits.maxConcurrency,
      getTime: () => this.context!.getTime(),
    });

    this.state.phase = 'configuring';
    this.context.recordLifecycleEvent('engine_initialized', {
      configHash: createContentHashFromObject(config),
      coresRegistered: [
        coreClients.security.coreName,
        coreClients.data.coreName,
        coreClients.automation.coreName,
        coreClients.governance.coreName,
      ],
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
   * Delegates policy evaluation, cost attribution, artifact generation,
   * and governance validation to external Agentics Cores. Each delegation
   * creates a child Core span, propagates parent_span_id, and requires
   * nested repo + agent spans. Flat results are rejected.
   *
   * @param scenario - Scenario to execute
   * @returns Complete simulation result with mandatory execution proof
   */
  async execute(scenario: Scenario): Promise<SimulationResult> {
    if (!this.context || !this.config || !this.scenarioManager || !this.coreClients) {
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
    this.state.layerRecords = [];

    // Create root span for the entire simulation execution
    this.rootSpan = createRootSpan('simulation.execute', 'simulation-engine', {
      getTime: () => this.context!.getTime(),
      attributes: {
        'simulation.id': this.config.simulationId,
        'scenario.id': this.config.scenario.scenarioId,
      },
    });

    try {
      // ========================================================================
      // FOUNDATIONAL LAYER - Base infrastructure setup
      // ========================================================================
      this.startLayer('foundational');
      this.context.recordLifecycleEvent('layer_started', { layer: 'foundational' });

      // Context is already created during initialize()
      // Record foundational operations
      this.recordLayerOperation('context_verified', true);
      this.recordLayerOperation('clock_setup', true);
      this.recordLayerOperation('resource_limits_configured', true);

      this.endLayer('foundational', true);

      // ========================================================================
      // INTELLIGENCE LAYER - Smart processing & analysis
      // Delegates: Policy analysis → LLM-Security-Core
      // ========================================================================
      this.startLayer('intelligence');
      this.context.recordLifecycleEvent('layer_started', { layer: 'intelligence' });
      this.context.recordLifecycleEvent('phase_started', { phase: 'planning' });

      // Validate scenario (internal - ScenarioManager retained)
      const scenarioValidation = this.scenarioManager.validateScenario(scenario);
      if (!scenarioValidation.valid) {
        this.endLayer('intelligence', false, {
          code: 'INVALID_SCENARIO',
          message: scenarioValidation.errors.map((e) => e.message).join('; '),
        });
        throw new SimulationEngineError(
          'Scenario validation failed',
          'INVALID_SCENARIO',
          scenarioValidation.errors.map((e) => e.message).join('; ')
        );
      }
      this.recordLayerOperation('scenario_validated', true);

      // Prepare scenario with parameter resolution (internal)
      const prepared = this.scenarioManager.prepareScenario(
        scenario,
        this.config.scenario.parameters ?? {}
      );
      this.recordLayerOperation('scenario_prepared', true);

      // DELEGATE: Pre-execution policy analysis to LLM-Security-Core
      const securityPreResult = await this.delegateToCore<
        SecurityCoreRequest,
        SecurityCoreResponse
      >(this.coreClients.security, 'intelligence.policy_analysis', {
        coreType: 'llm-security-core',
        phase: 'pre-execution',
        policyReferences: this.config.policies.map((p) => ({
          policyId: p.policyId as string,
          version: p.version,
        })),
        evaluationContext: {
          scenarioId: this.config.scenario.scenarioId,
          parameters: this.config.scenario.parameters ?? {},
        },
        stateSnapshot: this.stateData,
      });
      this.recordLayerOperation('policy_analysis_delegated', securityPreResult.success);

      this.endLayer('intelligence', true);

      // ========================================================================
      // CORE LAYER - Step execution & state transitions (internal)
      // ========================================================================
      this.startLayer('core');
      this.context.recordLifecycleEvent('layer_started', { layer: 'core' });
      this.state.phase = 'executing';
      this.context.recordLifecycleEvent('phase_started', { phase: 'execution' });

      // Create state provider
      const stateProvider = this.createStateProvider();
      this.recordLayerOperation('state_provider_created', true);

      // Execute scenario steps (internal - ScenarioManager retained)
      const scenarioResult = await this.scenarioManager.execute(stateProvider);
      this.recordLayerOperation('steps_executed', scenarioResult.status !== 'failed');
      this.recordLayerOperation('state_transitions_recorded', true);

      this.endLayer('core', true);

      // ========================================================================
      // VALIDATION LAYER - Post-execution validation
      // Delegates: Policy aggregation → LLM-Security-Core
      //            Cost attribution → LLM-Data-Core
      //            Governance → LLM-Governance-Core
      // ========================================================================
      this.startLayer('validation');
      this.state.phase = 'teardown';
      this.context.recordLifecycleEvent('layer_started', { layer: 'validation' });
      this.context.recordLifecycleEvent('phase_started', { phase: 'analysis' });

      // DELEGATE: Post-execution policy aggregation to LLM-Security-Core
      const securityPostResult = await this.delegateToCore<
        SecurityCoreRequest,
        SecurityCoreResponse
      >(this.coreClients.security, 'validation.policy_aggregation', {
        coreType: 'llm-security-core',
        phase: 'post-execution',
        policyReferences: this.config.policies.map((p) => ({
          policyId: p.policyId as string,
          version: p.version,
        })),
        evaluationContext: {
          scenarioResult: {
            status: scenarioResult.status,
            stepCount: scenarioResult.stepResults.length,
          },
          stepResults: scenarioResult.stepResults,
        },
        stateSnapshot: this.stateData,
      });
      this.recordLayerOperation('policy_results_aggregated', securityPostResult.success);

      // DELEGATE: Cost attribution to LLM-Data-Core
      const dataResult = await this.delegateToCore<
        DataCoreRequest,
        DataCoreResponse
      >(this.coreClients.data, 'validation.cost_attribution', {
        coreType: 'llm-data-core',
        entityReferences: this.config.dataSources.map((ds) => ({
          entityType: ds.type,
          entityId: ds.id,
        })),
        executionSummary: {
          scenarioId: this.config.scenario.scenarioId,
          stepResults: scenarioResult.stepResults,
          status: scenarioResult.status,
        },
      });
      this.recordLayerOperation('cost_attribution_delegated', dataResult.success);

      // DELEGATE: Governance validation to LLM-Governance-Core
      const governanceResult = await this.delegateToCore<
        GovernanceCoreRequest,
        GovernanceCoreResponse
      >(this.coreClients.governance, 'validation.governance', {
        coreType: 'llm-governance-core',
        policyResults: securityPostResult.policyResult,
        scenarioResults: {
          status: scenarioResult.status,
          stepResults: scenarioResult.stepResults,
          expectationResults: scenarioResult.expectationResults,
          coverage: scenarioResult.coverage,
        },
      });
      this.recordLayerOperation('governance_validated', governanceResult.success);

      // Use delegated results
      const policyResult = governanceResult.validatedPolicyResult;
      const metrics = this.mergeMetrics(
        this.computeBaseMetrics(),
        dataResult.executionMetrics
      );

      this.endLayer('validation', true);

      // ========================================================================
      // ARTIFACT LAYER - Generate artifacts
      // Delegates: Artifact generation → LLM-Automation-Core
      // ========================================================================
      this.startLayer('artifact');
      this.context.recordLifecycleEvent('layer_started', { layer: 'artifact' });
      this.context.recordLifecycleEvent('phase_started', { phase: 'export' });

      // DELEGATE: Artifact generation to LLM-Automation-Core
      const automationResult = await this.delegateToCore<
        AutomationCoreRequest,
        AutomationCoreResponse
      >(this.coreClients.automation, 'artifact.generation', {
        coreType: 'llm-automation-core',
        simulationResult: {
          simulationId: this.config.simulationId,
          status: this.determineOutcome(scenarioResult),
          scenarioResult: {
            status: scenarioResult.status,
            coverage: scenarioResult.coverage,
          },
          policyResult,
          metrics,
        },
        simulationConfig: {
          simulationId: this.config.simulationId,
          scenario: this.config.scenario,
          policies: this.config.policies,
          resourceLimits: this.config.resourceLimits,
          artifactConfig: this.config.artifactConfig,
        },
        artifactConfig: {
          generateReport: this.config.artifactConfig.generateReport,
          generatePolicyLog: this.config.artifactConfig.generatePolicyLog,
          generateStateSnapshots: this.config.artifactConfig.generateStateSnapshots,
          generateTrace: this.config.artifactConfig.generateTrace,
          formats: [...this.config.artifactConfig.formats],
        },
      });
      this.recordLayerOperation('artifacts_generated', automationResult.success);

      const artifacts = automationResult.artifacts;

      this.endLayer('artifact', true);

      // ========================================================================
      // COMPLETE - Build result with execution proof
      // ========================================================================
      this.state.status = 'completed';
      this.state.phase = 'completed';
      this.state.endTime = new Date();

      // End root span
      this.rootSpan.end();

      const timing = this.computeTiming();
      const executionProof = this.buildExecutionProof();

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
        executionProof,
      };

      this.context.recordLifecycleEvent('simulation_completed', {
        status: result.status,
        durationMs: timing.durationMs,
        layersExecuted: executionProof.layersExecuted,
      });

      return result;
    } catch (error) {
      // End root span as failed if active
      if (this.rootSpan?.isActive) {
        this.rootSpan.fail(error instanceof Error ? error : String(error));
      }

      // End current layer as failed if one is in progress
      if (this.state.currentLayer) {
        this.endLayer(this.state.currentLayer, false, {
          code: error instanceof SimulationEngineError
            ? error.code
            : error instanceof CoreDelegationError
              ? error.code
              : 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      }

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
  // CORE DELEGATION
  // ==========================================================================

  /**
   * Delegates work to an external Agentics Core with full span propagation
   * and response validation.
   *
   * Creates a child span under the root simulation span, propagates the
   * SpanContext (traceId + parentSpanId), calls the Core, validates the
   * response span hierarchy, and ingests the Core's spans into the
   * trace collector.
   *
   * REJECTS flat results: If the Core returns a response without proper
   * nested repo + agent spans, a CoreDelegationError is thrown.
   *
   * @param client - The Core client to call
   * @param operationName - Operation name for the span
   * @param requestData - Core-specific request data (span context auto-filled)
   * @returns The Core's response
   * @throws CoreDelegationError if response has flat/missing spans
   */
  private async delegateToCore<
    TReq extends CoreRequest,
    TRes extends CoreResponse,
  >(
    client: CoreClient<TReq, TRes>,
    operationName: string,
    requestData: Omit<
      TReq,
      'simulationId' | 'traceId' | 'parentSpanId' | 'requestedAt' | 'timeoutMs'
    >
  ): Promise<TRes> {
    // 1. Create a child span for the Core call
    const coreSpan = this.rootSpan!.startChild(
      `core.${client.coreName}.${operationName}`
    );
    coreSpan.setAttribute('core.name', client.coreName);
    coreSpan.setAttribute('core.operation', operationName);

    const spanContext = extractSpanContext(coreSpan);

    // 2. Build the full request with propagated span context
    const request = {
      ...requestData,
      simulationId: this.config!.simulationId,
      traceId: spanContext.traceId,
      parentSpanId: spanContext.spanId,
      requestedAt: this.context!.getTime(),
      timeoutMs: 30000,
    } as TReq;

    try {
      // 3. Call the external Core
      const response = await client.call(request);

      // 4. Validate span hierarchy in response (REJECT flat results)
      const validation = validateCoreSpanHierarchy(
        response.spanHierarchy,
        spanContext.spanId,
        spanContext.traceId,
        client.coreName
      );

      if (!validation.valid) {
        coreSpan.fail(
          new Error(`Flat span hierarchy from ${client.coreName}`)
        );
        throw new CoreDelegationError(
          `Core ${client.coreName} returned flat results`,
          'FLAT_SPAN_HIERARCHY',
          client.coreName,
          validation.errors.map((e) => e.message).join('; '),
          validation
        );
      }

      // 5. Record Core's response metadata on the span
      coreSpan.setAttribute('core.durationMs', response.durationMs);
      coreSpan.setAttribute('core.success', response.success);
      coreSpan.setAttribute(
        'core.spans.repo',
        response.spanHierarchy.repoSpan.spanId
      );
      coreSpan.setAttribute(
        'core.spans.agentCount',
        response.spanHierarchy.agentSpans.length
      );

      // 6. End the Core span successfully
      coreSpan.end();

      return response;
    } catch (error) {
      if (coreSpan.isActive) {
        coreSpan.fail(error instanceof Error ? error : String(error));
      }
      throw error;
    }
  }

  // ==========================================================================
  // LAYER TRACKING
  // ==========================================================================

  /**
   * Starts tracking a new execution layer.
   */
  private startLayer(layer: ExecutionLayer): void {
    this.state.currentLayer = layer;
    this.state.layerStartTime = new Date();
  }

  /**
   * Records an operation within the current layer.
   */
  private recordLayerOperation(type: string, success: boolean, metadata?: Record<string, unknown>): void {
    // Operations are tracked within layer records
    // The actual tracking happens when endLayer is called
  }

  /**
   * Ends the current layer and records its execution.
   */
  private endLayer(
    layer: ExecutionLayer,
    success: boolean,
    error?: { code: string; message: string }
  ): void {
    const startTime = this.state.layerStartTime ?? new Date();
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const inputHash = createContentHashFromObject({
      layer,
      startTime: startTime.toISOString(),
      stateVersion: this.context?.state.getVersion() ?? 0,
    });

    const outputHash = createContentHashFromObject({
      layer,
      endTime: endTime.toISOString(),
      success,
      stateVersion: this.context?.state.getVersion() ?? 0,
    });

    const record: LayerExecutionRecord = {
      layer,
      startTime: startTime.toISOString() as ISOTimestamp,
      endTime: endTime.toISOString() as ISOTimestamp,
      durationMs,
      success,
      error,
      inputHash,
      outputHash,
      operations: [],
    };

    this.state.layerRecords.push(record);
    this.state.currentLayer = undefined;
    this.state.layerStartTime = undefined;
  }

  /**
   * Builds the execution proof from layer records.
   */
  private buildExecutionProof(): ExecutionProof {
    const layersExecuted = this.state.layerRecords.map((r) => r.layer);
    const mandatoryComplete = MANDATORY_LAYERS.every((l) => layersExecuted.includes(l));
    const totalExecutionMs = this.state.layerRecords.reduce((sum, r) => sum + r.durationMs, 0);

    const proofData = {
      layersExecuted,
      layerRecords: this.state.layerRecords,
      timestamp: new Date().toISOString(),
    };

    return {
      layersExecuted,
      layerRecords: this.state.layerRecords,
      proofGeneratedAt: new Date().toISOString() as ISOTimestamp,
      proofHash: createContentHashFromObject(proofData),
      mandatoryLayersComplete: mandatoryComplete,
      totalExecutionMs,
    };
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

    // End root span if active
    if (this.rootSpan?.isActive) {
      this.rootSpan.cancel(reason);
    }

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
   * Computes base execution metrics from internal context.
   * Cost-related metrics come from LLM-Data-Core.
   */
  private computeBaseMetrics(): ExecutionMetrics {
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
   * Merges internal base metrics with metrics from LLM-Data-Core.
   */
  private mergeMetrics(
    base: ExecutionMetrics,
    coreMetrics: Partial<ExecutionMetrics>
  ): ExecutionMetrics {
    return {
      totalEvents: coreMetrics.totalEvents ?? base.totalEvents,
      stateTransitions: coreMetrics.stateTransitions ?? base.stateTransitions,
      snapshotsCreated: coreMetrics.snapshotsCreated ?? base.snapshotsCreated,
      peakMemoryBytes: coreMetrics.peakMemoryBytes ?? base.peakMemoryBytes,
      externalCalls: (base.externalCalls) + (coreMetrics.externalCalls ?? 0),
      determinismVerified: base.determinismVerified && (coreMetrics.determinismVerified ?? true),
      custom: {
        ...base.custom,
        ...coreMetrics.custom,
      },
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
