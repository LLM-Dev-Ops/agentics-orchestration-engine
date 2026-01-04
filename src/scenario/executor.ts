/**
 * Scenario Step Executor.
 *
 * Executes individual scenario steps with retry logic,
 * timeout handling, and result capture.
 *
 * @module scenario/executor
 */

import type { StepId, ISOTimestamp } from '../types/common.js';
import type {
  ScenarioStep,
  StepType,
  RetryConfig,
  StepAssertion,
  AgentActionConfig,
  DataInjectionConfig,
  StateMutationConfig,
  PolicyEvaluationConfig,
  AssertionConfig,
  DelayConfig,
  BranchConfig,
  LoopConfig,
  CheckpointConfig,
} from '../types/scenario.js';
import { ExecutionGraph } from './graph.js';

// ============================================================================
// STEP RESULT
// ============================================================================

/**
 * Result of executing a single step.
 */
export interface StepExecutionResult {
  readonly stepId: StepId;
  readonly stepType: StepType;
  readonly status: 'success' | 'failure' | 'skipped' | 'timeout';
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly stack?: string;
  };
  readonly retryCount: number;
  readonly assertionResults?: ReadonlyArray<AssertionResult>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Result of an assertion evaluation.
 */
export interface AssertionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message?: string;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

/**
 * Context provided to step handlers.
 */
export interface StepExecutionContext {
  /** Current simulated time */
  readonly simulatedTime: ISOTimestamp;
  /** Current simulation state (read-only view) */
  readonly state: Readonly<Record<string, unknown>>;
  /** Function to get nested state values */
  getStateValue(path: string): unknown;
  /** Function to update state */
  updateState(path: string, value: unknown): void;
  /** Function to advance simulated time */
  advanceTime(ms: number): void;
  /** Execution graph for dependency info */
  readonly graph: ExecutionGraph;
  /** Custom context attributes */
  readonly customContext?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

/**
 * Handler function for a step type.
 */
export type StepHandler = (
  step: ScenarioStep,
  context: StepExecutionContext
) => Promise<unknown>;

/**
 * Registry of step handlers.
 */
export class StepHandlerRegistry {
  private readonly handlers: Map<StepType, StepHandler> = new Map();

  /**
   * Registers a handler for a step type.
   */
  register(type: StepType, handler: StepHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Gets a handler for a step type.
   */
  get(type: StepType): StepHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Checks if a handler exists for a step type.
   */
  has(type: StepType): boolean {
    return this.handlers.has(type);
  }
}

// ============================================================================
// STEP EXECUTOR CLASS
// ============================================================================

/**
 * Executes scenario steps with retry and timeout support.
 */
export class StepExecutor {
  private readonly handlerRegistry: StepHandlerRegistry;
  private readonly defaultTimeout: number;
  private readonly getTime: () => ISOTimestamp;

  constructor(
    handlerRegistry?: StepHandlerRegistry,
    options?: {
      defaultTimeout?: number;
      getTime?: () => ISOTimestamp;
    }
  ) {
    this.handlerRegistry = handlerRegistry ?? this.createDefaultRegistry();
    this.defaultTimeout = options?.defaultTimeout ?? 30000;
    this.getTime = options?.getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  /**
   * Creates registry with default handlers.
   */
  private createDefaultRegistry(): StepHandlerRegistry {
    const registry = new StepHandlerRegistry();

    // Register default handlers
    registry.register('agent_action', this.handleAgentAction.bind(this));
    registry.register('data_injection', this.handleDataInjection.bind(this));
    registry.register('state_mutation', this.handleStateMutation.bind(this));
    registry.register('policy_evaluation', this.handlePolicyEvaluation.bind(this));
    registry.register('assertion', this.handleAssertion.bind(this));
    registry.register('delay', this.handleDelay.bind(this));
    registry.register('branch', this.handleBranch.bind(this));
    registry.register('loop', this.handleLoop.bind(this));
    registry.register('checkpoint', this.handleCheckpoint.bind(this));
    registry.register('custom', this.handleCustom.bind(this));

    return registry;
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  /**
   * Executes a single step with retry logic.
   */
  async execute(
    step: ScenarioStep,
    context: StepExecutionContext
  ): Promise<StepExecutionResult> {
    const startTime = performance.now();
    let lastError: Error | undefined;
    let retryCount = 0;
    const maxRetries = step.retry?.maxAttempts ?? 1;

    while (retryCount < maxRetries) {
      try {
        // Execute with timeout
        const timeout = step.timeoutMs ?? this.defaultTimeout;
        const output = await this.executeWithTimeout(step, context, timeout);

        // Run assertions if any
        const assertionResults = step.assertions
          ? await this.runAssertions(step.assertions, output, context)
          : undefined;

        // Check for assertion failures
        const hasFailedAssertions = assertionResults?.some(
          (r) => !r.passed && step.assertions?.find((a) => a.id === r.id)?.severity === 'error'
        );

        if (hasFailedAssertions) {
          throw new AssertionError('Step assertions failed', assertionResults!);
        }

        return {
          stepId: step.stepId,
          stepType: step.type,
          status: 'success',
          durationMs: performance.now() - startTime,
          output,
          retryCount,
          assertionResults,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if should retry
        if (this.shouldRetry(error, step.retry, retryCount)) {
          retryCount++;
          await this.waitBeforeRetry(step.retry!, retryCount);
          continue;
        }

        break;
      }
    }

    // Execution failed
    const isTimeout = lastError?.name === 'TimeoutError';
    return {
      stepId: step.stepId,
      stepType: step.type,
      status: isTimeout ? 'timeout' : 'failure',
      durationMs: performance.now() - startTime,
      error: {
        code: isTimeout ? 'TIMEOUT' : 'EXECUTION_FAILED',
        message: lastError?.message ?? 'Unknown error',
        stack: lastError?.stack,
      },
      retryCount,
    };
  }

  /**
   * Executes a step with timeout.
   */
  private async executeWithTimeout(
    step: ScenarioStep,
    context: StepExecutionContext,
    timeout: number
  ): Promise<unknown> {
    const handler = this.handlerRegistry.get(step.type);
    if (!handler) {
      throw new Error(`No handler for step type: ${step.type}`);
    }

    return Promise.race([
      handler(step, context),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          const error = new Error(`Step timed out after ${timeout}ms`);
          error.name = 'TimeoutError';
          reject(error);
        }, timeout);
      }),
    ]);
  }

