/**
 * Ruvector contract types.
 *
 * Defines the execution acceptance protocol between
 * the simulation engine and ruvector-service.
 */

import type { SimulationId, ExecutionId, ISOTimestamp, SpanId, TraceId } from './ids.js';

/**
 * Request to ruvector-service for execution acceptance.
 * The engine sends this to request permission to execute.
 * Ruvector mints the canonical execution_id if accepted.
 */
export interface ExecutionAcceptanceRequest {
  readonly simulation_id: SimulationId;
  readonly source: string;
  readonly scenario: {
    readonly scenario_id: string;
    readonly name: string;
    readonly category: string;
    readonly step_count: number;
  };
}

/**
 * Response from ruvector-service for execution acceptance.
 * Contains the canonical execution_id minted by ruvector.
 */
export interface ExecutionAcceptanceResponse {
  readonly accepted: boolean;
  readonly execution_id?: ExecutionId;
  readonly root_span_id?: SpanId;
  readonly trace_id?: TraceId;
  readonly simulation_resolution?: string;
  readonly rejection_reason?: string;
  readonly rejection_code?: string;
  readonly timestamp: ISOTimestamp;
}
