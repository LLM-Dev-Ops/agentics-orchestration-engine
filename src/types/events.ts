/**
 * Event types for the Agentics Simulation Engine event sourcing system.
 *
 * All state changes in the simulation are captured as events for:
 * - Complete auditability
 * - Replay capability
 * - Determinism verification
 *
 * @module types/events
 */

import type {
  SimulationId,
  ScenarioId,
  PolicyId,
  StepId,
  EventId,
  SnapshotId,
  ArtifactId,
  CorrelationId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
} from './common.js';

// ============================================================================
// EVENT TYPE ENUMERATION
// ============================================================================

/**
 * All possible simulation event types.
 * These cover the complete lifecycle of a simulation.
 */
export type SimulationEventType =
  // Lifecycle events
  | 'SimulationStarted'
  | 'SimulationCompleted'
  | 'SimulationFailed'
  | 'SimulationPaused'
  | 'SimulationResumed'
  | 'SimulationCancelled'
  // Scenario events
  | 'ScenarioLoaded'
  | 'ScenarioValidated'
  | 'StepStarted'
  | 'StepCompleted'
  | 'StepFailed'
  | 'StepSkipped'
  // Policy events
  | 'PolicyLoaded'
  | 'PolicyEvaluated'
  | 'PolicyViolationDetected'
  // State events
  | 'StateInitialized'
  | 'StateChanged'
  | 'StateSnapshotCreated'
  | 'StateRolledBack'
  // Entity events
  | 'EntityCreated'
  | 'EntityUpdated'
  | 'EntityDeleted'
  // Artifact events
  | 'ArtifactGenerated'
  | 'ArtifactSigned'
  // Integration events
  | 'MockInvoked'
  | 'DataInjected'
  | 'ExternalDataFetched'
  // Error events
  | 'ErrorOccurred'
  | 'RecoveryAttempted';

// ============================================================================
// BASE EVENT INTERFACE
// ============================================================================

/**
 * Metadata attached to every event.
 */
export interface EventMetadata {
  /** Engine version that generated this event */
  readonly engineVersion: string;
  /** Environment where the simulation is running */
  readonly environment?: string;
  /** Additional custom metadata */
  readonly custom?: Readonly<Record<string, unknown>>;
}

/**
 * Base interface for all simulation events.
 * All events extend this interface.
 */
export interface BaseSimulationEvent<
  TType extends SimulationEventType = SimulationEventType,
  TPayload = unknown,
> {
  /** Unique identifier for this event */
  readonly eventId: EventId;
  /** Type discriminator for the event */
  readonly eventType: TType;
  /** When the event occurred (simulated time) */
  readonly timestamp: ISOTimestamp;
  /** Wall-clock time when event was recorded */
  readonly recordedAt: ISOTimestamp;
  /** Simulation this event belongs to */
  readonly simulationId: SimulationId;
  /** Monotonically increasing version for ordering */
  readonly version: number;
  /** Correlation ID for distributed tracing */
  readonly correlationId: CorrelationId;
  /** Event that caused this event (for causality chain) */
  readonly causationId?: EventId;
  /** Event-specific data */
  readonly payload: TPayload;
  /** Event metadata */
  readonly metadata: EventMetadata;
}

// ============================================================================
// LIFECYCLE EVENTS
// ============================================================================

/** Payload for SimulationStarted event */
export interface SimulationStartedPayload {
  readonly scenarioId: ScenarioId;
  readonly configHash: ContentHash;
  readonly initiator: {
    readonly type: 'user' | 'api' | 'scheduler' | 'system';
    readonly id: string;
    readonly name?: string;
  };
  readonly resourceLimits: {
    readonly maxExecutionTimeMs: number;
    readonly maxMemoryBytes: number;
  };
}

/** Simulation has started */
export interface SimulationStartedEvent
  extends BaseSimulationEvent<'SimulationStarted', SimulationStartedPayload> {}

