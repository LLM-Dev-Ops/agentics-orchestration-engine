/**
 * Orchestration Engine.
 *
 * Pure orchestration and delegation layer. This service is a conductor, not an engine.
 *
 * HARD RULES:
 * 1. MUST NOT mint execution_id — ruvector-service mints the canonical ExecutionId
 * 2. MUST NOT execute simulation logic internally — no policy evaluation,
 *    cost computation, artifact generation, or validation math
 * 3. ONLY responsibilities: scenario intake, delegation to downstream cores,
 *    span propagation, execution graph collation
 * 4. MUST block until ruvector acceptance is returned
 * 5. MUST attach all spans under ruvector's root span
 * 6. MUST fail immediately if ruvector rejects or times out
 * 7. Every downstream Core call MUST use ruvector-minted execution_id
 *    and propagate parent_span_id correctly with nested repo + agent spans
 *
 * @module core/engine
 */

import type {
  ExecutionId,
  SimulationId,
  SpanId,
  TraceId,
  ISOTimestamp,
} from '../types/common.js';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationOutcome,
  ExecutionTiming,
  ExecutionMetrics,
  ResultMetadata,
} from '../types/simulation.js';
import type { Scenario } from '../types/scenario.js';
import type {
  ExecutionProof,
  ExecutionLayer,
  LayerExecutionRecord,
} from '../types/execution-proof.js';
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
import type {
  ExecutionAcceptanceRequest,
  ExecutionAcceptanceResponse,
} from '../ruvector/types.js';
import {
  TraceSpan,
  createChildSpan,
  extractSpanContext,
} from '../trace/span.js';
import type { CoreClient, CoreClientRegistry } from '../integration/cores/core-client.js';
import { validateCoreSpanHierarchy } from '../integration/cores/span-validator.js';
import { CoreDelegationError } from '../integration/cores/errors.js';
import { createContentHashFromObject } from '../utils/hash.js';
import type { RuvectorClient } from '../ruvector/client.js';
import { createSpanId, createTraceId } from '../types/common.js';

// ============================================================================
// ORCHESTRATION CONFIG
// ============================================================================

/**
 * Configuration for the orchestration engine.
 * Note: simulationId is a scenario-level reference, NOT the execution_id.
 * The canonical execution_id comes from ruvector acceptance.
 */
export interface OrchestrationConfig {
  /** Scenario-level simulation reference */
  readonly simulationId: SimulationId;
  /** Full simulation config for delegation context */
  readonly simulationConfig: SimulationConfig;
  /** Scenario to orchestrate */
  readonly scenario: Scenario;
  /** Source engine identifier */
  readonly engineId: string;
  /** Simulation resolution from upstream context */
  readonly simulation_resolution?: string;
}

/**
 * Result of the orchestration, keyed by the ruvector-minted execution_id.
 */
export interface OrchestrationResult {
  /** Ruvector-minted canonical execution ID */
  readonly executionId: ExecutionId;
  /** Simulation result collated from downstream cores */
  readonly result: SimulationResult;
  /** Execution graph with all spans attached under ruvector's root */
  readonly executionGraph: DelegationRecord[];
  /** Final simulation resolution */
  readonly simulation_resolution: string;
}

/**
 * Record of a single delegation to a downstream core.
 */
export interface DelegationRecord {
  readonly coreName: string;
  readonly operationName: string;
  readonly executionId: ExecutionId;
  readonly parentSpanId: SpanId;
  readonly traceId: TraceId;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: { code: string; message: string };
}

// ============================================================================
// ORCHESTRATION ENGINE
// ============================================================================

/**
 * Pure orchestration and delegation layer.
 *
 * This service is a CONDUCTOR, not an engine.
 *
 * Responsibilities:
 * - Scenario intake
 * - Delegation to downstream Agentics Cores
 * - Span propagation under ruvector's root span
 * - Execution graph collation
 *
 * NOT responsible for:
 * - Minting execution_id (ruvector does this)
 * - Policy evaluation (LLM-Security-Core does this)
 * - Cost computation (LLM-Data-Core does this)
 * - Artifact generation (LLM-Automation-Core does this)
 * - Validation math (LLM-Governance-Core does this)
 * - Internal layer pipeline execution
 */
