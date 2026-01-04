/**
 * Hashing utilities for the Agentics Simulation Engine.
 *
 * Provides SHA-256 hashing for determinism verification,
 * content integrity, and artifact signing.
 *
 * @module utils/hash
 */

import { createHash } from 'crypto';
import type { ContentHash } from '../types/common.js';
import { canonicalSerialize } from './serialize.js';

/**
 * Computes SHA-256 hash of a string.
 *
 * @param input - String to hash
 * @returns Hexadecimal hash string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Computes SHA-256 hash of a buffer.
 *
 * @param input - Buffer to hash
 * @returns Hexadecimal hash string
 */
export function sha256Buffer(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Creates a ContentHash from a string.
 *
 * @param input - String to hash
 * @returns ContentHash object
 */
export function createContentHash(input: string): ContentHash {
  return {
    algorithm: 'sha256',
    value: sha256(input),
  };
}

/**
 * Creates a ContentHash from a buffer.
 *
 * @param input - Buffer to hash
 * @returns ContentHash object
 */
export function createContentHashFromBuffer(input: Buffer): ContentHash {
  return {
    algorithm: 'sha256',
    value: sha256Buffer(input),
  };
}

/**
 * Creates a ContentHash from an object by serializing it canonically.
 * Uses canonical serialization to ensure deterministic hashing.
 *
 * @param obj - Object to hash
 * @returns ContentHash object
 */
export function createContentHashFromObject(obj: unknown): ContentHash {
  return createContentHash(canonicalSerialize(obj));
}

/**
 * Verifies that a ContentHash matches the expected value.
 *
 * @param hash - ContentHash to verify
 * @param input - String that should produce this hash
 * @returns True if hash matches
 */
export function verifyContentHash(hash: ContentHash, input: string): boolean {
  if (hash.algorithm !== 'sha256') {
    throw new Error(`Unsupported hash algorithm: ${hash.algorithm}`);
  }
  return sha256(input) === hash.value;
}

/**
 * Verifies that a ContentHash matches an object.
 *
 * @param hash - ContentHash to verify
 * @param obj - Object that should produce this hash
 * @returns True if hash matches
 */
export function verifyContentHashObject(hash: ContentHash, obj: unknown): boolean {
  const computed = createContentHashFromObject(obj);
  return computed.value === hash.value;
}

/**
 * Computes a deterministic hash from multiple inputs.
 * Useful for creating composite identifiers.
 *
 * @param inputs - Array of strings to hash together
 * @returns Hexadecimal hash string
 */
export function hashMultiple(...inputs: string[]): string {
  const combined = inputs.join('\x00'); // Use null byte as separator
  return sha256(combined);
}

/**
 * Derives a seeded value from arbitrary inputs.
 * Used for deterministic ID generation.
 *
 * @param inputs - Array of values to derive from
 * @returns Numeric seed value
 */
export function deriveSeededValue(...inputs: unknown[]): number {
  const serialized = inputs.map((i) => canonicalSerialize(i)).join('\x00');
  const hash = sha256(serialized);
  // Take first 8 characters of hex and convert to number
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Generates a deterministic simulation ID from configuration.
 *
 * @param scenarioId - Scenario identifier
 * @param version - Version string
 * @param parameters - Parameter object
 * @param seed - Optional seed override
 * @returns Simulation ID string
 */
export function generateSimulationId(
  scenarioId: string,
  version: string,
  parameters: Record<string, unknown>,
  seed?: number
): string {
  const input = [
    scenarioId,
    version,
    canonicalSerialize(parameters),
    seed?.toString() ?? 'default',
  ].join('\x00');

  const hash = sha256(input);
  // Use Base62-like encoding (alphanumeric) for shorter, URL-safe IDs
  const shortHash = hash.substring(0, 16);
  return `sim-${shortHash}`;
}

/**
 * Generates a deterministic event ID.
 *
 * @param simulationId - Simulation identifier
 * @param sequence - Event sequence number
 * @returns Event ID string
 */
export function generateEventId(simulationId: string, sequence: number): string {
  const input = `${simulationId}\x00${sequence}`;
  const hash = sha256(input);
  return hash.substring(0, 16);
}

/**
 * Generates a deterministic snapshot ID.
 *
 * @param simulationId - Simulation identifier
 * @param version - State version number
 * @returns Snapshot ID string
 */
export function generateSnapshotId(simulationId: string, version: number): string {
  const input = `${simulationId}\x00snapshot\x00${version}`;
  const hash = sha256(input);
  return `snap-${hash.substring(0, 12)}`;
}

/**
 * Generates a deterministic artifact ID.
 *
 * @param simulationId - Simulation identifier
 * @param artifactType - Type of artifact
 * @param index - Artifact index (for multiple of same type)
 * @returns Artifact ID string
 */
export function generateArtifactId(
  simulationId: string,
  artifactType: string,
  index: number = 0
): string {
  const input = `${simulationId}\x00artifact\x00${artifactType}\x00${index}`;
  const hash = sha256(input);
  return `art-${hash.substring(0, 12)}`;
}

/**
 * Computes a hash chain entry.
 * Used for audit trail integrity.
 *
 * @param previousHash - Hash of previous entry (empty string for first)
 * @param currentData - Current entry data
 * @returns Hash of current entry
 */
export function computeChainHash(previousHash: string, currentData: string): string {
  return sha256(`${previousHash}\x00${currentData}`);
}

/**
 * Verifies a hash chain.
 *
 * @param entries - Array of entries with previousHash and data
 * @returns True if chain is valid
 */
export function verifyHashChain(
  entries: ReadonlyArray<{ previousHash: string; data: string; hash: string }>
): boolean {
  let expectedPreviousHash = '';

  for (const entry of entries) {
    // Verify previous hash matches expected
    if (entry.previousHash !== expectedPreviousHash) {
      return false;
    }

    // Verify entry hash is correct
    const computedHash = computeChainHash(entry.previousHash, entry.data);
    if (computedHash !== entry.hash) {
      return false;
    }

    expectedPreviousHash = entry.hash;
  }

  return true;
}
