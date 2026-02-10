/**
 * Core Client Interfaces.
 *
 * Defines the client contracts for communicating with external Agentics Cores.
 * Each Core client sends requests with propagated span context and validates
 * that responses contain proper nested span hierarchies.
 *
 * @module integration/cores/core-client
 */

import type {
  CoreRequest,
  CoreResponse,
  CoreName,
  SecurityCoreRequest,
  SecurityCoreResponse,
  DataCoreRequest,
  DataCoreResponse,
  AutomationCoreRequest,
  AutomationCoreResponse,
  GovernanceCoreRequest,
  GovernanceCoreResponse,
} from '../../types/core-delegation.js';

// ============================================================================
// CORE HEALTH
// ============================================================================

/**
 * Health status of a Core connection.
 */
export interface CoreHealth {
  readonly coreName: CoreName;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly lastSuccessfulCall?: string;
  readonly errors?: ReadonlyArray<string>;
}

// ============================================================================
// BASE CORE CLIENT INTERFACE
// ============================================================================

/**
 * Base interface for all external Agentics Core clients.
 *
 * Each Core client:
 * - Sends requests with propagated span context
 * - Validates that responses contain nested span hierarchies
 * - Rejects flat (non-hierarchical) results
 * - Reports health status
 */
export interface CoreClient<
  TRequest extends CoreRequest = CoreRequest,
  TResponse extends CoreResponse = CoreResponse,
> {
  /** The core this client connects to */
  readonly coreName: CoreName;

  /**
   * Calls the external Core with the given request.
   * MUST validate span hierarchy in response.
   * MUST throw CoreDelegationError if response has flat spans.
   */
  call(request: TRequest): Promise<TResponse>;

  /** Checks the health of the Core connection. */
  checkHealth(): Promise<CoreHealth>;
}

// ============================================================================
// PER-CORE CLIENT INTERFACES
// ============================================================================

/**
 * Client for LLM-Security-Core.
 * Handles policy evaluation in both pre-execution and post-execution phases.
 */
export interface SecurityCoreClient
  extends CoreClient<SecurityCoreRequest, SecurityCoreResponse> {
  readonly coreName: 'llm-security-core';
}

/**
 * Client for LLM-Data-Core.
 * Handles cost attribution and extended execution metrics.
 */
export interface DataCoreClient
  extends CoreClient<DataCoreRequest, DataCoreResponse> {
  readonly coreName: 'llm-data-core';
}

/**
 * Client for LLM-Automation-Core.
 * Handles artifact generation (reports, policy logs, audit trails).
 */
export interface AutomationCoreClient
  extends CoreClient<AutomationCoreRequest, AutomationCoreResponse> {
  readonly coreName: 'llm-automation-core';
}

/**
 * Client for LLM-Governance-Core.
 * Handles governance validation and compliance scoring.
 */
export interface GovernanceCoreClient
  extends CoreClient<GovernanceCoreRequest, GovernanceCoreResponse> {
  readonly coreName: 'llm-governance-core';
}

// ============================================================================
// CORE CLIENT REGISTRY
// ============================================================================

/**
 * Registry of all Core clients available to the simulation engine.
 * The engine requires all four clients to be present for execution.
 */
export interface CoreClientRegistry {
  readonly security: SecurityCoreClient;
  readonly data: DataCoreClient;
  readonly automation: AutomationCoreClient;
  readonly governance: GovernanceCoreClient;
}
