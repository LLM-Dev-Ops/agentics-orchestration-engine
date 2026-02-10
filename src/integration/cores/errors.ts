/**
 * Core Delegation Errors.
 *
 * Error types thrown when delegation to an external Agentics Core fails.
 * Follows the same pattern as SimulationEngineError and RuvectorClientError.
 *
 * @module integration/cores/errors
 */

import type { CoreName, SpanValidationResult } from '../../types/core-delegation.js';

// ============================================================================
// CORE DELEGATION ERROR
// ============================================================================

/**
 * Error thrown when a Core delegation fails.
 *
 * This can be thrown for:
 * - Flat span hierarchy (missing repo/agent spans)
 * - Core connection failure
 * - Core execution failure
 * - Response validation failure
 */
export class CoreDelegationError extends Error {
  readonly code: string;
  readonly coreName: CoreName;
  readonly details: string;
  readonly spanValidation?: SpanValidationResult;

  constructor(
    message: string,
    code: string,
    coreName: CoreName,
    details: string,
    spanValidation?: SpanValidationResult
  ) {
    super(message);
    this.name = 'CoreDelegationError';
    this.code = code;
    this.coreName = coreName;
    this.details = details;
    this.spanValidation = spanValidation;
  }
}
