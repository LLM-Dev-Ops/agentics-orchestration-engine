/**
 * Policy types for the Agentics Simulation Engine.
 *
 * Policies define governance rules that are evaluated during simulation.
 * They determine what actions are allowed, denied, or require approval.
 *
 * @module types/policy
 */

import type {
  PolicyId,
  ISOTimestamp,
  SemanticVersion,
  ContentHash,
} from './common.js';

// ============================================================================
// ENFORCEMENT LEVELS
// ============================================================================

/**
 * How strictly a policy is enforced.
 * - strict: Violations block execution
 * - advisory: Violations are logged but don't block
 * - audit: Only record violations, no enforcement
 */
export type EnforcementLevel = 'strict' | 'advisory' | 'audit';

// ============================================================================
// POLICY DECISIONS
// ============================================================================

/**
 * Possible outcomes of a policy evaluation.
 */
export type PolicyOutcome = 'allow' | 'deny' | 'warn' | 'require_approval';

/**
 * A decision made by a policy evaluation.
 */
export interface PolicyDecision {
  /** The outcome of the evaluation */
  readonly outcome: PolicyOutcome;
  /** Human-readable reason for the decision */
  readonly reason: string;
  /** Suggested remediation if denied or warned */
  readonly remediation?: string;
  /** Additional context about the decision */
  readonly context?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// POLICY EXPRESSIONS
// ============================================================================

/**
 * A policy expression using Rego (OPA).
 */
export interface RegoExpression {
  readonly lang: 'rego';
  readonly code: string;
  readonly package?: string;
}

/**
 * A policy expression using CEL (Common Expression Language).
 */
export interface CELExpression {
  readonly lang: 'cel';
  readonly code: string;
}

/**
 * A policy expression using JSONPath.
 */
export interface JSONPathExpression {
  readonly lang: 'jsonpath';
  readonly expression: string;
  readonly operator: 'equals' | 'not_equals' | 'contains' | 'matches' | 'exists' | 'not_exists';
  readonly value?: unknown;
}

/**
 * A custom policy expression.
 */
export interface CustomExpression {
  readonly lang: 'custom';
  readonly evaluator: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * Union of all policy expression types.
 */
export type PolicyExpression =
  | RegoExpression
  | CELExpression
  | JSONPathExpression
  | CustomExpression;

// ============================================================================
// POLICY APPLICABILITY
// ============================================================================

/**
 * Defines when a policy applies to an evaluation context.
 */
export interface PolicyApplicability {
  /** Resource types this policy applies to */
  readonly resourceTypes?: ReadonlyArray<string>;
  /** Action types this policy applies to */
  readonly actionTypes?: ReadonlyArray<string>;
  /** Environments this policy applies to */
  readonly environments?: ReadonlyArray<string>;
  /** Custom expression for complex applicability rules */
  readonly expression?: PolicyExpression;
}

// ============================================================================
// POLICY RULES
// ============================================================================

/**
 * A single rule within a policy.
 */
export interface PolicyRule {
  /** Unique identifier for this rule within the policy */
  readonly ruleId: string;
  /** Human-readable name */
  readonly name?: string;
  /** Description of what this rule checks */
  readonly description: string;
  /** Condition expression to evaluate */
  readonly condition: PolicyExpression;
  /** Decision to return if condition matches */
  readonly decision: PolicyDecision;
  /** Priority for rule ordering (higher = evaluated first) */
  readonly priority: number;
  /** Whether this rule is enabled */
  readonly enabled?: boolean;
  /** Tags for categorization */
  readonly tags?: ReadonlyArray<string>;
}

// ============================================================================
// POLICY METADATA
// ============================================================================

/**
 * Metadata about a policy.
 */
export interface PolicyMetadata {
  /** Policy author */
  readonly author?: string;
  /** Creation timestamp */
  readonly createdAt?: ISOTimestamp;
  /** Last modified timestamp */
  readonly updatedAt?: ISOTimestamp;
  /** Source of the policy (e.g., file path, registry URL) */
  readonly source?: string;
  /** Custom metadata */
  readonly custom?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// POLICY DEFINITION
// ============================================================================

/**
 * Complete policy definition.
 */
export interface Policy {
  /** Unique identifier for this policy */
  readonly policyId: PolicyId;
  /** Version of this policy */
  readonly version: SemanticVersion;
  /** Human-readable name */
  readonly name: string;
  /** Detailed description */
  readonly description: string;
  /** Enforcement level */
  readonly enforcement: EnforcementLevel;
  /** When this policy applies */
  readonly applicability: PolicyApplicability;
  /** Rules in this policy */
  readonly rules: ReadonlyArray<PolicyRule>;
  /** Default decision if no rules match */
  readonly defaultDecision: PolicyDecision;
  /** Policy metadata */
  readonly metadata: PolicyMetadata;
  /** Content hash for integrity verification */
  readonly contentHash?: ContentHash;
}

// ============================================================================
// COMPILED POLICY
// ============================================================================

/**
 * A policy rule that has been compiled for evaluation.
 */
export interface CompiledRule {
  /** Original rule definition */
  readonly rule: PolicyRule;
  /** Compiled evaluator function */
  readonly evaluate: (context: PolicyEvaluationContext) => PolicyRuleResult;
}

/**
 * A policy that has been loaded and compiled for evaluation.
 */
export interface CompiledPolicy {
  /** Original policy definition */
  readonly policy: Policy;
  /** Compiled rules in priority order */
  readonly compiledRules: ReadonlyArray<CompiledRule>;
}

// ============================================================================
// POLICY EVALUATION CONTEXT
// ============================================================================

/**
 * Context provided to policy evaluation.
 * Contains all information needed to make a policy decision.
 */
export interface PolicyEvaluationContext {
  // Action context
  /** Type of action being performed */
  readonly actionType: string;
  /** Action-specific configuration */
  readonly actionConfig?: Readonly<Record<string, unknown>>;

