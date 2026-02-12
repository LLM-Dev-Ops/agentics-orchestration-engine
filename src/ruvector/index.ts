/**
 * Ruvector Integration Module.
 *
 * Provides the event-driven execution bridge between plan approval
 * in agentics-deployment-intent and simulation execution.
 *
 * Key components:
 * - RuvectorClient: Connects to Ruvector for event subscription
 * - ExecutionListener: Listens for plan_approved events and triggers execution
 * - IdempotencyGuard: Prevents duplicate plan executions
 *
 * This module is the FINAL EXECUTION WIRING step.
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
  DecisionEventListener,
  ConnectionStatusListener,
} from './client.js';
export {
  RuvectorClient,
  RuvectorClientError,
  EnvironmentSecretManager,
  createRuvectorClient,
  createConfigFromEnvironment,
} from './client.js';

// Execution listener
export type {
  SimulationResolver,
  ExecutionListenerConfig,
  ExecutionListenerStatus,
  ExecutionEvent,
  ExecutionEventListener,
} from './execution-listener.js';
export {
  ExecutionListener,
  createExecutionListener,
  createExecutionListenerFromEnvironment,
  InMemorySimulationResolver,
  createInMemorySimulationResolver,
} from './execution-listener.js';
