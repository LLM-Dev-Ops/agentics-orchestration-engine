/**
 * Common types for the Agentics Simulation Engine.
 *
 * Re-exports canonical types from @agentics/contracts.
 *
 * @module types/common
 */

// All branded types, factory functions, constants, and type guards
// are canonical in @agentics/contracts.
export type {
  SimulationId,
  ScenarioId,
  PolicyId,
  StepId,
  SpanId,
  TraceId,
  EventId,
  SnapshotId,
  ArtifactId,
  AgentId,
  ResourceId,
  CorrelationId,
  ExecutionId,
  ISOTimestamp,
  Duration,
  StateVersion,
  SemanticVersion,
  ContentHash,
  Signature,
  ExternalReference,
  EntityReference,
  ResourceLimits,
  TimeMode,
  TimingConfig,
  DateRange,
} from '@agentics/contracts';

export {
  DEFAULT_RESOURCE_LIMITS,
  createSimulationId,
  createScenarioId,
  createPolicyId,
  createStepId,
  createSpanId,
  createTraceId,
  createEventId,
  createSnapshotId,
  createArtifactId,
  createAgentId,
  createResourceId,
  createCorrelationId,
  createExecutionId,
  createISOTimestamp,
  createDuration,
  createStateVersion,
  now,
  parseSemanticVersion,
  formatSemanticVersion,
  isISOTimestamp,
  isContentHash,
} from '@agentics/contracts';
