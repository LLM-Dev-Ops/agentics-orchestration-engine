/**
 * Execution Proof Types.
 *
 * Defines mandatory multi-layer execution proof structures
 * that must be included in every successful simulation response.
 *
 * @module types/execution-proof
 */

import type { ISOTimestamp, ContentHash } from './common.js';

// ============================================================================
// EXECUTION LAYERS
// ============================================================================

/**
 * Standard execution layers that form the multi-layer proof.
 * At minimum, foundational, intelligence, and core layers must be executed.
 */
export type ExecutionLayer =
  | 'foundational'    // Base infrastructure: context creation, clock setup, resource limits
  | 'intelligence'    // Smart processing: scenario analysis, policy evaluation, decision making
  | 'core'            // Core execution: step execution, state transitions, event recording
  | 'integration'     // External integrations: data sources, external APIs (optional)
  | 'artifact'        // Artifact generation: reports, traces, snapshots (optional)
  | 'validation';     // Post-execution validation: expectations, postconditions (optional)

/**
 * Mandatory layers that MUST be present in every valid execution proof.
 */
export const MANDATORY_LAYERS: ReadonlyArray<ExecutionLayer> = [
  'foundational',
  'intelligence',
  'core',
] as const;

// ============================================================================
// LAYER EXECUTION RECORD
// ============================================================================

/**
 * Record of a single layer's execution.
 */
export interface LayerExecutionRecord {
  /** The layer that was executed */
  readonly layer: ExecutionLayer;
  /** When the layer execution started */
  readonly startTime: ISOTimestamp;
  /** When the layer execution completed */
  readonly endTime: ISOTimestamp;
  /** Duration in milliseconds */
  readonly durationMs: number;
  /** Whether the layer completed successfully */
  readonly success: boolean;
  /** Error details if the layer failed */
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  /** Hash of the layer's input state */
  readonly inputHash: ContentHash;
  /** Hash of the layer's output state */
  readonly outputHash: ContentHash;
  /** Operations performed in this layer */
  readonly operations: ReadonlyArray<LayerOperation>;
}

/**
 * A single operation within a layer.
 */
export interface LayerOperation {
  readonly operationId: string;
  readonly type: string;
  readonly timestamp: ISOTimestamp;
  readonly durationMs: number;
  readonly success: boolean;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// EXECUTION GRAPH
// ============================================================================

/**
 * Node in the execution graph.
 */
export interface ExecutionGraphNode {
  readonly nodeId: string;
  readonly layer: ExecutionLayer;
  readonly operationType: string;
  readonly timestamp: ISOTimestamp;
  readonly durationMs: number;
  readonly inputRefs: ReadonlyArray<string>;
  readonly outputRefs: ReadonlyArray<string>;
  readonly stateHash: ContentHash;
}

/**
 * Edge in the execution graph.
 */
export interface ExecutionGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: 'data_flow' | 'control_flow' | 'dependency';
  readonly label?: string;
}

/**
 * Complete execution graph showing the flow of execution.
 */
export interface ExecutionGraph {
  readonly nodes: ReadonlyArray<ExecutionGraphNode>;
  readonly edges: ReadonlyArray<ExecutionGraphEdge>;
  readonly rootNodeId: string;
  readonly terminalNodeIds: ReadonlyArray<string>;
}

// ============================================================================
// EXECUTION PROOF
// ============================================================================

/**
 * Mandatory multi-layer execution proof.
 *
 * Every successful simulation response MUST include this proof
 * demonstrating that required layers were executed.
 */
export interface ExecutionProof {
  /**
   * List of layers that were executed, in execution order.
   * MUST include at least: foundational, intelligence, core
   */
  readonly layersExecuted: ReadonlyArray<ExecutionLayer>;

  /**
   * Detailed records for each executed layer.
   */
  readonly layerRecords: ReadonlyArray<LayerExecutionRecord>;

  /**
   * Optional full execution graph for detailed analysis.
   * Provides alternative proof when available.
   */
  readonly executionGraph?: ExecutionGraph;

  /**
   * Timestamp when proof was generated.
   */
  readonly proofGeneratedAt: ISOTimestamp;

  /**
   * Hash of the complete proof for integrity verification.
   */
  readonly proofHash: ContentHash;

  /**
   * Whether all mandatory layers were successfully executed.
   */
  readonly mandatoryLayersComplete: boolean;

  /**
   * Total execution time across all layers.
   */
  readonly totalExecutionMs: number;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates that an execution proof contains all mandatory layers.
 *
 * @param proof - The execution proof to validate
 * @returns Whether the proof is valid
 */
export function validateExecutionProof(proof: ExecutionProof): boolean {
  const executedLayers = new Set(proof.layersExecuted);

  for (const mandatory of MANDATORY_LAYERS) {
    if (!executedLayers.has(mandatory)) {
      return false;
    }
  }

  // Verify mandatoryLayersComplete flag matches actual state
  if (proof.mandatoryLayersComplete !== true) {
    return false;
  }

  // Verify at least one of: layersExecuted with mandatory layers OR executionGraph
  const hasRequiredLayers = MANDATORY_LAYERS.every((l) => executedLayers.has(l));
  const hasExecutionGraph = proof.executionGraph !== undefined &&
    proof.executionGraph.nodes.length > 0;

  return hasRequiredLayers || hasExecutionGraph;
}

/**
 * Creates an empty/failed execution proof for error responses.
 */
export function createFailedExecutionProof(
  error: { code: string; message: string },
  timestamp: ISOTimestamp,
  hash: ContentHash
): ExecutionProof {
  return {
    layersExecuted: [],
    layerRecords: [],
    proofGeneratedAt: timestamp,
    proofHash: hash,
    mandatoryLayersComplete: false,
    totalExecutionMs: 0,
  };
}
