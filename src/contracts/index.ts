/**
 * @agentics/contracts
 *
 * Contract validation module for the Agentics Simulation Engine.
 * Provides strict JSON schema validation at API boundaries.
 *
 * @module contracts
 */

export {
  validateSimulateRequest,
  formatValidationErrors,
  createContractViolationResponse,
  isValidSimulateRequest,
  type ContractValidationResult,
  type ContractValidationError,
} from './validator.js';
