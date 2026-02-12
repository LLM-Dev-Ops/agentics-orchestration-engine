/**
 * Common types for the Agentics Simulation Engine
 *
 * These are foundational types used throughout the system to ensure
 * type safety and prevent accidental type confusion.
 *
 * @module types/common
 */

// ============================================================================
// BRANDED TYPES (Type-safe nominal typing)
// ============================================================================

/**
 * Creates a branded/tagged type for nominal typing in TypeScript.
 * This prevents accidentally passing one ID type where another is expected.
 */
declare const __brand: unique symbol;
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

// ============================================================================
// IDENTIFIER TYPES
// ============================================================================

/** Unique identifier for a simulation run */
export type SimulationId = Brand<string, 'SimulationId'>;

/** Unique identifier for a scenario definition */
export type ScenarioId = Brand<string, 'ScenarioId'>;

/** Unique identifier for a policy definition */
export type PolicyId = Brand<string, 'PolicyId'>;

/** Unique identifier for a scenario step */
export type StepId = Brand<string, 'StepId'>;

/** Unique identifier for a trace span */
export type SpanId = Brand<string, 'SpanId'>;

/** Unique identifier for a trace */
export type TraceId = Brand<string, 'TraceId'>;

/** Unique identifier for an event */
export type EventId = Brand<string, 'EventId'>;

/** Unique identifier for a state snapshot */
export type SnapshotId = Brand<string, 'SnapshotId'>;

/** Unique identifier for an artifact */
export type ArtifactId = Brand<string, 'ArtifactId'>;

/** Unique identifier for a simulated agent */
export type AgentId = Brand<string, 'AgentId'>;

/** Unique identifier for a simulated resource */
export type ResourceId = Brand<string, 'ResourceId'>;

/** Correlation identifier for distributed tracing */
export type CorrelationId = Brand<string, 'CorrelationId'>;

/**
 * Canonical execution identifier minted by ruvector-service.
 * This is the ONLY valid execution ID in the system.
 * agentics-simulation-engine MUST NOT mint this - it comes from ruvector.
 */
export type ExecutionId = Brand<string, 'ExecutionId'>;

// ============================================================================
// TIMESTAMP AND DURATION TYPES
// ============================================================================

/**
 * ISO 8601 timestamp string.
 * All timestamps in the system use this format for consistency and determinism.
 * Example: "2026-01-04T12:00:00.000Z"
 */
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;

/**
 * ISO 8601 duration string.
 * Example: "PT1H30M" (1 hour 30 minutes)
 */
export type Duration = Brand<string, 'Duration'>;

// ============================================================================
// VERSION TYPES
// ============================================================================

/** State version number for event sourcing */
export type StateVersion = Brand<number, 'StateVersion'>;

/** Semantic version representation */
export interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly build?: string;
}

// ============================================================================
// HASH AND INTEGRITY TYPES
// ============================================================================

/**
 * Content hash for integrity verification.
 * Used for determinism verification and artifact signing.
 */
export interface ContentHash {
  readonly algorithm: 'sha256';
  readonly value: string;
}

/**
 * Digital signature for artifact verification.
 */
export interface Signature {
  readonly algorithm: 'ed25519' | 'rsa-sha256' | 'ecdsa-p256';
  readonly value: string;
  readonly keyId: string;
  readonly signedAt: ISOTimestamp;
}

// ============================================================================
// EXTERNAL REFERENCE TYPES
// ============================================================================

/**
 * Reference to an external system or resource.
 * Used for integration points with erp-surface, policy systems, etc.
 */
export interface ExternalReference {
  readonly type: string;
  readonly id: string;
  readonly version?: string;
  readonly uri?: string;
}

/**
 * Reference to an entity in an external system.
 */
export interface EntityReference {
  readonly entityType: string;
  readonly entityId: string;
  readonly sourceSystem?: string;
  readonly externalIds?: Readonly<Record<string, string>>;
}

// ============================================================================
// RESOURCE LIMITS (from Architecture Section 2.1)
// ============================================================================

/**
 * Resource constraints for simulation execution.
 * These limits ensure simulations don't consume excessive resources.
 */
export interface ResourceLimits {
  /** Maximum wall-clock execution time in milliseconds */
  readonly maxExecutionTimeMs: number;
  /** Maximum memory usage in bytes */
  readonly maxMemoryBytes: number;
  /** Maximum concurrent operations */
  readonly maxConcurrency: number;
  /** Maximum number of state snapshots to retain */
  readonly maxSnapshots: number;
  /** Maximum number of trace events to record */
  readonly maxTraceEvents: number;
}

/**
 * Default resource limits for simulations.
 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxExecutionTimeMs: 300_000, // 5 minutes
  maxMemoryBytes: 1_073_741_824, // 1 GB
  maxConcurrency: 10,
  maxSnapshots: 100,
  maxTraceEvents: 100_000,
} as const;

// ============================================================================
// TIMING CONFIGURATION
// ============================================================================

/**
 * Time mode for simulation execution.
 * - 'controlled': Time advances only when explicitly called (for determinism)
 * - 'accelerated': Time advances faster than real time
 * - 'real': Time advances at normal wall-clock speed
 */