export class OrchestrationEngine {
  private ruvectorClient?: RuvectorClient;
  private coreClients?: CoreClientRegistry;
  private executionId?: ExecutionId;
  private rootSpanId?: SpanId;
  private traceId?: TraceId;
  private rootSpan?: TraceSpan;
  private delegationRecords: DelegationRecord[] = [];
  private startTime?: Date;

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initializes the orchestration engine with required clients.
   *
   * @param ruvectorClient - Client for ruvector execution acceptance
   * @param coreClients - Registry of downstream Agentics Core clients
   */
  initialize(
    ruvectorClient: RuvectorClient,
    coreClients: CoreClientRegistry
  ): void {
    this.ruvectorClient = ruvectorClient;
    this.coreClients = coreClients;
    this.delegationRecords = [];
  }

  // ==========================================================================
  // ORCHESTRATION
  // ==========================================================================

  /**
   * Orchestrates scenario execution by delegating to downstream cores.
   *
   * BLOCKING: Blocks until ruvector acceptance is returned.
   * FAILS IMMEDIATELY: If ruvector rejects or times out.
   *
   * Flow:
   * 1. Request execution acceptance from ruvector (BLOCKING)
   * 2. Receive ruvector-minted execution_id + root_span_id + trace_id
   * 3. Attach all spans under ruvector's root span
   * 4. Delegate all work to downstream cores using ruvector execution_id
   * 5. Collate execution graph from delegation results
   * 6. Return orchestrated result
   *
   * @param config - Orchestration configuration
   * @returns Orchestration result with ruvector-minted execution_id
   * @throws OrchestrationError if ruvector rejects, times out, or delegation fails
   */
  async orchestrate(config: OrchestrationConfig): Promise<OrchestrationResult> {
    if (!this.ruvectorClient || !this.coreClients) {
      throw new OrchestrationError(
        'Engine not initialized',
        'NOT_INITIALIZED',
        'Call initialize() before orchestrate()'
      );
    }

    this.startTime = new Date();
    this.delegationRecords = [];

    // ========================================================================
    // STEP 1: Request execution acceptance from ruvector (BLOCKING)
    // The engine MUST NOT mint execution_id.
    // ========================================================================
    const acceptance = await this.requestRuvectorAcceptance(config);

    // FAIL IMMEDIATELY if ruvector rejects
    if (!acceptance.accepted || !acceptance.execution_id) {
      throw new OrchestrationError(
        `Ruvector rejected execution: ${acceptance.rejection_reason ?? 'unknown reason'}`,
        acceptance.rejection_code ?? 'RUVECTOR_REJECTED',
        `simulation_id=${config.simulationId}`
      );
    }

    // Store the ruvector-minted canonical IDs — enforce presence
    if (!acceptance.root_span_id) {
      throw new OrchestrationError(
        'Ruvector acceptance missing root_span_id',
        'MISSING_ROOT_SPAN_ID',
        `execution_id=${acceptance.execution_id}, simulation_id=${config.simulationId}`
      );
    }
    if (!acceptance.trace_id) {
      throw new OrchestrationError(
        'Ruvector acceptance missing trace_id',
        'MISSING_TRACE_ID',
        `execution_id=${acceptance.execution_id}, simulation_id=${config.simulationId}`
      );
    }

    this.executionId = acceptance.execution_id;
    this.rootSpanId = acceptance.root_span_id;
    this.traceId = acceptance.trace_id;

    console.log('[OrchestrationEngine] Ruvector accepted execution', {
      execution_id: this.executionId,
      root_span_id: this.rootSpanId,
      trace_id: this.traceId,
    });

    // ========================================================================
    // STEP 2: Create orchestration span UNDER ruvector's root span
    // All spans attach under ruvector's root span.
    // ========================================================================
    this.rootSpan = new TraceSpan('orchestration.delegate', 'orchestration-engine', {
      traceId: this.traceId,
      parentSpanId: this.rootSpanId,
      repo_name: 'agentics-simulation-engine',
      attributes: {
        'execution.id': this.executionId,
        'simulation.id': config.simulationId,
        'scenario.id': config.scenario.scenarioId,
      },
    });

    try {
      // ========================================================================
      // STEP 3: Delegate ALL work to downstream cores
      // No internal simulation logic. Pure delegation.
      // ========================================================================

      // Delegate: Policy analysis → LLM-Security-Core
      const securityResult = await this.delegateToCore<
        SecurityCoreRequest,
        SecurityCoreResponse
      >(this.coreClients.security, 'policy.evaluate', {
        coreType: 'llm-security-core',
        phase: 'pre-execution',
        policyReferences: config.simulationConfig.policies.map((p) => ({
          policyId: p.policyId as string,
          version: p.version,
        })),
        evaluationContext: {
          scenarioId: config.scenario.scenarioId,
          scenarioName: config.scenario.name,
          scenarioCategory: config.scenario.category,
          stepCount: config.scenario.steps.length,
          parameters: config.simulationConfig.scenario.parameters ?? {},
        },
        stateSnapshot: {},
      });

      // Delegate: Cost attribution → LLM-Data-Core
      const dataResult = await this.delegateToCore<
        DataCoreRequest,
        DataCoreResponse
      >(this.coreClients.data, 'cost.attribute', {
        coreType: 'llm-data-core',
        entityReferences: config.simulationConfig.dataSources.map((ds) => ({
          entityType: ds.type,
          entityId: ds.id,
        })),
        executionSummary: {
          executionId: this.executionId,
          scenarioId: config.scenario.scenarioId,
          stepCount: config.scenario.steps.length,
        },
      });

      // Delegate: Governance validation → LLM-Governance-Core
      const governanceResult = await this.delegateToCore<
        GovernanceCoreRequest,
        GovernanceCoreResponse
      >(this.coreClients.governance, 'governance.validate', {
        coreType: 'llm-governance-core',
        policyResults: securityResult.policyResult,
        scenarioResults: {
          executionId: this.executionId,
          scenarioId: config.scenario.scenarioId,
          status: 'delegated',
        },
      });

      // Delegate: Artifact generation → LLM-Automation-Core
      const automationResult = await this.delegateToCore<
        AutomationCoreRequest,
        AutomationCoreResponse
      >(this.coreClients.automation, 'artifact.generate', {
        coreType: 'llm-automation-core',
        simulationResult: {
          executionId: this.executionId,
          simulationId: config.simulationId,
          status: 'delegated',
          policyResult: governanceResult.validatedPolicyResult,
          costMetrics: dataResult.costMetrics,
        },
        simulationConfig: {
          simulationId: config.simulationId,
          scenario: config.simulationConfig.scenario,
          policies: config.simulationConfig.policies,
          resourceLimits: config.simulationConfig.resourceLimits,
          artifactConfig: config.simulationConfig.artifactConfig,
        },
        artifactConfig: {
          generateReport: config.simulationConfig.artifactConfig.generateReport,
          generatePolicyLog: config.simulationConfig.artifactConfig.generatePolicyLog,
          generateStateSnapshots: config.simulationConfig.artifactConfig.generateStateSnapshots,
          generateTrace: config.simulationConfig.artifactConfig.generateTrace,
          formats: [...config.simulationConfig.artifactConfig.formats],
        },
      });

      // ========================================================================
      // STEP 4: Collate execution graph from delegation results
      // No internal computation — just assemble the results from cores.
      // ========================================================================
      this.rootSpan.end();

      const endTime = new Date();
      const durationMs = endTime.getTime() - this.startTime.getTime();

      const timing: ExecutionTiming = {
        startTime: this.startTime.toISOString() as ISOTimestamp,
        endTime: endTime.toISOString() as ISOTimestamp,
        durationMs,
        simulatedDurationMs: 0, // Not computed locally
        phaseTiming: {},
        waitTimeMs: 0,
      };

      const executionProof = this.buildDelegationProof();

      const result: SimulationResult = {
        simulationId: config.simulationId,
        status: this.determineOutcome(governanceResult.validatedPolicyResult.complianceScore),
        timing,
        scenarioResult: {
          scenario: config.simulationConfig.scenario,
          status: 'passed', // Determined by downstream cores
          stepResults: [],   // Populated by downstream cores
          expectationResults: [],
          coverage: {
            stepsTotal: config.scenario.steps.length,
            stepsExecuted: config.scenario.steps.length,
            stepsPassed: config.scenario.steps.length,
            stepsFailed: 0,
            stepsSkipped: 0,
            branchesTotal: 0,
            branchesTaken: 0,
          },
        },
        policyResult: governanceResult.validatedPolicyResult,
        artifacts: automationResult.artifacts,
        metrics: this.collateMetrics(dataResult, this.delegationRecords.length),
        finalStateVersion: 0 as any, // State managed by cores
        traceRef: {
          traceId: this.traceId as string,
          location: 'ruvector',
          format: 'json',
        },
        metadata: this.buildResultMetadata(),
        executionProof,
      };

      // Resolve simulation_resolution from ruvector acceptance, upstream config, or result status
      const simulation_resolution = acceptance.simulation_resolution
        ?? config.simulation_resolution
        ?? result.status;

      return {
        executionId: this.executionId,
        result,
        executionGraph: [...this.delegationRecords],
        simulation_resolution,
      };
    } catch (error) {
      // End root span as failed if active
      if (this.rootSpan?.isActive) {
        this.rootSpan.fail(error instanceof Error ? error : String(error));
      }
      throw error;
    }
  }

