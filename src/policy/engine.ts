/**
 * Policy Engine.
 *
 * Main entry point for policy evaluation in the simulation engine.
 * Combines policy loading, compilation, evaluation, and decision tracking.
 *
 * @module policy/engine
 */

import type { SimulationId, PolicyId, ISOTimestamp } from '../types/common.js';
import type {
  Policy,
  PolicySet,
  CompiledPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  AggregatedPolicyResult,
  PolicyDecisionRecord,
  PolicyValidationResult,
  PolicyDecision,
  PolicyOutcome,
} from '../types/policy.js';
import {
  PolicyLoader,
  createPolicyLoader,
  type PolicySource,
  type PolicyLoadOptions,
} from './loader.js';
import {
  PolicyEvaluator,
  createPolicyEvaluator,
  type EvaluationOptions,
} from './evaluator.js';
import {
  ExpressionEvaluatorRegistry,
  createEvaluatorRegistry,
} from './languages/base.js';
import { createJSONPathEvaluator } from './languages/jsonpath.js';

// ============================================================================
// POLICY ENGINE CONFIGURATION
// ============================================================================

/**
 * Configuration for the policy engine.
 */
export interface PolicyEngineConfig {
  /** Simulation ID for context */
  readonly simulationId: SimulationId;
  /** Default enforcement level for new policies */
  readonly defaultEnforcement?: 'strict' | 'advisory' | 'audit';
  /** Whether to short-circuit on deny (default: true) */
  readonly shortCircuitOnDeny?: boolean;
  /** Maximum policy decisions to retain in history */
  readonly maxDecisionHistory?: number;
  /** Time provider for deterministic evaluation */
  readonly getTime?: () => ISOTimestamp;
}

/**
 * Default policy engine configuration.
 */
export const DEFAULT_POLICY_ENGINE_CONFIG: Omit<
  PolicyEngineConfig,
  'simulationId'
> = {
  defaultEnforcement: 'strict',
  shortCircuitOnDeny: true,
  maxDecisionHistory: 1000,
};

// ============================================================================
// POLICY ENGINE CLASS
// ============================================================================

/**
 * Main policy engine for the simulation system.
 *
 * Provides a unified interface for:
 * - Loading and managing policies
 * - Evaluating actions against policies
 * - Tracking policy decisions
 * - Enforcing policy decisions
 */
export class PolicyEngine {
  private readonly config: Required<Omit<PolicyEngineConfig, 'getTime'>> & {
    getTime: () => ISOTimestamp;
  };
  private readonly loader: PolicyLoader;
  private readonly evaluator: PolicyEvaluator;
  private readonly evaluatorRegistry: ExpressionEvaluatorRegistry;
  private readonly decisionHistory: PolicyDecisionRecord[] = [];

  constructor(config: PolicyEngineConfig) {
    this.config = {
      simulationId: config.simulationId,
      defaultEnforcement: config.defaultEnforcement ?? DEFAULT_POLICY_ENGINE_CONFIG.defaultEnforcement!,
      shortCircuitOnDeny: config.shortCircuitOnDeny ?? DEFAULT_POLICY_ENGINE_CONFIG.shortCircuitOnDeny!,
      maxDecisionHistory: config.maxDecisionHistory ?? DEFAULT_POLICY_ENGINE_CONFIG.maxDecisionHistory!,
      getTime: config.getTime ?? (() => new Date().toISOString() as ISOTimestamp),
    };

    // Create shared evaluator registry
    this.evaluatorRegistry = createEvaluatorRegistry();
    this.evaluatorRegistry.register(createJSONPathEvaluator());

    // Create loader and evaluator with shared registry
    this.loader = createPolicyLoader(this.evaluatorRegistry);
    this.evaluator = createPolicyEvaluator(
      this.evaluatorRegistry,
      this.config.getTime
    );
  }

  // ==========================================================================
  // POLICY LOADING
  // ==========================================================================

  /**
   * Loads a policy from a source.
   *
   * @param source - Policy source
   * @param options - Load options
   * @returns Loaded policy
   */
  async loadPolicy(
    source: PolicySource,
    options?: PolicyLoadOptions
  ): Promise<Policy> {
    return this.loader.load(source, options);
  }

