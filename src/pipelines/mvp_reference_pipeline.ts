/**
 * MVP Reference Pipeline — deterministic pipeline graph definition.
 *
 * Converts a natural-language business request into a structured
 * ERP decision packet via a sequential, deterministic pipeline.
 *
 * This file defines the static pipeline graph ONLY.
 * No runtime execution logic is implemented here.
 *
 * @module pipelines/mvp_reference_pipeline
 */

import type {
  BusinessRequest,
  DecomposedRequest,
  SolutionPlan,
  SDKScaffold,
  SimulationResult,
  ERPDeploymentArtifact,
  ERPSurfacePushResult,
  ResultPacket,
  IndexConfirmation,
} from '@agentics/contracts';

// ============================================================================
// PIPELINE TYPE DEFINITIONS
// ============================================================================

/**
 * Retry policy for a pipeline step.
 */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs?: number;
  readonly retryableErrors?: ReadonlyArray<string>;
}

/**
 * Maps pipeline schema identifiers to their contract types.
 * Enforces that only known contract schemas can be referenced in steps.
 */
export interface PipelineSchemaMap {
  readonly BusinessRequest: BusinessRequest;
  readonly DecomposedRequest: DecomposedRequest;
  readonly SolutionPlan: SolutionPlan;
  readonly SDKScaffold: SDKScaffold;
  readonly SimulationResult: SimulationResult;
  readonly ERPDeploymentArtifact: ERPDeploymentArtifact;
  readonly ERPSurfacePushResult: ERPSurfacePushResult;
  readonly ResultPacket: ResultPacket;
  readonly IndexConfirmation: IndexConfirmation;
}

/**
 * Valid schema identifiers, constrained to keys of the schema map.
 */
export type PipelineSchemaId = keyof PipelineSchemaMap;

/**
 * Definition of a single step in a pipeline graph.
 *
 * The generic parameters bind the step's input and output to
 * specific contract types via PipelineSchemaMap.
 */
export interface StepDefinition<
  TIn extends PipelineSchemaId = PipelineSchemaId,
  TOut extends PipelineSchemaId = PipelineSchemaId,
> {
  /** Unique identifier for this step within the pipeline */
  readonly stepId: string;
  /** Human-readable description of what this step does */
  readonly description: string;
  /** Input schema identifier — must reference a contract type */
  readonly inputSchema: TIn;
  /** Output schema identifier — must reference a contract type */
  readonly outputSchema: TOut;
  /** Step IDs that must complete before this step runs */
  readonly upstreamDependencies: ReadonlyArray<string>;
  /** Target service endpoint for this step */
  readonly targetService: string;
  /** Retry configuration */
  readonly retryPolicy: RetryPolicy;
}

/**
 * Definition of a complete pipeline graph.
 */
export interface PipelineDefinition {
  /** Unique identifier for this pipeline */
  readonly pipelineId: string;
  /** Semantic version of this pipeline definition */
  readonly version: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of the pipeline's purpose */
  readonly description: string;
  /** Ordered list of step definitions */
  readonly steps: ReadonlyArray<StepDefinition>;
  /** Whether the pipeline is deterministic (no dynamic branching) */
  readonly deterministic: boolean;
}

// ============================================================================
// MVP REFERENCE PIPELINE
// ============================================================================

const decompose_request: StepDefinition<'BusinessRequest', 'DecomposedRequest'> = {
  stepId: 'decompose_request',
  description: 'Decompose a natural-language business request into structured sub-tasks and entities.',
  inputSchema: 'BusinessRequest',
  outputSchema: 'DecomposedRequest',
  upstreamDependencies: [],
  targetService: 'copilot/decomposer',
  retryPolicy: { maxRetries: 1 },
} as const;

