/**
 * Contract Validator.
 *
 * Re-exports canonical validators from @agentics/contracts.
 * Keeps createContractViolationResponse locally (uses SERVICE_NAME constant).
 *
 * @module contracts/validator
 */

// Canonical validators and types from @agentics/contracts
export {
  validateSimulateRequest,
  validateResultPacket,
  formatValidationErrors,
} from '@agentics/contracts';

export type {
  ContractValidationResult,
  ContractValidationError,
} from '@agentics/contracts';

// ============================================================================
// LOCAL: Type guard and contract violation response builder
// ============================================================================

import type { ContractValidationError } from '@agentics/contracts';
import { formatValidationErrors } from '@agentics/contracts';

/**
 * Type guard for SimulateRequest after validation.
 * Use only after validateSimulateRequest returns valid: true.
 */
export function isValidSimulateRequest(data: unknown): data is {
  scenario: Record<string, unknown>;
  config?: Record<string, unknown>;
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    'scenario' in data &&
    typeof (data as Record<string, unknown>)['scenario'] === 'object'
  );
}

/**
 * Creates a structured error response for contract violations.
 * Includes execution_metadata for CLI contract compliance.
 *
 * @param errors - Array of validation errors
 * @returns Error response object with execution_metadata
 */
export function createContractViolationResponse(errors: ReadonlyArray<ContractValidationError>): {
  error: {
    code: string;
    message: string;
    details: {
      violations: ReadonlyArray<ContractValidationError>;
      schema: string;
    };
  };
  execution_metadata: {
    service: string;
    version: string;
    timestamp: string;
    simulation_id: null;
    status: 'error';
    error_code: string;
    error_phase: string;
  };
} {
  return {
    error: {
      code: 'CONTRACT_VIOLATION',
      message: `Request does not conform to simulation/v1/request.schema.json: ${formatValidationErrors(errors)}`,
      details: {
        violations: errors,
        schema: 'simulation/v1/request.schema.json',
      },
    },
    execution_metadata: {
      service: 'agentics-orchestration-engine',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      simulation_id: null,
      status: 'error',
      error_code: 'CONTRACT_VIOLATION',
      error_phase: 'validation',
    },
  };
}