  // Resource context
  /** Type of resource being acted upon */
  readonly resourceType: string;
  /** Resource identifier */
  readonly resourceId?: string;
  /** Resource attributes */
  readonly resourceAttributes?: Readonly<Record<string, unknown>>;

  // Environment context
  /** Current environment */
  readonly environment: string;
  /** Simulation identifier */
  readonly simulationId: string;
  /** Current simulated time */
  readonly simulatedTime: ISOTimestamp;

  // State context
  /** Read-only view of current state */
  readonly currentState?: Readonly<Record<string, unknown>>;
  /** History of previous policy decisions */
  readonly previousDecisions?: ReadonlyArray<PolicyDecisionRecord>;

  // Entity context
  /** Actor performing the action */
  readonly actor?: {
    readonly type: string;
    readonly id: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
  /** Target entities of the action */
  readonly targetEntities?: ReadonlyArray<{
    readonly type: string;
    readonly id: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
  }>;

  // Custom attributes
  /** Additional custom attributes for policy evaluation */
  readonly customAttributes?: Readonly<Record<string, unknown>>;
}

/**
 * Record of a previous policy decision.
 */
export interface PolicyDecisionRecord {
  readonly policyId: PolicyId;
  readonly timestamp: ISOTimestamp;
  readonly decision: PolicyDecision;
  readonly context: {
    readonly actionType: string;
    readonly resourceType: string;
  };
}

// ============================================================================
// POLICY EVALUATION RESULTS
// ============================================================================

/**
 * Result of evaluating a single rule.
 */
export interface PolicyRuleResult {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly decision?: PolicyDecision;
  readonly evaluationTimeMs: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Result of evaluating a single policy.
 */
export interface PolicyEvaluationResult {
  readonly policyId: PolicyId;
  readonly matchedRule: string | null;
  readonly decision: PolicyDecision;
  readonly evaluationTimeMs: number;
  readonly ruleResults: ReadonlyArray<PolicyRuleResult>;
}

/**
 * Aggregated result of evaluating all applicable policies.
 */
export interface AggregatedPolicyResult {
  /** Final outcome after considering all policies */
  readonly outcome: PolicyOutcome;
  /** Reason for the final outcome */
  readonly reason: string;
  /** Rules that were applied */
  readonly appliedRules: ReadonlyArray<{
    readonly policyId: PolicyId;
    readonly ruleId: string;
    readonly decision: PolicyDecision;
  }>;
  /** Results for each evaluated policy */
  readonly evaluationResults: ReadonlyArray<PolicyEvaluationResult>;
  /** Total evaluation time */
  readonly totalEvaluationTimeMs: number;
}

// ============================================================================
// POLICY SET
// ============================================================================

/**
 * A set of policies loaded for evaluation.
 */
export interface PolicySet {
  /** Policies in this set */
  readonly policies: ReadonlyArray<Policy>;
  /** Version identifier for the set */
  readonly version: string;
  /** When this policy set becomes effective */
  readonly effectiveDate: ISOTimestamp;
  /** Source of the policy set */
  readonly source: string;
}

// ============================================================================
// POLICY VALIDATION
// ============================================================================

/**
 * Result of policy validation.
 */
export interface PolicyValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly ruleId?: string;
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly ruleId?: string;
  }>;
}