/** Payload for SimulationCompleted event */
export interface SimulationCompletedPayload {
  readonly status: 'success' | 'partial_success';
  readonly durationMs: number;
  readonly stepsExecuted: number;
  readonly stepsPassed: number;
  readonly stepsFailed: number;
  readonly stepsSkipped: number;
  readonly policiesEvaluated: number;
  readonly policyViolations: number;
  readonly artifactsGenerated: number;
  readonly finalStateVersion: StateVersion;
  readonly resultHash: ContentHash;
}

/** Simulation completed successfully */
export interface SimulationCompletedEvent
  extends BaseSimulationEvent<'SimulationCompleted', SimulationCompletedPayload> {}

/** Payload for SimulationFailed event */
export interface SimulationFailedPayload {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly errorDetails?: unknown;
  readonly lastGoodStateVersion?: StateVersion;
  readonly recoverable: boolean;
  readonly stack?: string;
}

/** Simulation failed with an error */
export interface SimulationFailedEvent
  extends BaseSimulationEvent<'SimulationFailed', SimulationFailedPayload> {}

/** Payload for SimulationPaused event */
export interface SimulationPausedPayload {
  readonly reason: string;
  readonly pausedAt: StateVersion;
  readonly resumable: boolean;
}

/** Simulation was paused */
export interface SimulationPausedEvent
  extends BaseSimulationEvent<'SimulationPaused', SimulationPausedPayload> {}

/** Payload for SimulationResumed event */
export interface SimulationResumedPayload {
  readonly resumedFrom: StateVersion;
  readonly pauseDurationMs: number;
}

/** Simulation was resumed after pause */
export interface SimulationResumedEvent
  extends BaseSimulationEvent<'SimulationResumed', SimulationResumedPayload> {}

/** Payload for SimulationCancelled event */
export interface SimulationCancelledPayload {
  readonly reason: string;
  readonly requestedBy: string;
  readonly cleanupPerformed: boolean;
}

/** Simulation was cancelled */
export interface SimulationCancelledEvent
  extends BaseSimulationEvent<'SimulationCancelled', SimulationCancelledPayload> {}

// ============================================================================
// SCENARIO EVENTS
// ============================================================================

/** Payload for ScenarioLoaded event */
export interface ScenarioLoadedPayload {
  readonly scenarioId: ScenarioId;
  readonly scenarioVersion: string;
  readonly scenarioName: string;
  readonly totalSteps: number;
  readonly scenarioHash: ContentHash;
}

/** Scenario definition was loaded */
export interface ScenarioLoadedEvent
  extends BaseSimulationEvent<'ScenarioLoaded', ScenarioLoadedPayload> {}

/** Payload for ScenarioValidated event */
export interface ScenarioValidatedPayload {
  readonly scenarioId: ScenarioId;
  readonly valid: boolean;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }>;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }>;
}

/** Scenario was validated */
export interface ScenarioValidatedEvent
  extends BaseSimulationEvent<'ScenarioValidated', ScenarioValidatedPayload> {}

/** Payload for StepStarted event */
export interface StepStartedPayload {
  readonly stepId: StepId;
  readonly stepType: string;
  readonly stepIndex: number;
  readonly parallelGroup?: string;
  readonly input?: unknown;
}

/** A scenario step started execution */
export interface StepStartedEvent
  extends BaseSimulationEvent<'StepStarted', StepStartedPayload> {}

/** Payload for StepCompleted event */
export interface StepCompletedPayload {
  readonly stepId: StepId;
  readonly durationMs: number;
  readonly output?: unknown;
  readonly stateChanges: number;
  readonly assertions: {
    readonly passed: number;
    readonly failed: number;
  };
}

/** A scenario step completed successfully */
export interface StepCompletedEvent
  extends BaseSimulationEvent<'StepCompleted', StepCompletedPayload> {}

/** Payload for StepFailed event */
export interface StepFailedPayload {
  readonly stepId: StepId;
  readonly durationMs: number;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly retryAttempt: number;
  readonly maxRetries: number;
  readonly recoverable: boolean;
}

