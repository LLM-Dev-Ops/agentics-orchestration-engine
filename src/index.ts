/**
 * Agentics Simulation Engine
 *
 * A deterministic, enterprise-grade decision simulation system that:
 * - Consumes normalized data from erp-surface (read-only)
 * - Applies policies and orchestration logic
 * - Generates counterfactual execution paths
 * - Produces implementation-ready artifacts
 * - Operates in complete isolation from production systems
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

// Version information
export const VERSION = '0.1.0';
export const ENGINE_NAME = 'agentics-simulation-engine';
