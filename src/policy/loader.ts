/**
 * Policy Loader.
 *
 * Loads and validates policies from multiple sources:
 * - Inline definitions
 * - File system
 * - Policy registry
 *
 * @module policy/loader
 */

import type { PolicyId, ContentHash } from '../types/common.js';
import type {
  Policy,
  PolicySet,
  PolicyValidationResult,
  PolicyRule,
  CompiledPolicy,
  CompiledRule,
  PolicyEvaluationContext,
  PolicyRuleResult,
} from '../types/policy.js';
import {
  ExpressionEvaluatorRegistry,
  createEvaluatorRegistry,
} from './languages/base.js';
import { createJSONPathEvaluator } from './languages/jsonpath.js';
import { createContentHashFromObject } from '../utils/hash.js';

// ============================================================================
// POLICY SOURCE TYPES
// ============================================================================

/**
 * Source for loading a policy.
 */
export type PolicySource =
  | { type: 'inline'; policy: Policy }
  | { type: 'file'; path: string }
  | { type: 'registry'; policyId: PolicyId; version?: string };

/**
 * Options for policy loading.
 */
export interface PolicyLoadOptions {
  /** Whether to validate policies during load */
  readonly validate?: boolean;
  /** Whether to compile policies for faster evaluation */
  readonly compile?: boolean;
  /** Custom expression evaluator registry */
  readonly evaluatorRegistry?: ExpressionEvaluatorRegistry;
}

// ============================================================================
// POLICY LOADER CLASS
// ============================================================================

/**
 * Loads and manages policies from various sources.
 */
export class PolicyLoader {
  private readonly loadedPolicies: Map<PolicyId, Policy> = new Map();
  private readonly compiledPolicies: Map<PolicyId, CompiledPolicy> = new Map();
  private readonly evaluatorRegistry: ExpressionEvaluatorRegistry;

  constructor(evaluatorRegistry?: ExpressionEvaluatorRegistry) {
    this.evaluatorRegistry = evaluatorRegistry ?? this.createDefaultRegistry();
  }

