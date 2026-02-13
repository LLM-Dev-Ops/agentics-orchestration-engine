/**
 * @agentics/contracts
 *
 * Canonical type contracts for the Agentics platform.
 * All cross-service types, schemas, and validators live here.
 */

export * from './ids.js';
export * from './simulation.js';
export * from './execution-proof.js';
export * from './core-delegation.js';
export * from './trace.js';
export * from './artifact.js';
export * from './ruvector.js';
export * from './result-packet.js';
export {
  validateSimulateRequest,
  validateResultPacket,
  formatValidationErrors,
  type ContractValidationResult,
  type ContractValidationError,
} from './validator.js';