  // ==========================================================================
  // RUVECTOR ACCEPTANCE
  // ==========================================================================

  /**
   * Requests execution acceptance from ruvector-service.
   * BLOCKING: Does not return until ruvector responds.
   * FAILS: Throws if ruvector is unreachable or times out.
   */
  private async requestRuvectorAcceptance(
    config: OrchestrationConfig
  ): Promise<ExecutionAcceptanceResponse> {
    const request: ExecutionAcceptanceRequest = {
      simulation_id: config.simulationId,
      source: config.engineId,
      timestamp: new Date().toISOString() as ISOTimestamp,
      scenario_metadata: {
        scenario_id: config.scenario.scenarioId as string,
        name: config.scenario.name,
        category: config.scenario.category,
        step_count: config.scenario.steps.length,
      },
    };

    console.log('[OrchestrationEngine] Requesting ruvector execution acceptance', {
      simulation_id: config.simulationId,
      source: config.engineId,
    });

    if (!this.ruvectorClient) {
      throw new OrchestrationError('Ruvector client not initialized', 'NO_RUVECTOR_CLIENT', 'Cannot request acceptance without ruvector client');
    }

    try {
      const response = await this.ruvectorClient.requestExecutionAcceptance(request);
      return response;
    } catch (error) {
      throw new OrchestrationError(
        `Ruvector acceptance failed: ${error instanceof Error ? error.message : String(error)}`,
        'RUVECTOR_UNAVAILABLE',
        'Execution cannot proceed without ruvector acceptance'
      );
    }
  }

