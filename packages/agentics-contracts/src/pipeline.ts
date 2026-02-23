/**
 * Pipeline payload schemas.
 *
 * Canonical payload types for deterministic pipeline step I/O.
 * These schemas define the data shapes that flow between steps
 * in orchestration pipelines.
 *
 * @module types/pipeline
 */

import type {
  SimulationId,
  ArtifactId,
  ExecutionId,
  ISOTimestamp,
  ContentHash,
} from './ids.js';
import type { SimulationConfig } from './simulation.js';
import type { Artifact } from './artifact.js';

// ============================================================================
// PIPELINE ENTRY
// ============================================================================

/**
 * Natural-language business request that enters the pipeline.
 */
export interface BusinessRequest {
  readonly requestId: string;
  readonly naturalLanguageInput: string;
  readonly domain: string;
  readonly requester: {
    readonly id: string;
    readonly role: string;
  };
  readonly constraints?: Readonly<Record<string, unknown>>;
  readonly submittedAt: ISOTimestamp;
}

// ============================================================================
// DECOMPOSITION
// ============================================================================

/**
 * Decomposed business request — output of copilot/decomposer.
 */
export interface DecomposedRequest {
  readonly requestId: string;
  readonly originalInput: string;
  readonly intent: string;
  readonly entities: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly value: string;
  }>;
  readonly subTasks: ReadonlyArray<{
    readonly taskId: string;
    readonly description: string;
    readonly priority: number;
    readonly dependencies: ReadonlyArray<string>;
  }>;
  readonly decomposedAt: ISOTimestamp;
}

// ============================================================================
// PLANNING
// ============================================================================

/**
 * Solution plan — output of copilot/planner.
 */
export interface SolutionPlan {
  readonly planId: string;
  readonly requestId: string;
  readonly steps: ReadonlyArray<{
    readonly stepId: string;
    readonly action: string;
    readonly service: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly expectedOutcome: string;
  }>;
  readonly estimatedResources: Readonly<Record<string, number>>;
  readonly plannedAt: ISOTimestamp;
}

// ============================================================================
// SCAFFOLD GENERATION
// ============================================================================

/**
 * SDK scaffold — output of forge/sdk.
 */
export interface SDKScaffold {
  readonly scaffoldId: string;
  readonly planId: string;
  readonly simulationConfig: SimulationConfig;
  readonly generatedModules: ReadonlyArray<{
    readonly moduleId: string;
    readonly moduleName: string;
    readonly entryPoint: string;
    readonly configHash: ContentHash;
  }>;
  readonly generatedAt: ISOTimestamp;
}

// ============================================================================
// ERP ARTIFACTS
// ============================================================================

/**
 * ERP deployment artifact — produced by transforming simulation output.
 */
export interface ERPDeploymentArtifact {
  readonly artifactId: ArtifactId;
  readonly simulationId: SimulationId;
  readonly artifact: Artifact;
  readonly deploymentManifest: {
    readonly targetSystem: string;
    readonly version: string;
    readonly modules: ReadonlyArray<{
      readonly moduleId: string;
      readonly moduleName: string;
      readonly configPayload: Readonly<Record<string, unknown>>;
    }>;
    readonly validationStatus: 'validated' | 'pending' | 'failed';
  };
  readonly simulationOutcome: string;
  readonly preparedAt: ISOTimestamp;
}

/**
 * Result of pushing an artifact to the ERP surface.
 */
export interface ERPSurfacePushResult {
  readonly pushId: string;
  readonly artifactId: ArtifactId;
  readonly targetSurface: string;
  readonly status: 'accepted' | 'rejected' | 'pending_review';
  readonly erpReference?: string;
  readonly pushedAt: ISOTimestamp;
}

// ============================================================================
// INDEXING
// ============================================================================

/**
 * Confirmation that results have been indexed.
 */
export interface IndexConfirmation {
  readonly indexId: string;
  readonly executionId: ExecutionId;
  readonly simulationId: SimulationId;
  readonly indexedAt: ISOTimestamp;
  readonly recordCount: number;
  readonly indexHash: ContentHash;
}
