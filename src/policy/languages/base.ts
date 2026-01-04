/**
 * Base Policy Expression Evaluator.
 *
 * Defines the abstract interface for evaluating policy expressions
 * and provides common utilities for expression evaluation.
 *
 * @module policy/languages/base
 */

import type {
  PolicyExpression,
  PolicyEvaluationContext,
} from '../../types/policy.js';

// ============================================================================
// EXPRESSION EVALUATION RESULT
// ============================================================================

/**
 * Result of evaluating a policy expression.
 */
export interface ExpressionResult {
  /** Whether the expression matched/succeeded */
  readonly matched: boolean;
  /** Extracted value (if applicable) */
  readonly value?: unknown;
  /** Details about the evaluation */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Evaluation time in milliseconds */
  readonly evaluationTimeMs: number;
}

// ============================================================================
// ABSTRACT EXPRESSION EVALUATOR
// ============================================================================

/**
 * Abstract base class for policy expression evaluators.
 *
 * Each expression language (Rego, CEL, JSONPath, etc.) should
 * implement this interface.
 */
export abstract class PolicyExpressionEvaluator<
  TExpression extends PolicyExpression = PolicyExpression
> {
  /** The language this evaluator handles */
  abstract readonly language: string;

  /**
   * Checks if this evaluator can handle the given expression.
   *
   * @param expression - Expression to check
   * @returns True if this evaluator handles the expression
   */
  abstract canHandle(expression: PolicyExpression): expression is TExpression;

  /**
   * Evaluates an expression against a policy context.
   *
   * @param expression - Expression to evaluate
   * @param context - Evaluation context
   * @returns Evaluation result
   */
  abstract evaluate(
    expression: TExpression,
    context: PolicyEvaluationContext
  ): ExpressionResult;

  /**
   * Validates an expression for correctness.
   *
   * @param expression - Expression to validate
   * @returns Validation result
   */
  abstract validate(expression: TExpression): ExpressionValidationResult;

  /**
   * Compiles an expression for faster repeated evaluation.
   * Returns a function that can be called multiple times.
   *
   * @param expression - Expression to compile
   * @returns Compiled evaluator function
   */
  compile(
    expression: TExpression
  ): (context: PolicyEvaluationContext) => ExpressionResult {
    // Default implementation just wraps evaluate
    return (context) => this.evaluate(expression, context);
  }
}

// ============================================================================
// VALIDATION RESULT
// ============================================================================

/**
 * Result of validating a policy expression.
 */
export interface ExpressionValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly position?: {
      readonly line: number;
      readonly column: number;
    };
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
  }>;
}

// ============================================================================
// EVALUATOR REGISTRY
// ============================================================================

/**
 * Registry for policy expression evaluators.
 * Manages multiple evaluators for different expression languages.
 */
export class ExpressionEvaluatorRegistry {
  private readonly evaluators: Map<string, PolicyExpressionEvaluator> =
    new Map();

  /**
   * Registers an evaluator for a language.
   *
   * @param evaluator - Evaluator to register
   */
  register(evaluator: PolicyExpressionEvaluator): void {
    this.evaluators.set(evaluator.language, evaluator);
  }

  /**
   * Gets an evaluator for a specific language.
   *
   * @param language - Language to get evaluator for
   * @returns Evaluator or undefined if not found
   */
  getEvaluator(language: string): PolicyExpressionEvaluator | undefined {
    return this.evaluators.get(language);
  }

  /**
   * Finds an evaluator that can handle the given expression.
   *
   * @param expression - Expression to find evaluator for
   * @returns Evaluator or undefined if none can handle it
   */
  findEvaluator(expression: PolicyExpression): PolicyExpressionEvaluator | undefined {
    for (const evaluator of this.evaluators.values()) {
      if (evaluator.canHandle(expression)) {
        return evaluator;
      }
    }
    return undefined;
  }

  /**
   * Evaluates an expression using the appropriate evaluator.
   *
   * @param expression - Expression to evaluate
   * @param context - Evaluation context
   * @returns Evaluation result
   * @throws Error if no evaluator found for expression language
   */
  evaluate(
    expression: PolicyExpression,
    context: PolicyEvaluationContext
  ): ExpressionResult {
    const evaluator = this.findEvaluator(expression);
    if (!evaluator) {
      throw new Error(`No evaluator found for expression language: ${expression.lang}`);
    }
    return evaluator.evaluate(expression, context);
  }

  /**
   * Gets all registered languages.
   */
  getLanguages(): ReadonlyArray<string> {
    return Array.from(this.evaluators.keys());
  }

  /**
   * Checks if a language is supported.
   */
  hasLanguage(language: string): boolean {
    return this.evaluators.has(language);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets a value from an object using dot notation path.
 *
 * @param obj - Object to get value from
 * @param path - Dot-separated path (e.g., 'foo.bar.baz')
 * @returns Value at path or undefined
 */
export function getNestedValue(
  obj: unknown,
  path: string
): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (!isNaN(index) && index >= 0 && index < current.length) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Compares two values for equality (deep comparison).
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are equal
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (a === null || b === null) {
    return a === b;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((val, idx) => deepEquals(val, b[idx]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every(
      (key) =>
        keysB.includes(key) &&
        deepEquals(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
    );
  }

  return false;
}

/**
 * Checks if a value matches a pattern (supports * and ** wildcards).
 *
 * @param value - Value to check
 * @param pattern - Pattern with wildcards
 * @returns True if value matches pattern
 */
export function matchesPattern(value: string, pattern: string): boolean {
  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new expression evaluator registry.
 */
export function createEvaluatorRegistry(): ExpressionEvaluatorRegistry {
  return new ExpressionEvaluatorRegistry();
}