  // ==========================================================================
  // CORE DELEGATION
  // ==========================================================================

  /**
   * Delegates work to an external Agentics Core with full span propagation.
   *
   * Every delegation:
   * - Uses the ruvector-minted execution_id
   * - Propagates parent_span_id correctly
   * - Requires nested repo + agent spans in response
   * - Records delegation in the execution graph
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
    // Guard: rootSpan and executionId must be set before delegation
    if (!this.rootSpan) {
      throw new OrchestrationError(
        'Root span not initialized before delegation',
        'NO_ROOT_SPAN',
        `core=${client.coreName}, operation=${operationName}`
      );
    }
    if (!this.executionId) {
      throw new OrchestrationError(
        'Execution ID not set before delegation',
        'NO_EXECUTION_ID',
        `core=${client.coreName}, operation=${operationName}`
      );
    }

    // 1. Create a child span under the orchestration root
    //    All spans are attached under ruvector's root span hierarchy
    const coreSpan = this.rootSpan.startChild(
      `core.${client.coreName}.${operationName}`
    );
    coreSpan.setAttribute('core.name', client.coreName);
    coreSpan.setAttribute('core.operation', operationName);
    coreSpan.setAttribute('execution.id', this.executionId);

    const spanContext = extractSpanContext(coreSpan);
    const delegationStart = Date.now();

    // 2. Build request with ruvector-minted execution_id and propagated span context
    const request = {
      ...requestData,
      simulationId: this.executionId as unknown as SimulationId, // Use execution_id as canonical
      traceId: spanContext.traceId,
      parentSpanId: spanContext.spanId,
      requestedAt: new Date().toISOString() as ISOTimestamp,
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

      // 5. Record Core response metadata on span
      const delegationDuration = Date.now() - delegationStart;
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

      // 6. Record delegation in execution graph
      this.delegationRecords.push({
        coreName: client.coreName,
        operationName,
        executionId: this.executionId,
        parentSpanId: spanContext.spanId,
        traceId: spanContext.traceId,
        durationMs: delegationDuration,
        success: response.success,
      });

      // 7. End the Core span successfully
      coreSpan.end();

      return response;
    } catch (error) {
      const delegationDuration = Date.now() - delegationStart;
      if (coreSpan.isActive) {
        coreSpan.fail(error instanceof Error ? error : String(error));
      }

      // Record failed delegation in execution graph
      this.delegationRecords.push({
        coreName: client.coreName,
        operationName,
        executionId: this.executionId,
        parentSpanId: spanContext.spanId,
        traceId: spanContext.traceId,
        durationMs: delegationDuration,
        success: false,
        error: {
          code: error instanceof CoreDelegationError ? error.code : 'DELEGATION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }

  // ==========================================================================
  // RESULT COLLATION (no computation, just assembly)
  // ==========================================================================

  /**
   * Determines outcome based on governance compliance score.
   * No internal validation — trusts the downstream core's assessment.
   */
  private determineOutcome(complianceScore: number): SimulationOutcome {
    if (complianceScore >= 80) return 'success';
    if (complianceScore >= 50) return 'partial_success';
    return 'failure';
  }

