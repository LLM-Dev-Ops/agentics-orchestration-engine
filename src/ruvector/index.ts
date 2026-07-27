/**
 * Ruvector Integration Module.
 *
 * Provides this service's synchronous link to Ruvector: execution acceptance
 * and lifecycle event emission. Per ADR-0001 this service does not subscribe
 * to decision events — agentics-execution-engine is the sole subscriber.
 *
 * @module ruvector
 */

// Types
export type {
  // Branded types
  PlanId,
  RuvectorEventId,
  // Event types
  DecisionEventType,
  ExecutionTier,
  ExecutionMode,
  ExecutionProfile,
  BaseDecisionEvent,
  PlanApprovedEvent,
  PlanRejectedEvent,
  PlanSupersededEvent,
  DecisionEvent,
  // Lifecycle event types
  ExecutionLifecycleEventType,
  BaseExecutionLifecycleEvent,
  SimulationExecutionStartedEvent,
  SimulationExecutionCompletedEvent,
  SimulationExecutionFailedEvent,
  SimulationExecutionCancelledEvent,
  ExecutionLifecycleEvent,
  // Configuration types
  RuvectorClientConfig,
  RuvectorConnectionStatus,
  // Execution acceptance protocol
  ExecutionAcceptanceRequest,
  ExecutionAcceptanceResponse,
} from './types.js';

// Type guards and factory functions
export {
  createPlanId,
  createRuvectorEventId,
  isPlanApprovedEvent,
  isExecutableEvent,
} from './types.js';

// Idempotency guard
export type {
  ExecutionRecord,
  IdempotencyCheckResult,
  IdempotencyGuardConfig,
} from './idempotency.js';
export {
  IdempotencyGuard,
  createIdempotencyGuard,
  DEFAULT_IDEMPOTENCY_CONFIG,
} from './idempotency.js';

// Ruvector client
export type {
  SecretManager,
  ConnectionStatusListener,
} from './client.js';
export {
  RuvectorClient,
  RuvectorClientError,
  EnvironmentSecretManager,
  createRuvectorClient,
  createConfigFromEnvironment,
} from './client.js';
