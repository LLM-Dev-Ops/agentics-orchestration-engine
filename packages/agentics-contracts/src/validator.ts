/**
 * Contract Validator.
 *
 * Provides strict Ajv-based JSON schema validation for API contracts.
 */

import Ajv, { ErrorObject, AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadSchema(relativePath: string): AnySchema {
  const possiblePaths = [
    join(__dirname, relativePath),
    join(__dirname, '..', 'src', relativePath),
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

const requestSchema = loadSchema(join('schemas', 'simulation', 'v1', 'request.schema.json'));
const resultPacketSchema = loadSchema(join('schemas', 'simulation', 'v1', 'result-packet.schema.json'));

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

const ajv = new Ajv.default({
  strict: true,
  allErrors: true,
  verbose: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

(addFormats as unknown as (ajv: Ajv.default) => void)(ajv);

const validateRequestSchema = ajv.compile(requestSchema);
const validateResultPacketSchema = ajv.compile(resultPacketSchema);

function mapErrors(errors: ErrorObject[] | null | undefined): ContractValidationError[] {
  return (errors ?? []).map((error: ErrorObject) => ({
    code: `SCHEMA_${error.keyword?.toUpperCase() ?? 'UNKNOWN'}`,
    message: error.message ?? 'Validation failed',
    path: error.instancePath || '/',
    keyword: error.keyword ?? 'unknown',
    params: error.params as Record<string, unknown> | undefined,
  }));
}

/**
 * Validates a simulation request against the contract schema.
 */
export function validateSimulateRequest(data: unknown): ContractValidationResult {
  const valid = validateRequestSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: mapErrors(validateRequestSchema.errors) };
}

/**
 * Validates a result packet against the contract schema.
 */
export function validateResultPacket(data: unknown): ContractValidationResult {
  const valid = validateResultPacketSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: mapErrors(validateResultPacketSchema.errors) };
}

/**
 * Formats validation errors into a human-readable message.
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
 * Type guard for SimulateRequest after validation.
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