/** A scenario step failed */
export interface StepFailedEvent
  extends BaseSimulationEvent<'StepFailed', StepFailedPayload> {}

/** Payload for StepSkipped event */
export interface StepSkippedPayload {
  readonly stepId: StepId;
  readonly reason: 'condition_not_met' | 'dependency_failed' | 'policy_denied' | 'manual';
  readonly conditionExpression?: string;
  readonly conditionResult?: boolean;
}

/** A scenario step was skipped */
export interface StepSkippedEvent
  extends BaseSimulationEvent<'StepSkipped', StepSkippedPayload> {}

// ============================================================================
// POLICY EVENTS
// ============================================================================

/** Payload for PolicyLoaded event */
export interface PolicyLoadedPayload {
  readonly policyId: PolicyId;
  readonly policyVersion: string;
  readonly policyName: string;
  readonly enforcement: 'strict' | 'advisory' | 'audit';
  readonly ruleCount: number;
  readonly policyHash: ContentHash;
}

/** A policy was loaded */
export interface PolicyLoadedEvent
  extends BaseSimulationEvent<'PolicyLoaded', PolicyLoadedPayload> {}

/** Payload for PolicyEvaluated event */
export interface PolicyEvaluatedPayload {
  readonly policyId: PolicyId;
  readonly stepId?: StepId;
  readonly context: {
    readonly resourceType: string;
    readonly actionType: string;
    readonly environment: string;
  };
  readonly decision: {
    readonly outcome: 'allow' | 'deny' | 'warn' | 'require_approval';
    readonly reason: string;
    readonly matchedRule?: string;
  };
  readonly evaluationTimeMs: number;
}

/** A policy was evaluated */
export interface PolicyEvaluatedEvent
  extends BaseSimulationEvent<'PolicyEvaluated', PolicyEvaluatedPayload> {}

/** Payload for PolicyViolationDetected event */
export interface PolicyViolationDetectedPayload {
  readonly policyId: PolicyId;
  readonly ruleId: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly violationType: string;
  readonly description: string;
  readonly affectedEntity?: {
    readonly type: string;
    readonly id: string;
  };
  readonly remediation?: string;
}

/** A policy violation was detected */
export interface PolicyViolationDetectedEvent
  extends BaseSimulationEvent<'PolicyViolationDetected', PolicyViolationDetectedPayload> {}

// ============================================================================
// STATE EVENTS
// ============================================================================

/** Payload for StateInitialized event */
export interface StateInitializedPayload {
  readonly initialVersion: StateVersion;
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly stateHash: ContentHash;
}

/** Initial state was created */
export interface StateInitializedEvent
  extends BaseSimulationEvent<'StateInitialized', StateInitializedPayload> {}

/** Payload for StateChanged event */
export interface StateChangedPayload {
  readonly previousVersion: StateVersion;
  readonly newVersion: StateVersion;
  readonly changeType: 'set' | 'append' | 'remove' | 'increment';
  readonly path: string;
  readonly trigger: {
    readonly type: 'step' | 'policy' | 'system';
    readonly id?: string;
  };
}

/** State was mutated */
export interface StateChangedEvent
  extends BaseSimulationEvent<'StateChanged', StateChangedPayload> {}

/** Payload for StateSnapshotCreated event */
export interface StateSnapshotCreatedPayload {
  readonly snapshotId: SnapshotId;
  readonly stateVersion: StateVersion;
  readonly trigger: 'automatic' | 'manual' | 'checkpoint' | 'pre_risky_operation';
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
}

/** A state snapshot was created */
export interface StateSnapshotCreatedEvent
  extends BaseSimulationEvent<'StateSnapshotCreated', StateSnapshotCreatedPayload> {}

/** Payload for StateRolledBack event */
export interface StateRolledBackPayload {
  readonly fromVersion: StateVersion;
  readonly toVersion: StateVersion;
  readonly snapshotId: SnapshotId;
  readonly reason: string;
  readonly eventsDiscarded: number;
}

