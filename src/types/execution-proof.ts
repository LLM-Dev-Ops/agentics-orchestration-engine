/**
 * Execution Proof Types.
 *
 * Re-exports canonical types from @agentics/contracts.
 *
 * @module types/execution-proof
 */

export type {
  ExecutionLayer,
  LayerExecutionRecord,
  LayerOperation,
  ExecutionGraphNode,
  ExecutionGraphEdge,
  ExecutionGraph,
  ExecutionProof,
} from '@agentics/contracts';

export {
  MANDATORY_LAYERS,
  validateExecutionProof,
  createFailedExecutionProof,
} from '@agentics/contracts';
