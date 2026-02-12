/**
 * Core module exports.
 *
 * The orchestration engine is a pure delegation layer.
 * It does NOT execute simulation logic internally.
 *
 * @module core
 */

export * from './isolation/index.js';
export * from './determinism/index.js';
export * from './resources/index.js';
export * from './lifecycle.js';
export * from './context.js';
export * from './validation.js';
export {
  OrchestrationEngine,
  OrchestrationError,
  SimulationEngineError,
  createOrchestrationEngine,
  createSimulationEngine,
  type OrchestrationConfig,
  type OrchestrationResult,
  type DelegationRecord,
} from './engine.js';