/** State was rolled back to a previous snapshot */
export interface StateRolledBackEvent
  extends BaseSimulationEvent<'StateRolledBack', StateRolledBackPayload> {}

// ============================================================================
// ENTITY EVENTS
// ============================================================================

/** Payload for EntityCreated event */
export interface EntityCreatedPayload {
  readonly entityType: string;
  readonly entityId: string;
  readonly initialState: unknown;
  readonly source: 'scenario' | 'injection' | 'step';
}

/** An entity was created in the simulation */
export interface EntityCreatedEvent
  extends BaseSimulationEvent<'EntityCreated', EntityCreatedPayload> {}

/** Payload for EntityUpdated event */
export interface EntityUpdatedPayload {
  readonly entityType: string;
  readonly entityId: string;
  readonly changes: ReadonlyArray<{
    readonly path: string;
    readonly previousValue: unknown;
    readonly newValue: unknown;
  }>;
  readonly trigger: string;
}

/** An entity was updated */
export interface EntityUpdatedEvent
  extends BaseSimulationEvent<'EntityUpdated', EntityUpdatedPayload> {}

/** Payload for EntityDeleted event */
export interface EntityDeletedPayload {
  readonly entityType: string;
  readonly entityId: string;
  readonly finalState: unknown;
  readonly reason: string;
}

/** An entity was deleted from the simulation */
export interface EntityDeletedEvent
  extends BaseSimulationEvent<'EntityDeleted', EntityDeletedPayload> {}

// ============================================================================
// ARTIFACT EVENTS
// ============================================================================

/** Payload for ArtifactGenerated event */
export interface ArtifactGeneratedPayload {
  readonly artifactId: ArtifactId;
  readonly artifactType: string;
  readonly format: string;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
  readonly generationTimeMs: number;
}

/** An artifact was generated */
export interface ArtifactGeneratedEvent
  extends BaseSimulationEvent<'ArtifactGenerated', ArtifactGeneratedPayload> {}

/** Payload for ArtifactSigned event */
export interface ArtifactSignedPayload {
  readonly artifactId: ArtifactId;
  readonly signatureAlgorithm: string;
  readonly keyId: string;
}

/** An artifact was signed */
export interface ArtifactSignedEvent
  extends BaseSimulationEvent<'ArtifactSigned', ArtifactSignedPayload> {}

// ============================================================================
// INTEGRATION EVENTS
// ============================================================================

/** Payload for MockInvoked event */
export interface MockInvokedPayload {
  readonly mockId: string;
  readonly service: string;
  readonly operation: string;
  readonly request: unknown;
  readonly response: unknown;
  readonly latencyMs: number;
  readonly wasError: boolean;
}

/** A mock service was invoked */
export interface MockInvokedEvent
  extends BaseSimulationEvent<'MockInvoked', MockInvokedPayload> {}

/** Payload for DataInjected event */
export interface DataInjectedPayload {
  readonly injectionId: string;
  readonly dataSource: string;
  readonly entityType: string;
  readonly recordCount: number;
  readonly dataHash: ContentHash;
}

/** Data was injected into the simulation */
export interface DataInjectedEvent
  extends BaseSimulationEvent<'DataInjected', DataInjectedPayload> {}

/** Payload for ExternalDataFetched event */
export interface ExternalDataFetchedPayload {
  readonly source: string;
  readonly query: unknown;
  readonly recordCount: number;
  readonly fetchTimeMs: number;
  readonly dataHash: ContentHash;
  readonly cached: boolean;
}

/** External data was fetched (from erp-surface, etc.) */
export interface ExternalDataFetchedEvent
  extends BaseSimulationEvent<'ExternalDataFetched', ExternalDataFetchedPayload> {}

// ============================================================================
// ERROR EVENTS
// ============================================================================

/** Payload for ErrorOccurred event */
export interface ErrorOccurredPayload {
  readonly errorClass: 'TRANSIENT' | 'RECOVERABLE' | 'POLICY_VIOLATION' | 'RESOURCE_EXHAUSTION' | 'FATAL';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly context: {
    readonly component: string;
    readonly operation: string;
    readonly stepId?: StepId;
  };
  readonly stack?: string;
}