  /**
   * Loads multiple policies.
   *
   * @param sources - Policy sources
   * @param options - Load options
   * @returns Loaded policies
   */
  async loadPolicies(
    sources: ReadonlyArray<PolicySource>,
    options?: PolicyLoadOptions
  ): Promise<Policy[]> {
    return this.loader.loadAll(sources, options);
  }

  /**
   * Loads a policy set.
   *
   * @param policySet - Policy set to load
   * @param options - Load options
   * @returns Loaded policies
   */
  async loadPolicySet(
    policySet: PolicySet,
    options?: PolicyLoadOptions
  ): Promise<Policy[]> {
    return this.loader.loadPolicySet(policySet, options);
  }

  /**
   * Adds an inline policy directly.
   *
   * @param policy - Policy to add
   * @param options - Load options
   */
  async addPolicy(
    policy: Policy,
    options?: PolicyLoadOptions
  ): Promise<Policy> {
    return this.loader.load({ type: 'inline', policy }, options);
  }

  // ==========================================================================
  // POLICY ACCESS
  // ==========================================================================

  /**
   * Gets a policy by ID.
   */
  getPolicy(policyId: PolicyId): Policy | undefined {
    return this.loader.getPolicy(policyId);
  }

  /**
   * Gets a compiled policy by ID.
   */
  getCompiledPolicy(policyId: PolicyId): CompiledPolicy | undefined {
    return this.loader.getCompiledPolicy(policyId);
  }

  /**
   * Gets all loaded policies.
   */
  getAllPolicies(): ReadonlyArray<Policy> {
    return this.loader.getAllPolicies();
  }

  /**
   * Checks if a policy is loaded.
   */
  hasPolicy(policyId: PolicyId): boolean {
    return this.loader.hasPolicy(policyId);
  }

  // ==========================================================================
  // POLICY EVALUATION
  // ==========================================================================

  /**
   * Evaluates a single policy against a context.
   *
   * @param policyId - Policy ID to evaluate
   * @param context - Evaluation context
   * @param options - Evaluation options
   * @returns Evaluation result
   */
  evaluatePolicy(
    policyId: PolicyId,
    context: PolicyEvaluationContext,
    options?: EvaluationOptions
  ): PolicyEvaluationResult {
    const compiled = this.loader.getCompiledPolicy(policyId);
    if (!compiled) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const result = this.evaluator.evaluate(compiled, context, {
      shortCircuitOnDeny: this.config.shortCircuitOnDeny,
      ...options,
    });

    // Record decision
    this.recordDecision(policyId, context, result.decision);

    return result;
  }

  /**
   * Evaluates all loaded policies against a context.
   *
   * @param context - Evaluation context
   * @param options - Evaluation options
   * @returns Aggregated result
   */
  evaluateAll(
    context: PolicyEvaluationContext,
    options?: EvaluationOptions
  ): AggregatedPolicyResult {
    const policies = this.loader.getAllPolicies();
    const compiledPolicies = policies
      .map((p) => this.loader.getCompiledPolicy(p.policyId))
      .filter((p): p is CompiledPolicy => p !== undefined);

    const result = this.evaluator.evaluateAll(compiledPolicies, context, {
      shortCircuitOnDeny: this.config.shortCircuitOnDeny,
      ...options,
    });

    // Record decisions for each applied rule
    for (const applied of result.appliedRules) {
      this.recordDecision(applied.policyId, context, applied.decision);
    }

    return result;
  }

  /**
   * Checks if an action is allowed by all policies.
   *
   * @param context - Evaluation context
   * @returns True if action is allowed
   */
  isAllowed(context: PolicyEvaluationContext): boolean {
    const result = this.evaluateAll(context);
    return result.outcome === 'allow';
  }

  /**
   * Checks if an action is denied by any policy.
   *
   * @param context - Evaluation context
   * @returns True if action is denied
   */
  isDenied(context: PolicyEvaluationContext): boolean {
    const result = this.evaluateAll(context);
    return result.outcome === 'deny';
  }