const plan_solution: StepDefinition<'DecomposedRequest', 'SolutionPlan'> = {
  stepId: 'plan_solution',
  description: 'Generate a solution plan from the decomposed request, selecting services and parameters.',
  inputSchema: 'DecomposedRequest',
  outputSchema: 'SolutionPlan',
  upstreamDependencies: ['decompose_request'],
  targetService: 'copilot/planner',
  retryPolicy: { maxRetries: 1 },
} as const;

const generate_scaffold: StepDefinition<'SolutionPlan', 'SDKScaffold'> = {
  stepId: 'generate_scaffold',
  description: 'Generate an SDK scaffold and simulation configuration from the solution plan.',
  inputSchema: 'SolutionPlan',
  outputSchema: 'SDKScaffold',
  upstreamDependencies: ['plan_solution'],
  targetService: 'forge/sdk',
  retryPolicy: { maxRetries: 1 },
} as const;

const simulate_solution: StepDefinition<'SDKScaffold', 'SimulationResult'> = {
  stepId: 'simulate_solution',
  description: 'Execute the simulation scenario using the generated scaffold and configuration.',
  inputSchema: 'SDKScaffold',
  outputSchema: 'SimulationResult',
  upstreamDependencies: ['generate_scaffold'],
  targetService: 'simulator/scenario',
  retryPolicy: { maxRetries: 1 },
} as const;

const prepare_erp_artifact: StepDefinition<'SimulationResult', 'ERPDeploymentArtifact'> = {
  stepId: 'prepare_erp_artifact',
  description: 'Transform simulation output into a structured ERP deployment artifact.',
  inputSchema: 'SimulationResult',
  outputSchema: 'ERPDeploymentArtifact',
  upstreamDependencies: ['simulate_solution'],
  targetService: 'internal/transform',
  retryPolicy: { maxRetries: 1 },
} as const;

const push_to_erp_surface: StepDefinition<'ERPDeploymentArtifact', 'ERPSurfacePushResult'> = {
  stepId: 'push_to_erp_surface',
  description: 'Push the prepared ERP deployment artifact to the ERP surface for consumption.',
  inputSchema: 'ERPDeploymentArtifact',
  outputSchema: 'ERPSurfacePushResult',
  upstreamDependencies: ['prepare_erp_artifact'],
  targetService: 'erp-surface',
  retryPolicy: { maxRetries: 1 },
} as const;

const index_results: StepDefinition<'ERPSurfacePushResult', 'IndexConfirmation'> = {
  stepId: 'index_results',
  description: 'Persist pipeline results and metadata to the results index for querying.',
  inputSchema: 'ERPSurfacePushResult',
  outputSchema: 'IndexConfirmation',
  upstreamDependencies: ['push_to_erp_surface'],
  targetService: 'agentics-results-index',
  retryPolicy: { maxRetries: 1 },
} as const;

/**
 * MVP Reference Pipeline.
 *
 * A deterministic, sequential pipeline that converts a natural-language
 * business request into a structured ERP decision packet.
 *
 * Steps execute in strict order with no dynamic branching:
 *
 *   BusinessRequest
 *     → decompose_request    (copilot/decomposer)
 *     → plan_solution        (copilot/planner)
 *     → generate_scaffold    (forge/sdk)
 *     → simulate_solution    (simulator/scenario)
 *     → prepare_erp_artifact (internal/transform)
 *     → push_to_erp_surface  (erp-surface)
 *     → index_results        (agentics-results-index)
 *       → IndexConfirmation
 */
export const MVP_REFERENCE_PIPELINE: PipelineDefinition = {
  pipelineId: 'mvp_reference_pipeline',
  version: '1.0.0',
  name: 'MVP Reference Pipeline',
  description:
    'Deterministic sequential pipeline that converts a natural-language business request ' +
    'into a structured ERP decision packet. No dynamic branching or swarm execution.',
  deterministic: true,
  steps: [
    decompose_request,
    plan_solution,
    generate_scaffold,
    simulate_solution,
    prepare_erp_artifact,
    push_to_erp_surface,
    index_results,
  ],
} as const;
