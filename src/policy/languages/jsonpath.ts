/**
 * JSONPath Policy Expression Evaluator.
 *
 * Evaluates policy expressions using JSONPath-like syntax
 * for querying and matching values in the policy context.
 *
 * @module policy/languages/jsonpath
 */

import type {
  PolicyExpression,
  JSONPathExpression,
  PolicyEvaluationContext,
} from '../../types/policy.js';
import {
  PolicyExpressionEvaluator,
  type ExpressionResult,
  type ExpressionValidationResult,
  getNestedValue,
  deepEquals,
  matchesPattern,
} from './base.js';

// ============================================================================
// JSONPATH EVALUATOR CLASS
// ============================================================================

/**
 * Evaluates JSONPath expressions against policy contexts.
 *
 * Supports operators:
 * - equals: Value exactly equals expected
 * - not_equals: Value does not equal expected
 * - contains: Array contains value or string contains substring
 * - matches: Value matches pattern (supports wildcards)
 * - exists: Value exists (not null/undefined)
 * - not_exists: Value does not exist
 */
export class JSONPathEvaluator extends PolicyExpressionEvaluator<JSONPathExpression> {
  readonly language = 'jsonpath';

  /**
   * Checks if this evaluator can handle the expression.
   */
  canHandle(expression: PolicyExpression): expression is JSONPathExpression {
    return expression.lang === 'jsonpath';
  }

  /**
   * Evaluates a JSONPath expression.
   */
  evaluate(
    expression: JSONPathExpression,
    context: PolicyEvaluationContext
  ): ExpressionResult {
    const startTime = performance.now();

    try {
      // Parse the JSONPath expression
      const path = this.parseExpression(expression.expression);

      // Get the value from context
      const contextObject = this.contextToObject(context);
      const actualValue = this.resolvePath(path, contextObject);

      // Apply the operator
      const matched = this.applyOperator(
        expression.operator,
        actualValue,
        expression.value
      );

      const evaluationTimeMs = performance.now() - startTime;

      return {
        matched,
        value: actualValue,
        details: {
          expression: expression.expression,
          operator: expression.operator,
          expectedValue: expression.value,
          actualValue,
        },
        evaluationTimeMs,
      };
    } catch (error) {
      const evaluationTimeMs = performance.now() - startTime;
      return {
        matched: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
          expression: expression.expression,
        },
        evaluationTimeMs,
      };
    }
  }

  /**
   * Validates a JSONPath expression.
   */
  validate(expression: JSONPathExpression): ExpressionValidationResult {
    const errors: Array<{
      code: string;
      message: string;
      position?: { line: number; column: number };
    }> = [];
    const warnings: Array<{ code: string; message: string }> = [];

    // Check expression is non-empty
    if (!expression.expression || expression.expression.trim() === '') {
      errors.push({
        code: 'EMPTY_EXPRESSION',
        message: 'JSONPath expression cannot be empty',
      });
    }

    // Validate expression starts with $
    if (expression.expression && !expression.expression.startsWith('$')) {
      warnings.push({
        code: 'MISSING_ROOT',
        message: 'JSONPath expression should start with $ (root)',
      });
    }

    // Validate operator
    const validOperators = [
      'equals',
      'not_equals',
      'contains',
      'matches',
      'exists',
      'not_exists',
    ];
    if (!validOperators.includes(expression.operator)) {
      errors.push({
        code: 'INVALID_OPERATOR',
        message: `Invalid operator: ${expression.operator}. Valid operators: ${validOperators.join(', ')}`,
      });
    }

    // Check value requirement
    const requiresValue = ['equals', 'not_equals', 'contains', 'matches'];
    if (requiresValue.includes(expression.operator) && expression.value === undefined) {
      errors.push({
        code: 'MISSING_VALUE',
        message: `Operator '${expression.operator}' requires a value`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Compiles a JSONPath expression for faster repeated evaluation.
   */
  override compile(
    expression: JSONPathExpression
  ): (context: PolicyEvaluationContext) => ExpressionResult {
    // Pre-parse the path
    const path = this.parseExpression(expression.expression);
    const operator = expression.operator;
    const expectedValue = expression.value;

    return (context: PolicyEvaluationContext): ExpressionResult => {
      const startTime = performance.now();

      try {
        const contextObject = this.contextToObject(context);
        const actualValue = this.resolvePath(path, contextObject);
        const matched = this.applyOperator(operator, actualValue, expectedValue);

        return {
          matched,
          value: actualValue,
          evaluationTimeMs: performance.now() - startTime,
        };
      } catch (error) {
        return {
          matched: false,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
          evaluationTimeMs: performance.now() - startTime,
        };
      }
    };
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Parses a JSONPath expression into path segments.
   */
  private parseExpression(expression: string): string[] {
    // Remove leading $ if present
    let path = expression;
    if (path.startsWith('$.')) {
      path = path.slice(2);
    } else if (path.startsWith('$')) {
      path = path.slice(1);
    }

    // Handle bracket notation: $['foo']['bar'] or $["foo"]["bar"]
    path = path.replace(/\[['"]([^'"]+)['"]\]/g, '.$1');

    // Handle array indices: $[0] -> .0
    path = path.replace(/\[(\d+)\]/g, '.$1');

    // Split by dot, filter empty segments
    return path.split('.').filter((segment) => segment !== '');
  }

  /**
   * Resolves a path against an object.
   */
  private resolvePath(path: string[], obj: unknown): unknown {
    return getNestedValue(obj, path.join('.'));
  }

  /**
   * Converts policy evaluation context to a plain object.
   */
  private contextToObject(context: PolicyEvaluationContext): Record<string, unknown> {
    return {
      action: {
        type: context.actionType,
        config: context.actionConfig,
      },
      resource: {
        type: context.resourceType,
        id: context.resourceId,
        attributes: context.resourceAttributes,
      },
      environment: context.environment,
      simulationId: context.simulationId,
      simulatedTime: context.simulatedTime,
      state: context.currentState,
      previousDecisions: context.previousDecisions,
      actor: context.actor,
      targetEntities: context.targetEntities,
      custom: context.customAttributes,
    };
  }

  /**
   * Applies an operator to compare values.
   */
  private applyOperator(
    operator: JSONPathExpression['operator'],
    actual: unknown,
    expected: unknown
  ): boolean {
    switch (operator) {
      case 'equals':
        return deepEquals(actual, expected);

      case 'not_equals':
        return !deepEquals(actual, expected);

      case 'contains':
        if (Array.isArray(actual)) {
          // Check if array contains the expected value
          return actual.some((item) => deepEquals(item, expected));
        }
        if (typeof actual === 'string' && typeof expected === 'string') {
          // Check if string contains substring
          return actual.includes(expected);
        }
        if (typeof actual === 'object' && actual !== null && typeof expected === 'string') {
          // Check if object has property
          return expected in actual;
        }
        return false;

      case 'matches':
        if (typeof actual !== 'string' || typeof expected !== 'string') {
          return false;
        }
        return matchesPattern(actual, expected);

      case 'exists':
        return actual !== null && actual !== undefined;

      case 'not_exists':
        return actual === null || actual === undefined;

      default:
        return false;
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new JSONPath evaluator.
 */
export function createJSONPathEvaluator(): JSONPathEvaluator {
  return new JSONPathEvaluator();
}