  /**
   * Enforces policies on an action, throwing if denied.
   *
   * @param context - Evaluation context
   * @throws PolicyViolationError if action is denied by strict policy
   */
  enforce(context: PolicyEvaluationContext): AggregatedPolicyResult {
    const result = this.evaluateAll(context);

    if (result.outcome === 'deny') {
      // Check if any denying policy is strict
      const denyingRule = result.appliedRules.find(
        (r) => r.decision.outcome === 'deny'
      );

      if (denyingRule) {
        const policy = this.getPolicy(denyingRule.policyId);
        if (policy?.enforcement === 'strict') {
          throw new PolicyEnforcementError(
            denyingRule.policyId,
            denyingRule.ruleId,
            result.reason,
            denyingRule.decision.remediation
          );
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // POLICY VALIDATION
  // ==========================================================================

  /**
   * Validates a policy.
   *
   * @param policy - Policy to validate
   * @returns Validation result
   */
  validatePolicy(policy: Policy): PolicyValidationResult {
    return this.loader.validate(policy);
  }

  // ==========================================================================
  // DECISION HISTORY
  // ==========================================================================

  /**
   * Gets the decision history.
   */
  getDecisionHistory(): ReadonlyArray<PolicyDecisionRecord> {
    return [...this.decisionHistory];
  }

  /**
   * Gets decisions for a specific policy.
   */
  getDecisionsForPolicy(
    policyId: PolicyId
  ): ReadonlyArray<PolicyDecisionRecord> {
    return this.decisionHistory.filter((d) => d.policyId === policyId);
  }

  /**
   * Gets decisions by outcome.
   */
  getDecisionsByOutcome(
    outcome: PolicyOutcome
  ): ReadonlyArray<PolicyDecisionRecord> {
    return this.decisionHistory.filter(
      (d) => d.decision.outcome === outcome
    );
  }

  /**
   * Clears the decision history.
   */
  clearDecisionHistory(): void {
    this.decisionHistory.length = 0;
  }

  /**
   * Records a policy decision in history.
   */
  private recordDecision(
    policyId: PolicyId,
    context: PolicyEvaluationContext,
    decision: PolicyDecision
  ): void {
    const record: PolicyDecisionRecord = {
      policyId,
      timestamp: this.config.getTime(),
      decision,
      context: {
        actionType: context.actionType,
        resourceType: context.resourceType,
      },
    };

    this.decisionHistory.push(record);

    // Trim history if needed
    if (this.decisionHistory.length > this.config.maxDecisionHistory) {
      this.decisionHistory.shift();
    }
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Gets statistics about policy evaluation.
   */
  getStatistics(): PolicyStatistics {
    const decisions = this.decisionHistory;
    const outcomes = {
      allow: 0,
      deny: 0,
      warn: 0,
      require_approval: 0,
    };

    for (const d of decisions) {
      outcomes[d.decision.outcome]++;
    }

    const policyEvaluations = new Map<PolicyId, number>();
    for (const d of decisions) {
      policyEvaluations.set(
        d.policyId,
        (policyEvaluations.get(d.policyId) ?? 0) + 1
      );
    }

    return {
      totalEvaluations: decisions.length,
      outcomeBreakdown: outcomes,
      evaluationsPerPolicy: Object.fromEntries(policyEvaluations),
      loadedPolicies: this.loader.getAllPolicies().length,
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Removes a policy.
   */
  removePolicy(policyId: PolicyId): boolean {
    return this.loader.remove(policyId);
  }

  /**
   * Clears all loaded policies.
   */
  clearPolicies(): void {
    this.loader.clear();
  }

  /**
   * Resets the engine to initial state.
   */
  reset(): void {
    this.clearPolicies();
    this.clearDecisionHistory();
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Statistics about policy evaluation.
 */
export interface PolicyStatistics {
  readonly totalEvaluations: number;
  readonly outcomeBreakdown: Readonly<Record<PolicyOutcome, number>>;
  readonly evaluationsPerPolicy: Readonly<Record<string, number>>;
  readonly loadedPolicies: number;
}

/**
 * Error thrown when a policy enforcement fails.
 */
export class PolicyEnforcementError extends Error {
  readonly policyId: PolicyId;
  readonly ruleId: string;
  readonly remediation?: string;

  constructor(
    policyId: PolicyId,
    ruleId: string,
    reason: string,
    remediation?: string
  ) {
    super(`Policy enforcement failed: ${reason}`);
    this.name = 'PolicyEnforcementError';
    this.policyId = policyId;
    this.ruleId = ruleId;
    this.remediation = remediation;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new policy engine.
 */
export function createPolicyEngine(config: PolicyEngineConfig): PolicyEngine {
  return new PolicyEngine(config);
}
