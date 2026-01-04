/**
 * Policy Evaluator.
 *
 * Evaluates policies against contexts and aggregates results.
 * Handles rule ordering, short-circuiting, and decision aggregation.
 *
 * @module policy/evaluator
 */

import type { PolicyId, ISOTimestamp } from '../types/common.js';
import type {
  Policy,
  CompiledPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  PolicyRuleResult,
  PolicyDecision,
  AggregatedPolicyResult,
  PolicyOutcome,
  PolicyApplicability,
} from '../types/policy.js';
import {
  ExpressionEvaluatorRegistry,
  createEvaluatorRegistry,
} from './languages/base.js';
import { createJSONPathEvaluator } from './languages/jsonpath.js';

// ============================================================================
// EVALUATION OPTIONS
// ============================================================================

/**
 * Options for policy evaluation.
 */
export interface EvaluationOptions {
  /** Stop on first deny decision (default: true for strict enforcement) */
  readonly shortCircuitOnDeny?: boolean;
  /** Include results for non-matching rules */
  readonly includeNonMatching?: boolean;
  /** Maximum evaluation time before timeout (ms) */
  readonly timeoutMs?: number;
  /** Get current time for evaluation timing */
  readonly getTime?: () => ISOTimestamp;
}

// ============================================================================
// POLICY EVALUATOR CLASS
// ============================================================================

/**
 * Evaluates policies against contexts.
 *
 * Key features:
 * - Priority-ordered rule evaluation
 * - Short-circuit evaluation on deny
 * - Applicability filtering
 * - Decision aggregation
 */
export class PolicyEvaluator {
  private readonly evaluatorRegistry: ExpressionEvaluatorRegistry;
  private readonly getTime: () => ISOTimestamp;

