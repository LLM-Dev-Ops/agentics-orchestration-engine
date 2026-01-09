/**
 * Contract Validator.
 *
 * Provides strict Ajv-based JSON schema validation for API contracts.
 * Validates incoming requests at the earliest HTTP entry point,
 * before any engine initialization or execution begins.
 *
 * @module contracts/validator
 */

import Ajv, { ErrorObject, AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-compatible JSON loading: resolve path relative to source file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the JSON schema - try multiple locations for different environments
function loadSchema(): AnySchema {
  const schemaRelativePath = join('simulation', 'v1', 'request.schema.json');

  // Possible schema locations:
  // 1. Same directory as compiled code (Docker: dist/contracts/simulation/v1/)
  // 2. Source directory (local dev: src/contracts/simulation/v1/)
  const possiblePaths = [
    join(__dirname, schemaRelativePath),  // Docker: /app/dist/contracts/simulation/v1/
    join(__dirname, '..', '..', 'src', 'contracts', schemaRelativePath),  // Local dev
  ];

  for (const schemaPath of possiblePaths) {
    try {
      const content = readFileSync(schemaPath, 'utf-8');
      return JSON.parse(content) as AnySchema;
    } catch {
      // Try next path
    }
  }

  throw new Error(`Schema not found. Tried paths: ${possiblePaths.join(', ')}`);
}

const requestSchema = loadSchema();

// ============================================================================
// VALIDATION RESULT
// ============================================================================

/**
 * Result of contract validation.
 */
export interface ContractValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<ContractValidationError>;
}

/**
 * A single validation error with structured details.
 */
export interface ContractValidationError {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly keyword: string;
  readonly params?: Record<string, unknown>;
}

// ============================================================================
// CONTRACT VALIDATOR
// ============================================================================

/**
 * Singleton Ajv instance configured with strict validation.
 */
const ajv = new Ajv.default({
  strict: true,
  allErrors: true,
  verbose: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

// Add format validators (date-time, uri, email, etc.)
(addFormats as unknown as (ajv: Ajv.default) => void)(ajv);

/**
 * Compiled request schema validator.
 */
const validateRequestSchema = ajv.compile(requestSchema);

/**
 * Validates a simulation request against the contract schema.
 *
 * This validation MUST occur at the earliest HTTP entry point,
 * before any engine initialization, scenario loading, or execution begins.
 *
 * @param data - The parsed JSON request body
 * @returns Validation result with errors if invalid
 */
export function validateSimulateRequest(data: unknown): ContractValidationResult {
  const valid = validateRequestSchema(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ContractValidationError[] = (validateRequestSchema.errors ?? []).map((error: ErrorObject) => ({
    code: `SCHEMA_${error.keyword?.toUpperCase() ?? 'UNKNOWN'}`,
    message: error.message ?? 'Validation failed',
    path: error.instancePath || '/',
    keyword: error.keyword ?? 'unknown',
    params: error.params as Record<string, unknown> | undefined,
  }));

  return { valid: false, errors };
}

/**
 * Formats validation errors into a human-readable message.
 *
 * @param errors - Array of validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ReadonlyArray<ContractValidationError>): string {
  if (errors.length === 0) {
    return 'No errors';
  }

  return errors
    .map((e) => `${e.path}: ${e.message} (${e.code})`)
    .join('; ');
}

/**
 * Creates a structured error response for contract violations.
 *
 * @param errors - Array of validation errors
 * @returns Error response object
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
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

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