export type TimeMode = 'controlled' | 'accelerated' | 'real';

/**
 * Timing configuration for simulation execution.
 */
export interface TimingConfig {
  /** Time advancement mode */
  readonly mode: TimeMode;
  /** Acceleration factor for 'accelerated' mode (e.g., 10 = 10x faster) */
  readonly accelerationFactor?: number;
  /** Step duration in milliseconds for 'controlled' mode */
  readonly stepDurationMs?: number;
  /** Simulated start time (ISO 8601) */
  readonly simulatedStartTime: ISOTimestamp;
}

// ============================================================================
// DATE RANGE TYPE
// ============================================================================

/**
 * A date range for temporal queries.
 */
export interface DateRange {
  readonly start: ISOTimestamp;
  readonly end: ISOTimestamp;
}

// ============================================================================
// FACTORY FUNCTIONS FOR BRANDED TYPES
// ============================================================================

/**
 * Creates a SimulationId from a string.
 * In production, this would validate the format.
 */
export function createSimulationId(value: string): SimulationId {
  return value as SimulationId;
}

/**
 * Creates a ScenarioId from a string.
 */
export function createScenarioId(value: string): ScenarioId {
  return value as ScenarioId;
}

/**
 * Creates a PolicyId from a string.
 */
export function createPolicyId(value: string): PolicyId {
  return value as PolicyId;
}

/**
 * Creates a StepId from a string.
 */
export function createStepId(value: string): StepId {
  return value as StepId;
}

/**
 * Creates a SpanId from a string.
 */
export function createSpanId(value: string): SpanId {
  return value as SpanId;
}

/**
 * Creates a TraceId from a string.
 */
export function createTraceId(value: string): TraceId {
  return value as TraceId;
}

/**
 * Creates an EventId from a string.
 */
export function createEventId(value: string): EventId {
  return value as EventId;
}

/**
 * Creates a SnapshotId from a string.
 */
export function createSnapshotId(value: string): SnapshotId {
  return value as SnapshotId;
}

/**
 * Creates an ArtifactId from a string.
 * If no value is provided, generates a random UUID.
 */
export function createArtifactId(value?: string): ArtifactId {
  if (value) {
    return value as ArtifactId;
  }
  // Generate a random UUID v4
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `artifact-${uuid}` as ArtifactId;
}

/**
 * Creates an AgentId from a string.
 */
export function createAgentId(value: string): AgentId {
  return value as AgentId;
}

/**
 * Creates a ResourceId from a string.
 */
export function createResourceId(value: string): ResourceId {
  return value as ResourceId;
}

/**
 * Creates a CorrelationId from a string.
 */
export function createCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

/**
 * Creates an ExecutionId from a string.
 * ONLY ruvector-service should mint these. This factory is for deserializing
 * ruvector-minted IDs, NOT for generating new ones locally.
 */
export function createExecutionId(value: string): ExecutionId {
  return value as ExecutionId;
}

/**
 * Creates an ISOTimestamp from a Date or string.
 */
export function createISOTimestamp(value: Date | string): ISOTimestamp {
  if (typeof value === 'string') {
    return value as ISOTimestamp;
  }
  return value.toISOString() as ISOTimestamp;
}

/**
 * Creates a Duration from a string.
 */
export function createDuration(value: string): Duration {
  return value as Duration;
}

/**
 * Creates a StateVersion from a number.
 */
export function createStateVersion(value: number): StateVersion {
  return value as StateVersion;
}

/**
 * Gets the current time as an ISOTimestamp.
 * NOTE: In simulation context, use SimulatedClock instead for determinism.
 */
export function now(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

// ============================================================================
// SEMANTIC VERSION UTILITIES
// ============================================================================

/**
 * Parses a semantic version string into a SemanticVersion object.
 */
export function parseSemanticVersion(version: string): SemanticVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    prerelease: match[4],
    build: match[5],
  };
}

/**
 * Formats a SemanticVersion object as a string.
 */
export function formatSemanticVersion(version: SemanticVersion): string {
  let result = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease) {
    result += `-${version.prerelease}`;
  }
  if (version.build) {
    result += `+${version.build}`;
  }
  return result;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid ISOTimestamp format.
 */
export function isISOTimestamp(value: unknown): value is ISOTimestamp {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !isNaN(date.getTime()) && value === date.toISOString();
}

/**
 * Type guard to check if a value is a valid ContentHash.
 */
export function isContentHash(value: unknown): value is ContentHash {
  if (typeof value !== 'object' || value === null) return false;
  const hash = value as Record<string, unknown>;
  return hash['algorithm'] === 'sha256' && typeof hash['value'] === 'string';
}
