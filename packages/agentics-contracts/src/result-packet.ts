/**
 * Result Packet contract types.
 *
 * Defines the canonical shape of payloads sent to results-index.
 */

import type { ExecutionId, SimulationId, ContentHash } from './ids.js';
import type { ExecutionProof } from './execution-proof.js';
import type { ResultMetadata } from './simulation.js';

/**
 * Canonical result packet for results-index persistence.
 * Every field is REQUIRED — no optional fields allowed.
 */
export interface ResultPacket {
  readonly execution_id: ExecutionId;
  readonly simulation_id: SimulationId;
  readonly simulation_resolution: string;
  readonly metadata: ResultMetadata;
  readonly execution_proof: ExecutionProof;
  readonly environment: string;
}