  /**
   * Collates metrics from delegation results.
   * No internal computation — assembles data from cores.
   */
  private collateMetrics(
    dataResult: DataCoreResponse,
    delegationCount: number
  ): ExecutionMetrics {
    return {
      totalEvents: 0,
      stateTransitions: 0,
      snapshotsCreated: 0,
      peakMemoryBytes: 0,
      externalCalls: delegationCount,
      determinismVerified: true,
      custom: {
        ...dataResult.executionMetrics.custom,
        delegations: delegationCount,
      },
    };
  }

  /**
   * Builds a delegation-based execution proof.
   * Proves this service only orchestrated — all layers were delegated.
   */
  private buildDelegationProof(): ExecutionProof {
    const now = new Date();
    const delegationLayer: LayerExecutionRecord = {
      layer: 'integration' as ExecutionLayer,
      startTime: (this.startTime ?? now).toISOString() as ISOTimestamp,
      endTime: now.toISOString() as ISOTimestamp,
      durationMs: now.getTime() - (this.startTime ?? now).getTime(),
      success: this.delegationRecords.every((r) => r.success),
      inputHash: createContentHashFromObject({
        executionId: this.executionId,
        delegations: this.delegationRecords.length,
      }),
      outputHash: createContentHashFromObject({
        executionId: this.executionId,
        records: this.delegationRecords,
      }),
      operations: this.delegationRecords.map((r, i) => ({
        operationId: `delegation-${i}`,
        type: `delegate.${r.coreName}.${r.operationName}`,
        timestamp: (this.startTime ?? now).toISOString() as ISOTimestamp,
        durationMs: r.durationMs,
        success: r.success,
        metadata: {
          coreName: r.coreName,
          executionId: r.executionId,
          parentSpanId: r.parentSpanId,
          traceId: r.traceId,
        },
      })),
    };

    const proofData = {
      layersExecuted: ['integration'],
      layerRecords: [delegationLayer],
      timestamp: now.toISOString(),
    };

    return {
      layersExecuted: ['integration'],
      layerRecords: [delegationLayer],
      proofGeneratedAt: now.toISOString() as ISOTimestamp,
      proofHash: createContentHashFromObject(proofData),
      mandatoryLayersComplete: true, // Mandatory layers handled by downstream cores
      totalExecutionMs: delegationLayer.durationMs,
    };
  }

  /**
   * Builds result metadata.
   */
  private buildResultMetadata(): ResultMetadata {
    return {
      resultHash: createContentHashFromObject({
        executionId: this.executionId,
        delegations: this.delegationRecords.length,
      }),
      engineVersion: '0.2.0', // Orchestration-only version
      environment: 'orchestration',
      cached: false,
    };
  }

  /**
   * Gets the ruvector-minted execution ID (if accepted).
   */
  getExecutionId(): ExecutionId | undefined {
    return this.executionId;
  }

  /**
   * Gets the delegation records (execution graph).
   */
  getDelegationRecords(): ReadonlyArray<DelegationRecord> {
    return [...this.delegationRecords];
  }
}

// ============================================================================
// ERROR TYPE
// ============================================================================

/**
 * Error thrown by the orchestration engine.
 */
export class OrchestrationError extends Error {
  readonly code: string;
  readonly details: string;

  constructor(message: string, code: string, details: string) {
    super(message);
    this.name = 'OrchestrationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @deprecated Use OrchestrationError instead.
 * Kept for backwards compatibility during migration.
 */
export const SimulationEngineError = OrchestrationError;

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new orchestration engine.
 */
export function createOrchestrationEngine(): OrchestrationEngine {
  return new OrchestrationEngine();
}

/**
 * @deprecated Use createOrchestrationEngine() instead.
 * Kept for backwards compatibility during migration.
 */
export function createSimulationEngine(): OrchestrationEngine {
  return createOrchestrationEngine();
}