  constructor(
    evaluatorRegistry?: ExpressionEvaluatorRegistry,
    getTime?: () => ISOTimestamp
  ) {
    this.evaluatorRegistry = evaluatorRegistry ?? this.createDefaultRegistry();
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  /**
   * Creates default evaluator registry.
   */
  private createDefaultRegistry(): ExpressionEvaluatorRegistry {
    const registry = createEvaluatorRegistry();
    registry.register(createJSONPathEvaluator());
    return registry;
  }

  // ==========================================================================
  // SINGLE POLICY EVALUATION
  // ==========================================================================

  /**
   * Evaluates a single policy against a context.
   *
   * @param policy - Policy to evaluate (raw or compiled)
   * @param context - Evaluation context
   * @param options - Evaluation options
   * @returns Evaluation result
   */
  evaluate(
    policy: Policy | CompiledPolicy,
    context: PolicyEvaluationContext,
    options: EvaluationOptions = {}
  ): PolicyEvaluationResult {
    const startTime = performance.now();

    // Get compiled rules or compile on the fly
    const compiledPolicy = this.ensureCompiled(policy);
    const rules = compiledPolicy.compiledRules;

    const ruleResults: PolicyRuleResult[] = [];
    let matchedRule: string | null = null;
    let decision: PolicyDecision = compiledPolicy.policy.defaultDecision;

    // Evaluate rules in priority order (already sorted in compiled policy)
    for (const compiled of rules) {
      const result = compiled.evaluate(context);

      if (options.includeNonMatching || result.matched) {
        ruleResults.push(result);
      }

      if (result.matched) {
        matchedRule = result.ruleId;
        decision = result.decision!;

        // Short-circuit on deny for strict enforcement
        if (
          options.shortCircuitOnDeny !== false &&
          decision.outcome === 'deny' &&
          compiledPolicy.policy.enforcement === 'strict'
        ) {
          break;
        }
      }
    }

    const evaluationTimeMs = performance.now() - startTime;

    return {
      policyId: compiledPolicy.policy.policyId,
      matchedRule,
      decision,
      evaluationTimeMs,
      ruleResults,
    };
  }

  /**
   * Evaluates a policy only if it applies to the context.
   *
   * @param policy - Policy to evaluate
   * @param context - Evaluation context
   * @param options - Evaluation options
   * @returns Evaluation result or null if policy doesn't apply
   */
  evaluateIfApplicable(
    policy: Policy | CompiledPolicy,
    context: PolicyEvaluationContext,
    options: EvaluationOptions = {}
  ): PolicyEvaluationResult | null {
    const rawPolicy = 'policy' in policy ? policy.policy : policy;

    if (!this.isApplicable(rawPolicy.applicability, context)) {
      return null;
    }

    return this.evaluate(policy, context, options);
  }

  // ==========================================================================
  // MULTIPLE POLICY EVALUATION
  // ==========================================================================

  /**
   * Evaluates multiple policies and aggregates the results.
   *
   * @param policies - Policies to evaluate
   * @param context - Evaluation context
   * @param options - Evaluation options
   * @returns Aggregated result
   */
  evaluateAll(
    policies: ReadonlyArray<Policy | CompiledPolicy>,
    context: PolicyEvaluationContext,
    options: EvaluationOptions = {}
  ): AggregatedPolicyResult {
    const startTime = performance.now();

    const evaluationResults: PolicyEvaluationResult[] = [];
    const appliedRules: Array<{
      policyId: PolicyId;
      ruleId: string;
      decision: PolicyDecision;
    }> = [];

    let finalOutcome: PolicyOutcome = 'allow';
    let finalReason = 'No policies denied the action';
    let deniedByPolicy: PolicyId | null = null;

    // Sort policies by enforcement level (strict first)
    const sortedPolicies = this.sortByEnforcement(policies);

    for (const policy of sortedPolicies) {
      const result = this.evaluateIfApplicable(policy, context, options);

      if (result === null) {
        continue; // Policy not applicable
      }

      evaluationResults.push(result);

      if (result.matchedRule) {
        const rawPolicy = 'policy' in policy ? policy.policy : policy;
        appliedRules.push({
          policyId: rawPolicy.policyId,
          ruleId: result.matchedRule,
          decision: result.decision,
        });
      }

      // Update final outcome based on decision hierarchy:
      // deny > require_approval > warn > allow
      const outcomeRank = this.getOutcomeRank(result.decision.outcome);
      const currentRank = this.getOutcomeRank(finalOutcome);

      if (outcomeRank > currentRank) {
        finalOutcome = result.decision.outcome;
        finalReason = result.decision.reason;
        if (result.decision.outcome === 'deny') {
          const rawPolicy = 'policy' in policy ? policy.policy : policy;
          deniedByPolicy = rawPolicy.policyId;
        }
      }

      // Short-circuit on deny if strict
      if (
        options.shortCircuitOnDeny !== false &&
        result.decision.outcome === 'deny'
      ) {
        const rawPolicy = 'policy' in policy ? policy.policy : policy;
        if (rawPolicy.enforcement === 'strict') {
          break;
        }
      }
    }

    const totalEvaluationTimeMs = performance.now() - startTime;

    // Build final reason
    if (deniedByPolicy) {
      finalReason = `Denied by policy: ${deniedByPolicy}. ${finalReason}`;
    }

    return {
      outcome: finalOutcome,
      reason: finalReason,
      appliedRules,
      evaluationResults,
      totalEvaluationTimeMs,
    };
  }

  // ==========================================================================
  // APPLICABILITY CHECKING
  // ==========================================================================

  /**
   * Checks if a policy applies to the given context.
   *
   * @param applicability - Policy applicability rules
   * @param context - Evaluation context
   * @returns True if policy applies
   */
  isApplicable(
    applicability: PolicyApplicability,
    context: PolicyEvaluationContext
  ): boolean {
    // Check resource type filter
    if (
      applicability.resourceTypes &&
      applicability.resourceTypes.length > 0
    ) {
      if (!applicability.resourceTypes.includes(context.resourceType)) {
        return false;
      }
    }

    // Check action type filter
    if (applicability.actionTypes && applicability.actionTypes.length > 0) {
      if (!applicability.actionTypes.includes(context.actionType)) {
        return false;
      }
    }

    // Check environment filter
    if (applicability.environments && applicability.environments.length > 0) {
      if (!applicability.environments.includes(context.environment)) {
        return false;
      }
    }

    // Check custom expression
    if (applicability.expression) {
      try {
        const result = this.evaluatorRegistry.evaluate(
          applicability.expression,
          context
        );
        if (!result.matched) {
          return false;
        }
      } catch {
        // If expression evaluation fails, treat as not applicable
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Ensures a policy is compiled.
   */
  private ensureCompiled(policy: Policy | CompiledPolicy): CompiledPolicy {
    if ('compiledRules' in policy) {
      return policy;
    }

    // Compile on the fly
    const sortedRules = [...policy.rules]
      .filter((rule) => rule.enabled !== false)
      .sort((a, b) => b.priority - a.priority);

    const compiledRules = sortedRules.map((rule) => {
      const evaluator = this.evaluatorRegistry.findEvaluator(rule.condition);

      if (!evaluator) {
        return {
          rule,
          evaluate: (): PolicyRuleResult => ({
            ruleId: rule.ruleId,
            matched: false,
            evaluationTimeMs: 0,
            details: { error: `Unsupported language: ${rule.condition.lang}` },
          }),
        };
      }

      const compiledExpression = evaluator.compile(rule.condition);

      return {
        rule,
        evaluate: (ctx: PolicyEvaluationContext): PolicyRuleResult => {
          const result = compiledExpression(ctx);
          return {
            ruleId: rule.ruleId,
            matched: result.matched,
            decision: result.matched ? rule.decision : undefined,
            evaluationTimeMs: result.evaluationTimeMs,
            details: result.details,
          };
        },
      };
    });

    return { policy, compiledRules };
  }

  /**
   * Sorts policies by enforcement level (strict first).
   */
  private sortByEnforcement(
    policies: ReadonlyArray<Policy | CompiledPolicy>
  ): Array<Policy | CompiledPolicy> {
    const enforcementOrder: Record<string, number> = {
      strict: 0,
      advisory: 1,
      audit: 2,
    };

    return [...policies].sort((a, b) => {
      const policyA = 'policy' in a ? a.policy : a;
      const policyB = 'policy' in b ? b.policy : b;
      return (
        (enforcementOrder[policyA.enforcement] ?? 3) -
        (enforcementOrder[policyB.enforcement] ?? 3)
      );
    });
  }

  /**
   * Gets numerical rank for an outcome (for comparison).
   */
  private getOutcomeRank(outcome: PolicyOutcome): number {
    const ranks: Record<PolicyOutcome, number> = {
      allow: 0,
      warn: 1,
      require_approval: 2,
      deny: 3,
    };
    return ranks[outcome] ?? 0;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new policy evaluator.
 */
export function createPolicyEvaluator(
  evaluatorRegistry?: ExpressionEvaluatorRegistry,
  getTime?: () => ISOTimestamp
): PolicyEvaluator {
  return new PolicyEvaluator(evaluatorRegistry, getTime);
}
