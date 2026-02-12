/**
 * Agentics Orchestration Engine
 *
 * A pure orchestration and delegation layer that:
 * - Accepts scenarios and requests execution acceptance from ruvector
 * - Delegates ALL execution to downstream Agentics Cores
 * - Propagates spans under ruvector's root span
 * - Collates execution graphs from delegation results
 *
 * This service is a conductor, not an engine.
 * It MUST NOT mint execution_id or execute simulation logic internally.
 *
 * @packageDocumentation
 */

// Re-export all types
export * from './types/index.js';

// Re-export utilities
export * from './utils/index.js';

// Re-export error types
export * from './error/index.js';

// Re-export core modules
export * from './core/index.js';

// Re-export integration interfaces
export * from './integration/index.js';

// Re-export Ruvector event-driven execution bridge
export * from './ruvector/index.js';

// Re-export trace collection (with renamed exports to avoid conflicts)
export {
  TraceSpan as RuntimeTraceSpan,
  type SpanStatus as RuntimeSpanStatus,
  type SpanEvent as RuntimeSpanEvent,
  type TraceSpanData,
  type SpanLink,
  type SpanContext,
  createRootSpan,
  createChildSpan,
  extractSpanContext,
  withSpan,
  TraceCollector,
  type CollectedTraceEvent,
  type TraceEventCategory,
  type TraceQuery,
  type TraceQueryResult,
  type TraceCollectorConfig,
  type TraceExport,
  type TraceStatistics,
  type TraceEventListener,
  createTraceCollector,
  createConfiguredTraceCollector,
  DEFAULT_TRACE_CONFIG,
} from './trace/index.js';

// Re-export state management
export * from './state/index.js';

// Re-export scenario execution
export * from './scenario/index.js';

// Re-export policy engine (with renamed exports to avoid conflicts)
export {
  PolicyEngine,
  createPolicyEngine,
  PolicyEnforcementError,
  type PolicyEngineConfig,
  type PolicyStatistics,
  DEFAULT_POLICY_ENGINE_CONFIG,
  PolicyLoader,
  createPolicyLoader,
  type PolicySource as PolicyLoadSource,
  type PolicyLoadOptions,
  PolicyEvaluator,
  createPolicyEvaluator,
  type EvaluationOptions,
  PolicyContextBuilder,
  createPolicyContextBuilder,
  createMinimalContext,
  mergeContext,
  summarizeContext,
  PolicyExpressionEvaluator,
  ExpressionEvaluatorRegistry,
  createEvaluatorRegistry,
  getNestedValue,
  deepEquals as policyDeepEquals,
  matchesPattern,
  type ExpressionResult,
  type ExpressionValidationResult,
  JSONPathEvaluator,
  createJSONPathEvaluator,
} from './policy/index.js';

// Re-export artifact generation
export * from './artifact/index.js';

// Re-export core delegation (external Agentics Core interfaces)
export {
  type CoreClient,
  type SecurityCoreClient,
  type DataCoreClient,
  type AutomationCoreClient,
  type GovernanceCoreClient,
  type CoreClientRegistry,
  type CoreHealth,
  validateCoreSpanHierarchy,
  CoreDelegationError,
  MockSecurityCoreClient,
  MockDataCoreClient,
  MockAutomationCoreClient,
  MockGovernanceCoreClient,
  createMockCoreClientRegistry,
  type MockCoreConfig,
} from './integration/cores/index.js';

// Version information
export const VERSION = '0.2.0';
export const ENGINE_NAME = 'agentics-orchestration-engine';