  /**
   * Checks if a retry should be attempted.
   */
  private shouldRetry(
    error: unknown,
    config: RetryConfig | undefined,
    currentRetry: number
  ): boolean {
    if (!config || currentRetry >= config.maxAttempts - 1) {
      return false;
    }

    // Check for retryable error codes
    if (config.retryableErrors && error instanceof Error) {
      const errorCode = (error as Error & { code?: string }).code;
      if (errorCode && !config.retryableErrors.includes(errorCode)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Waits before retry with exponential backoff.
   */
  private async waitBeforeRetry(
    config: RetryConfig,
    retryNumber: number
  ): Promise<void> {
    const baseDelay = config.delayMs;
    const multiplier = config.backoffMultiplier ?? 2;
    const maxDelay = config.maxDelayMs ?? 60000;

    const delay = Math.min(
      baseDelay * Math.pow(multiplier, retryNumber - 1),
      maxDelay
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // ==========================================================================
  // ASSERTIONS
  // ==========================================================================

  /**
   * Runs step assertions.
   */
  private async runAssertions(
    assertions: ReadonlyArray<StepAssertion>,
    stepOutput: unknown,
    context: StepExecutionContext
  ): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      const result = await this.evaluateAssertion(assertion, stepOutput, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluates a single assertion.
   */
  private async evaluateAssertion(
    assertion: StepAssertion,
    stepOutput: unknown,
    context: StepExecutionContext
  ): Promise<AssertionResult> {
    try {
      const actualValue = this.resolveExpression(assertion.expression, stepOutput, context);
      let passed: boolean;

      switch (assertion.type) {
        case 'equals':
          passed = this.deepEquals(actualValue, assertion.expected);
          break;
        case 'not_equals':
          passed = !this.deepEquals(actualValue, assertion.expected);
          break;
        case 'contains':
          passed = this.contains(actualValue, assertion.expected);
          break;
        case 'matches':
          passed = typeof actualValue === 'string' &&
            typeof assertion.expected === 'string' &&
            new RegExp(assertion.expected).test(actualValue);
          break;
        case 'greater_than':
          passed = typeof actualValue === 'number' &&
            typeof assertion.expected === 'number' &&
            actualValue > assertion.expected;
          break;
        case 'less_than':
          passed = typeof actualValue === 'number' &&
            typeof assertion.expected === 'number' &&
            actualValue < assertion.expected;
          break;
        case 'exists':
          passed = actualValue !== undefined && actualValue !== null;
          break;
        case 'not_exists':
          passed = actualValue === undefined || actualValue === null;
          break;
        case 'custom':
          passed = Boolean(actualValue);
          break;
        default:
          passed = false;
      }

      return {
        id: assertion.id,
        passed,
        message: passed ? undefined : assertion.message ?? `Assertion '${assertion.id}' failed`,
        actualValue,
        expectedValue: assertion.expected,
      };
    } catch (error) {
      return {
        id: assertion.id,
        passed: false,
        message: `Assertion error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Resolves an expression against step output and context.
   */
  private resolveExpression(
    expression: string,
    stepOutput: unknown,
    context: StepExecutionContext
  ): unknown {
    // Simple JSONPath-like resolution
    if (expression.startsWith('$.output')) {
      const path = expression.slice(9); // Remove '$.output'
      return this.getNestedValue(stepOutput, path);
    }
    if (expression.startsWith('$.state')) {
      const path = expression.slice(8); // Remove '$.state'
      return context.getStateValue(path);
    }
    return expression;
  }

  /**
   * Gets a nested value from an object.
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    if (!path || path === '') return obj;

    const parts = path.replace(/^\./, '').split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Deep equality check.
   */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => this.deepEquals(val, b[idx]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object);
      const keysB = Object.keys(b as object);
      if (keysA.length !== keysB.length) return false;
      return keysA.every(
        (key) =>
          keysB.includes(key) &&
          this.deepEquals(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key]
          )
      );
    }

    return false;
  }

  /**
   * Contains check for arrays and strings.
   */
  private contains(haystack: unknown, needle: unknown): boolean {
    if (Array.isArray(haystack)) {
      return haystack.some((item) => this.deepEquals(item, needle));
    }
    if (typeof haystack === 'string' && typeof needle === 'string') {
      return haystack.includes(needle);
    }
    return false;
  }

  // ==========================================================================
  // DEFAULT STEP HANDLERS
  // ==========================================================================

  /**
   * Handles agent action steps.
   */
  private async handleAgentAction(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as AgentActionConfig;
    // In simulation, agent actions are mocked
    // This would be overridden by custom handlers
    return {
      agentId: config.agentId,
      action: config.action,
      parameters: config.parameters,
      simulated: true,
    };
  }

  /**
   * Handles data injection steps.
   */
  private async handleDataInjection(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as DataInjectionConfig;
    // Data injection updates the mock data source
    return {
      dataSource: config.dataSource,
      entityType: config.entityType,
      mode: config.mode,
      recordCount: Array.isArray(config.data) ? config.data.length : 0,
    };
  }

  /**
   * Handles state mutation steps.
   */
  private async handleStateMutation(
    step: ScenarioStep,
    context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as StateMutationConfig;
    context.updateState(config.path, config.value);
    return {
      path: config.path,
      operation: config.operation,
      applied: true,
    };
  }

  /**
   * Handles policy evaluation steps.
   */
  private async handlePolicyEvaluation(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as PolicyEvaluationConfig;
    // Policy evaluation would use the PolicyEngine
    // This is a placeholder
    return {
      policyIds: config.policyIds,
      context: config.context,
      outcome: config.expectOutcome ?? 'allow',
      simulated: true,
    };
  }

  /**
   * Handles assertion steps.
   */
  private async handleAssertion(
    step: ScenarioStep,
    context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as AssertionConfig;
    const results = await this.runAssertions(config.assertions, null, context);

    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0 && config.failFast) {
      throw new AssertionError('Assertions failed', results);
    }

    return {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: failed.length,
      results,
    };
  }

  /**
   * Handles delay steps.
   */
  private async handleDelay(
    step: ScenarioStep,
    context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as DelayConfig;

    if (config.simulatedOnly) {
      // Only advance simulated time, no real delay
      context.advanceTime(config.durationMs);
    } else {
      // Real delay and simulated time advance
      await new Promise((resolve) => setTimeout(resolve, config.durationMs));
      context.advanceTime(config.durationMs);
    }

    return {
      delayMs: config.durationMs,
      simulatedOnly: config.simulatedOnly ?? false,
    };
  }

  /**
   * Handles branch steps.
   */
  private async handleBranch(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as BranchConfig;
    // Branch evaluation would be handled at the graph level
    return {
      condition: config.condition,
      branchTaken: 'true', // Placeholder
    };
  }

  /**
   * Handles loop steps.
   */
  private async handleLoop(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as LoopConfig;
    // Loop execution would be handled at the graph level
    return {
      type: config.type,
      iterations: config.count ?? 0,
    };
  }

  /**
   * Handles checkpoint steps.
   */
  private async handleCheckpoint(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    const config = step.config as CheckpointConfig;
    return {
      label: config.label,
      description: config.description,
      timestamp: this.getTime(),
    };
  }

  /**
   * Handles custom steps (placeholder).
   */
  private async handleCustom(
    step: ScenarioStep,
    _context: StepExecutionContext
  ): Promise<unknown> {
    return {
      stepId: step.stepId,
      type: 'custom',
      config: step.config,
    };
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Error thrown when assertions fail.
 */
export class AssertionError extends Error {
  readonly results: ReadonlyArray<AssertionResult>;

  constructor(message: string, results: ReadonlyArray<AssertionResult>) {
    super(message);
    this.name = 'AssertionError';
    this.results = results;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a step executor.
 */
export function createStepExecutor(
  handlerRegistry?: StepHandlerRegistry,
  options?: {
    defaultTimeout?: number;
    getTime?: () => ISOTimestamp;
  }
): StepExecutor {
  return new StepExecutor(handlerRegistry, options);
}

/**
 * Creates a step handler registry.
 */
export function createStepHandlerRegistry(): StepHandlerRegistry {
  return new StepHandlerRegistry();
}