  /**
   * Creates default evaluator registry with standard evaluators.
   */
  private createDefaultRegistry(): ExpressionEvaluatorRegistry {
    const registry = createEvaluatorRegistry();
    registry.register(createJSONPathEvaluator());
    return registry;
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
  async load(
    source: PolicySource,
    options: PolicyLoadOptions = {}
  ): Promise<Policy> {
    let policy: Policy;

    switch (source.type) {
      case 'inline':
        policy = source.policy;
        break;
      case 'file':
        policy = await this.loadFromFile(source.path);
        break;
      case 'registry':
        policy = await this.loadFromRegistry(source.policyId, source.version);
        break;
    }

    // Validate if requested
    if (options.validate !== false) {
      const validation = this.validate(policy);
      if (!validation.valid) {
        throw new Error(
          `Policy validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
        );
      }
    }

    // Compute content hash if not present
    if (!policy.contentHash) {
      policy = {
        ...policy,
        contentHash: this.computePolicyHash(policy),
      };
    }

    // Store loaded policy
    this.loadedPolicies.set(policy.policyId, policy);

    // Compile if requested
    if (options.compile !== false) {
      const compiled = this.compile(policy);
      this.compiledPolicies.set(policy.policyId, compiled);
    }

    return policy;
  }

  /**
   * Loads multiple policies from sources.
   *
   * @param sources - Policy sources
   * @param options - Load options
   * @returns Loaded policies
   */
  async loadAll(
    sources: ReadonlyArray<PolicySource>,
    options: PolicyLoadOptions = {}
  ): Promise<Policy[]> {
    const policies: Policy[] = [];

    for (const source of sources) {
      const policy = await this.load(source, options);
      policies.push(policy);
    }

    return policies;
  }

  /**
   * Loads a policy set.
   *
   * @param policySet - Policy set definition
   * @param options - Load options
   * @returns Loaded policies
   */
  async loadPolicySet(
    policySet: PolicySet,
    options: PolicyLoadOptions = {}
  ): Promise<Policy[]> {
    const sources: PolicySource[] = policySet.policies.map((policy) => ({
      type: 'inline' as const,
      policy,
    }));

    return this.loadAll(sources, options);
  }

  // ==========================================================================
  // POLICY ACCESS
  // ==========================================================================

  /**
   * Gets a loaded policy by ID.
   */
  getPolicy(policyId: PolicyId): Policy | undefined {
    return this.loadedPolicies.get(policyId);
  }

  /**
   * Gets a compiled policy by ID.
   */
  getCompiledPolicy(policyId: PolicyId): CompiledPolicy | undefined {
    return this.compiledPolicies.get(policyId);
  }

  /**
   * Gets all loaded policies.
   */
  getAllPolicies(): ReadonlyArray<Policy> {
    return Array.from(this.loadedPolicies.values());
  }

  /**
   * Gets all loaded policy IDs.
   */
  getPolicyIds(): ReadonlyArray<PolicyId> {
    return Array.from(this.loadedPolicies.keys());
  }

  /**
   * Checks if a policy is loaded.
   */
  hasPolicy(policyId: PolicyId): boolean {
    return this.loadedPolicies.has(policyId);
  }

  // ==========================================================================
  // POLICY VALIDATION
  // ==========================================================================

  /**
   * Validates a policy definition.
   *
   * @param policy - Policy to validate
   * @returns Validation result
   */
  validate(policy: Policy): PolicyValidationResult {
    const errors: Array<{
      code: string;
      message: string;
      path?: string;
      ruleId?: string;
    }> = [];
    const warnings: Array<{
      code: string;
      message: string;
      path?: string;
      ruleId?: string;
    }> = [];

    // Validate policy ID
    if (!policy.policyId) {
      errors.push({
        code: 'MISSING_ID',
        message: 'Policy ID is required',
        path: 'policyId',
      });
    }

    // Validate version
    if (!policy.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'Policy version is required',
        path: 'version',
      });
    }

    // Validate name
    if (!policy.name || policy.name.trim() === '') {
      errors.push({
        code: 'MISSING_NAME',
        message: 'Policy name is required',
        path: 'name',
      });
    }

    // Validate enforcement
    if (!['strict', 'advisory', 'audit'].includes(policy.enforcement)) {
      errors.push({
        code: 'INVALID_ENFORCEMENT',
        message: `Invalid enforcement level: ${policy.enforcement}`,
        path: 'enforcement',
      });
    }

    // Validate rules
    if (!policy.rules || policy.rules.length === 0) {
      warnings.push({
        code: 'NO_RULES',
        message: 'Policy has no rules defined',
        path: 'rules',
      });
    } else {
      // Validate each rule
      for (let i = 0; i < policy.rules.length; i++) {
        const rule = policy.rules[i]!;
        const ruleErrors = this.validateRule(rule, i);
        errors.push(...ruleErrors.errors);
        warnings.push(...ruleErrors.warnings);
      }

      // Check for duplicate rule IDs
      const ruleIds = policy.rules.map((r) => r.ruleId);
      const duplicates = ruleIds.filter(
        (id, idx) => ruleIds.indexOf(id) !== idx
      );
      if (duplicates.length > 0) {
        errors.push({
          code: 'DUPLICATE_RULE_ID',
          message: `Duplicate rule IDs: ${[...new Set(duplicates)].join(', ')}`,
          path: 'rules',
        });
      }
    }

    // Validate default decision
    if (!policy.defaultDecision) {
      errors.push({
        code: 'MISSING_DEFAULT_DECISION',
        message: 'Default decision is required',
        path: 'defaultDecision',
      });
    } else if (
      !['allow', 'deny', 'warn', 'require_approval'].includes(
        policy.defaultDecision.outcome
      )
    ) {
      errors.push({
        code: 'INVALID_DEFAULT_OUTCOME',
        message: `Invalid default outcome: ${policy.defaultDecision.outcome}`,
        path: 'defaultDecision.outcome',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates a single rule.
   */
  private validateRule(
    rule: PolicyRule,
    index: number
  ): { errors: typeof errors; warnings: typeof warnings } {
    const errors: Array<{
      code: string;
      message: string;
      path?: string;
      ruleId?: string;
    }> = [];
    const warnings: Array<{
      code: string;
      message: string;
      path?: string;
      ruleId?: string;
    }> = [];

    const path = `rules[${index}]`;

    // Validate rule ID
    if (!rule.ruleId) {
      errors.push({
        code: 'MISSING_RULE_ID',
        message: 'Rule ID is required',
        path: `${path}.ruleId`,
      });
    }

    // Validate description
    if (!rule.description || rule.description.trim() === '') {
      warnings.push({
        code: 'MISSING_DESCRIPTION',
        message: 'Rule description is recommended',
        path: `${path}.description`,
        ruleId: rule.ruleId,
      });
    }

    // Validate condition
    if (!rule.condition) {
      errors.push({
        code: 'MISSING_CONDITION',
        message: 'Rule condition is required',
        path: `${path}.condition`,
        ruleId: rule.ruleId,
      });
    } else {
      // Check if we have an evaluator for this language
      if (!this.evaluatorRegistry.hasLanguage(rule.condition.lang)) {
        errors.push({
          code: 'UNSUPPORTED_LANGUAGE',
          message: `Unsupported expression language: ${rule.condition.lang}`,
          path: `${path}.condition.lang`,
          ruleId: rule.ruleId,
        });
      }
    }

    // Validate decision
    if (!rule.decision) {
      errors.push({
        code: 'MISSING_DECISION',
        message: 'Rule decision is required',
        path: `${path}.decision`,
        ruleId: rule.ruleId,
      });
    } else if (
      !['allow', 'deny', 'warn', 'require_approval'].includes(
        rule.decision.outcome
      )
    ) {
      errors.push({
        code: 'INVALID_OUTCOME',
        message: `Invalid decision outcome: ${rule.decision.outcome}`,
        path: `${path}.decision.outcome`,
        ruleId: rule.ruleId,
      });
    }

    // Validate priority
    if (typeof rule.priority !== 'number' || isNaN(rule.priority)) {
      errors.push({
        code: 'INVALID_PRIORITY',
        message: 'Rule priority must be a number',
        path: `${path}.priority`,
        ruleId: rule.ruleId,
      });
    }

    return { errors, warnings };
  }

  // ==========================================================================
  // POLICY COMPILATION
  // ==========================================================================

  /**
   * Compiles a policy for faster evaluation.
   *
   * @param policy - Policy to compile
   * @returns Compiled policy
   */
  compile(policy: Policy): CompiledPolicy {
    // Sort rules by priority (highest first)
    const sortedRules = [...policy.rules]
      .filter((rule) => rule.enabled !== false)
      .sort((a, b) => b.priority - a.priority);

    // Compile each rule
    const compiledRules: CompiledRule[] = sortedRules.map((rule) => {
      const evaluator = this.evaluatorRegistry.findEvaluator(rule.condition);

      if (!evaluator) {
        // Return a no-match evaluator if language not supported
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

      // Compile the expression
      const compiledExpression = evaluator.compile(rule.condition);

      return {
        rule,
        evaluate: (context: PolicyEvaluationContext): PolicyRuleResult => {
          const result = compiledExpression(context);
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

    return {
      policy,
      compiledRules,
    };
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Loads a policy from a file.
   * NOTE: This is a placeholder - actual file loading would be implemented
   * based on the deployment environment.
   */
  private async loadFromFile(path: string): Promise<Policy> {
    // In a real implementation, this would read from the file system
    // For now, throw an error indicating file loading is not supported
    throw new Error(
      `File-based policy loading not implemented. Path: ${path}`
    );
  }

  /**
   * Loads a policy from a registry.
   * NOTE: This is a placeholder - actual registry loading would use
   * the PolicySystemAdapter interface.
   */
  private async loadFromRegistry(
    policyId: PolicyId,
    _version?: string
  ): Promise<Policy> {
    // In a real implementation, this would use PolicySystemAdapter
    throw new Error(
      `Registry-based policy loading not implemented. Policy: ${policyId}`
    );
  }

  /**
   * Computes content hash for a policy.
   */
  private computePolicyHash(policy: Policy): ContentHash {
    // Create a canonical representation of the policy for hashing
    const canonical = {
      policyId: policy.policyId,
      version: policy.version,
      name: policy.name,
      description: policy.description,
      enforcement: policy.enforcement,
      applicability: policy.applicability,
      rules: policy.rules.map((rule) => ({
        ruleId: rule.ruleId,
        description: rule.description,
        condition: rule.condition,
        decision: rule.decision,
        priority: rule.priority,
        enabled: rule.enabled,
      })),
      defaultDecision: policy.defaultDecision,
    };

    return createContentHashFromObject(canonical);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Clears all loaded policies.
   */
  clear(): void {
    this.loadedPolicies.clear();
    this.compiledPolicies.clear();
  }

  /**
   * Removes a specific policy.
   */
  remove(policyId: PolicyId): boolean {
    const existed = this.loadedPolicies.has(policyId);
    this.loadedPolicies.delete(policyId);
    this.compiledPolicies.delete(policyId);
    return existed;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new policy loader.
 */
export function createPolicyLoader(
  evaluatorRegistry?: ExpressionEvaluatorRegistry
): PolicyLoader {
  return new PolicyLoader(evaluatorRegistry);
}