/** An error occurred during simulation */
export interface ErrorOccurredEvent
  extends BaseSimulationEvent<'ErrorOccurred', ErrorOccurredPayload> {}

/** Payload for RecoveryAttempted event */
export interface RecoveryAttemptedPayload {
  readonly errorEventId: EventId;
  readonly recoveryStrategy: 'retry' | 'rollback' | 'skip' | 'fallback';
  readonly attemptNumber: number;
  readonly successful: boolean;
  readonly details?: string;
}

/** A recovery was attempted after an error */
export interface RecoveryAttemptedEvent
  extends BaseSimulationEvent<'RecoveryAttempted', RecoveryAttemptedPayload> {}

// ============================================================================
// UNION TYPE FOR ALL EVENTS
// ============================================================================

/**
 * Union type of all simulation events.
 * Use this when handling events generically.
 */
export type SimulationEvent =
  // Lifecycle
  | SimulationStartedEvent
  | SimulationCompletedEvent
  | SimulationFailedEvent
  | SimulationPausedEvent
  | SimulationResumedEvent
  | SimulationCancelledEvent
  // Scenario
  | ScenarioLoadedEvent
  | ScenarioValidatedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent
  // Policy
  | PolicyLoadedEvent
  | PolicyEvaluatedEvent
  | PolicyViolationDetectedEvent
  // State
  | StateInitializedEvent
  | StateChangedEvent
  | StateSnapshotCreatedEvent
  | StateRolledBackEvent
  // Entity
  | EntityCreatedEvent
  | EntityUpdatedEvent
  | EntityDeletedEvent
  // Artifact
  | ArtifactGeneratedEvent
  | ArtifactSignedEvent
  // Integration
  | MockInvokedEvent
  | DataInjectedEvent
  | ExternalDataFetchedEvent
  // Error
  | ErrorOccurredEvent
  | RecoveryAttemptedEvent;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if an event is a lifecycle event.
 */
export function isLifecycleEvent(
  event: SimulationEvent
): event is
  | SimulationStartedEvent
  | SimulationCompletedEvent
  | SimulationFailedEvent
  | SimulationPausedEvent
  | SimulationResumedEvent
  | SimulationCancelledEvent {
  return [
    'SimulationStarted',
    'SimulationCompleted',
    'SimulationFailed',
    'SimulationPaused',
    'SimulationResumed',
    'SimulationCancelled',
  ].includes(event.eventType);
}

/**
 * Type guard to check if an event is a scenario event.
 */
export function isScenarioEvent(
  event: SimulationEvent
): event is
  | ScenarioLoadedEvent
  | ScenarioValidatedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent {
  return [
    'ScenarioLoaded',
    'ScenarioValidated',
    'StepStarted',
    'StepCompleted',
    'StepFailed',
    'StepSkipped',
  ].includes(event.eventType);
}

/**
 * Type guard to check if an event is a policy event.
 */
export function isPolicyEvent(
  event: SimulationEvent
): event is PolicyLoadedEvent | PolicyEvaluatedEvent | PolicyViolationDetectedEvent {
  return ['PolicyLoaded', 'PolicyEvaluated', 'PolicyViolationDetected'].includes(
    event.eventType
  );
}

/**
 * Type guard to check if an event is a state event.
 */
export function isStateEvent(
  event: SimulationEvent
): event is
  | StateInitializedEvent
  | StateChangedEvent
  | StateSnapshotCreatedEvent
  | StateRolledBackEvent {
  return [
    'StateInitialized',
    'StateChanged',
    'StateSnapshotCreated',
    'StateRolledBack',
  ].includes(event.eventType);
}

/**
 * Type guard to check if an event is an error event.
 */
export function isErrorEvent(
  event: SimulationEvent
): event is ErrorOccurredEvent | RecoveryAttemptedEvent {
  return ['ErrorOccurred', 'RecoveryAttempted'].includes(event.eventType);
}
