/**
 * Scenario Manager.
 *
 * Orchestrates scenario execution, managing the lifecycle
 * of scenario preparation, execution, and result collection.
 *
 * @module scenario/manager
 */

import type { SimulationId, ScenarioId, ISOTimestamp, StepId } from '../types/common.js';
import type {
  Scenario,
  PreparedScenario,
  ScenarioParameters,
  ScenarioValidationResult,
  ScenarioStep,
} from '../types/scenario.js';
import type { StepResult, ExpectationResult } from '../types/simulation.js';
import {
  ScenarioLoader,
  createScenarioLoader,
  type ScenarioSource,
  type ScenarioLoadOptions,
} from './loader.js';
import {
  ExecutionGraph,
  createExecutionGraph,
  type GraphStatistics,
} from './graph.js';
import {
  StepExecutor,
  createStepExecutor,
  type StepExecutionResult,
  type StepExecutionContext,
  type StepHandlerRegistry,
} from './executor.js';

// ============================================================================
// SCENARIO MANAGER CONFIGURATION
// ============================================================================

/**
 * Configuration for the scenario manager.
 */
export interface ScenarioManagerConfig {
  /** Simulation ID for context */
  readonly simulationId: SimulationId;
  /** Default step timeout in milliseconds */
  readonly defaultStepTimeout?: number;
  /** Maximum parallel steps */
  readonly maxParallelSteps?: number;
  /** Whether to continue on step failure */
  readonly continueOnFailure?: boolean;
  /** Time provider for deterministic execution */
  readonly getTime?: () => ISOTimestamp;
  /** Custom step handlers */
  readonly customHandlers?: StepHandlerRegistry;
}

/**
 * Default scenario manager configuration.
 */
export const DEFAULT_SCENARIO_MANAGER_CONFIG: Omit<
  ScenarioManagerConfig,
  'simulationId'
> = {
  defaultStepTimeout: 30000,
  maxParallelSteps: 10,
  continueOnFailure: false,
};

// ============================================================================
// EXECUTION STATUS
// ============================================================================

/**
 * Status of scenario execution.
 */
export type ScenarioExecutionStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Progress information for scenario execution.
 */
export interface ScenarioProgress {
  readonly status: ScenarioExecutionStatus;
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly failedSteps: number;
  readonly skippedSteps: number;
  readonly currentSteps: ReadonlyArray<StepId>;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs?: number;
}

// ============================================================================
// SCENARIO EXECUTION RESULT
// ============================================================================

/**
 * Complete result of scenario execution.
 */
export interface ScenarioExecutionResult {
  readonly scenarioId: ScenarioId;
  readonly status: 'passed' | 'failed' | 'partial' | 'cancelled';
  readonly stepResults: ReadonlyArray<StepResult>;
  readonly expectationResults: ReadonlyArray<ExpectationResult>;
  readonly executionTimeMs: number;
  readonly graphStatistics: GraphStatistics;
  readonly coverage: {
    readonly stepsTotal: number;
    readonly stepsExecuted: number;
    readonly stepsPassed: number;
    readonly stepsFailed: number;
    readonly stepsSkipped: number;
    readonly branchesTotal: number;
    readonly branchesTaken: number;
  };
}

// ============================================================================
// SCENARIO MANAGER CLASS
// ============================================================================

/**
 * Manages scenario loading and execution.
 *
 * Key features:
 * - Scenario loading and preparation
 * - Graph-based execution ordering
 * - Parallel step execution
 * - Progress tracking
 * - Result aggregation
 */
export class ScenarioManager {
  private readonly config: Required<Omit<ScenarioManagerConfig, 'customHandlers' | 'getTime'>> & {
    getTime: () => ISOTimestamp;
    customHandlers?: StepHandlerRegistry;
  };
  private readonly loader: ScenarioLoader;
  private readonly executor: StepExecutor;

  private currentScenario?: PreparedScenario;
  private currentGraph?: ExecutionGraph;
  private executionStatus: ScenarioExecutionStatus = 'pending';
  private startTime?: number;
  private stepResults: Map<StepId, StepExecutionResult> = new Map();
  private cancelled = false;
  private paused = false;

  constructor(config: ScenarioManagerConfig) {
    this.config = {
      simulationId: config.simulationId,
      defaultStepTimeout: config.defaultStepTimeout ?? DEFAULT_SCENARIO_MANAGER_CONFIG.defaultStepTimeout!,
      maxParallelSteps: config.maxParallelSteps ?? DEFAULT_SCENARIO_MANAGER_CONFIG.maxParallelSteps!,
      continueOnFailure: config.continueOnFailure ?? DEFAULT_SCENARIO_MANAGER_CONFIG.continueOnFailure!,
      getTime: config.getTime ?? (() => new Date().toISOString() as ISOTimestamp),
      customHandlers: config.customHandlers,
    };

    this.loader = createScenarioLoader();
    this.executor = createStepExecutor(config.customHandlers, {
      defaultTimeout: this.config.defaultStepTimeout,
      getTime: this.config.getTime,
    });
  }

  // ==========================================================================
  // SCENARIO LOADING
  // ==========================================================================

  /**
   * Loads a scenario from a source.
   */
  async loadScenario(
    source: ScenarioSource,
    options?: ScenarioLoadOptions
  ): Promise<Scenario> {
    return this.loader.load(source, options);
  }

  /**
   * Prepares a scenario for execution.
   */
  prepareScenario(
    scenario: Scenario,
    parameters?: ScenarioParameters
  ): PreparedScenario {
    const prepared = this.loader.prepare(scenario, parameters);
    this.currentScenario = prepared;
    this.currentGraph = createExecutionGraph(prepared.definition.steps);
    this.executionStatus = 'preparing';
    return prepared;
  }

  /**
   * Validates a scenario.
   */
  validateScenario(scenario: Scenario): ScenarioValidationResult {
    return this.loader.validate(scenario);
  }

  // ==========================================================================
  // SCENARIO EXECUTION
  // ==========================================================================

  /**
   * Executes the prepared scenario.
   */
  async execute(
    stateProvider: StateProvider
  ): Promise<ScenarioExecutionResult> {
    if (!this.currentScenario || !this.currentGraph) {
      throw new Error('No scenario prepared for execution');
    }

    this.executionStatus = 'running';
    this.startTime = performance.now();
    this.stepResults.clear();
    this.cancelled = false;
    this.paused = false;

    const scenario = this.currentScenario.definition;
    const graph = this.currentGraph;

    try {
      // Execute steps in graph order
      while (!graph.isComplete() && !this.cancelled) {
        // Wait if paused
        while (this.paused && !this.cancelled) {
          await this.delay(100);
        }

        if (this.cancelled) break;

        // Get ready steps
        const readySteps = graph.getReadySteps();
        if (readySteps.length === 0) {
          // No ready steps but not complete - there's a failure blocking progress
          if (graph.hasFailures() && !this.config.continueOnFailure) {
            break;
          }
          // Safety check - shouldn't happen in valid graph
          break;
        }

        // Execute steps (with parallelism limit)
        const stepsToExecute = readySteps.slice(0, this.config.maxParallelSteps);
        await this.executeSteps(stepsToExecute, stateProvider);
      }

      // Determine final status
      const statistics = graph.getStatistics();
      const status = this.determineStatus(statistics);

      // Evaluate expectations
      const expectationResults = await this.evaluateExpectations(
        scenario,
        stateProvider
      );

      this.executionStatus = status === 'cancelled' ? 'cancelled' :
        status === 'failed' ? 'failed' : 'completed';

      return {
        scenarioId: scenario.scenarioId,
        status,
        stepResults: this.buildStepResults(),
        expectationResults,
        executionTimeMs: performance.now() - this.startTime!,
        graphStatistics: statistics,
        coverage: {
          stepsTotal: statistics.total,
          stepsExecuted: statistics.completed + statistics.failed + statistics.skipped,
          stepsPassed: statistics.completed,
          stepsFailed: statistics.failed,
          stepsSkipped: statistics.skipped,
          branchesTotal: this.countBranches(scenario.steps),
          branchesTaken: this.countBranchesTaken(),
        },
      };
    } catch (error) {
      this.executionStatus = 'failed';
      throw error;
    }
  }

  /**
   * Executes a batch of steps.
   */
  private async executeSteps(
    stepIds: ReadonlyArray<StepId>,
    stateProvider: StateProvider
  ): Promise<void> {
    const graph = this.currentGraph!;

    // Execute in parallel
    const promises = stepIds.map(async (stepId) => {
      const node = graph.getNode(stepId);
      if (!node) return;

      const step = node.step;

      // Check condition
      if (step.when) {
        const shouldExecute = await this.evaluateCondition(step.when, stateProvider);
        if (!shouldExecute) {
          graph.markSkipped(stepId);
          return;
        }
      }

      // Mark as started
      graph.markStarted(stepId);

      // Create execution context
      const context = this.createStepContext(stateProvider);

      // Execute step
      const result = await this.executor.execute(step, context);
      this.stepResults.set(stepId, result);

      // Update graph state
      if (result.status === 'success') {
        graph.markCompleted(stepId, result.output);
      } else if (result.status === 'skipped') {
        graph.markSkipped(stepId);
      } else {
        const error = new Error(result.error?.message ?? 'Step failed');
        graph.markFailed(stepId, error);

        // Handle failure based on step configuration
        if (!step.continueOnFailure && !this.config.continueOnFailure) {
          // Mark dependent steps as skipped
          this.skipDependentSteps(stepId);
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * Skips all steps that depend on a failed step.
   */
  private skipDependentSteps(failedStepId: StepId): void {
    const graph = this.currentGraph!;
    const node = graph.getNode(failedStepId);
    if (!node) return;

    const visited = new Set<StepId>();
    const toSkip = [...node.dependents];

    while (toSkip.length > 0) {
      const stepId = toSkip.shift()!;
      if (visited.has(stepId)) continue;
      visited.add(stepId);

      graph.markSkipped(stepId);

      const depNode = graph.getNode(stepId);
      if (depNode) {
        toSkip.push(...depNode.dependents);
      }
    }
  }

  /**
   * Creates execution context for a step.
   */
  private createStepContext(stateProvider: StateProvider): StepExecutionContext {
    return {
      simulatedTime: this.config.getTime(),
      state: stateProvider.getState(),
      getStateValue: (path) => stateProvider.getValue(path),
      updateState: (path, value) => stateProvider.setValue(path, value),
      advanceTime: (ms) => stateProvider.advanceTime(ms),
      graph: this.currentGraph!,
    };
  }

  /**
   * Evaluates a step condition.
   */
  private async evaluateCondition(
    condition: { expression: string; onFalse?: string },
    stateProvider: StateProvider
  ): Promise<boolean> {
    // Simple expression evaluation
    // In production, this would use the expression evaluator
    try {
      const value = stateProvider.getValue(condition.expression);
      return Boolean(value);
    } catch {
      return condition.onFalse !== 'fail';
    }
  }

  /**
   * Evaluates scenario expectations.
   */
  private async evaluateExpectations(
    scenario: Scenario,
    stateProvider: StateProvider
  ): Promise<ExpectationResult[]> {
    const results: ExpectationResult[] = [];

    for (const expectation of scenario.expectations) {
      try {
        const actualValue = stateProvider.getValue(expectation.expression);
        const passed =
          expectation.expected !== undefined
            ? this.matchValue(actualValue, expectation.expected, expectation.tolerance)
            : actualValue !== undefined && actualValue !== null;

        results.push({
          expectationId: expectation.id,
          description: expectation.description,
          passed,
          actualValue,
          expectedValue: expectation.expected,
          message: passed ? undefined : `Expectation failed: ${expectation.description}`,
        });
      } catch (error) {
        results.push({
          expectationId: expectation.id,
          description: expectation.description,
          passed: false,
          message: `Error evaluating expectation: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return results;
  }

  /**
   * Matches an actual value against expected.
   */
  private matchValue(
    actual: unknown,
    expected: unknown,
    tolerance?: number
  ): boolean {
    if (typeof actual === 'number' && typeof expected === 'number' && tolerance) {
      return Math.abs(actual - expected) <= tolerance;
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  // ==========================================================================
  // EXECUTION CONTROL
  // ==========================================================================

  /**
   * Pauses execution.
   */
  pause(): void {
    if (this.executionStatus === 'running') {
      this.paused = true;
      this.executionStatus = 'paused';
    }
  }

  /**
   * Resumes execution.
   */
  resume(): void {
    if (this.executionStatus === 'paused') {
      this.paused = false;
      this.executionStatus = 'running';
    }
  }

  /**
   * Cancels execution.
   */
  cancel(): void {
    this.cancelled = true;
    this.executionStatus = 'cancelled';
  }

  /**
   * Gets current execution status.
   */
  getStatus(): ScenarioExecutionStatus {
    return this.executionStatus;
  }

  /**
   * Gets execution progress.
   */
  getProgress(): ScenarioProgress {
    if (!this.currentGraph || !this.currentScenario) {
      return {
        status: this.executionStatus,
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        currentSteps: [],
        elapsedMs: 0,
      };
    }

    const stats = this.currentGraph.getStatistics();
    const elapsedMs = this.startTime ? performance.now() - this.startTime : 0;
    const remainingSteps = stats.pending + stats.running;
    const avgStepTime = stats.completed > 0 ? elapsedMs / stats.completed : 1000;

    return {
      status: this.executionStatus,
      totalSteps: stats.total,
      completedSteps: stats.completed,
      failedSteps: stats.failed,
      skippedSteps: stats.skipped,
      currentSteps: this.currentGraph
        .getAllNodes()
        .filter((n) => this.currentGraph!.getNodeState(n.stepId)?.status === 'running')
        .map((n) => n.stepId),
      elapsedMs,
      estimatedRemainingMs: remainingSteps * avgStepTime,
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Determines final execution status.
   */
  private determineStatus(
    stats: GraphStatistics
  ): 'passed' | 'failed' | 'partial' | 'cancelled' {
    if (this.cancelled) return 'cancelled';
    if (stats.failed > 0) {
      if (stats.completed > 0) return 'partial';
      return 'failed';
    }
    return 'passed';
  }

  /**
   * Builds step results from execution.
   */
  private buildStepResults(): StepResult[] {
    const results: StepResult[] = [];

    for (const [stepId, result] of this.stepResults) {
      results.push({
        stepId,
        stepType: result.stepType,
        status: result.status === 'success' ? 'success' :
          result.status === 'skipped' ? 'skipped' : 'failure',
        durationMs: result.durationMs,
        output: result.output,
        error: result.error,
        retryCount: result.retryCount,
      });
    }

    return results;
  }

  /**
   * Counts branch steps.
   */
  private countBranches(steps: ReadonlyArray<ScenarioStep>): number {
    let count = 0;
    for (const step of steps) {
      if (step.type === 'branch') {
        count++;
      }
    }
    return count;
  }

  /**
   * Counts taken branches.
   */
  private countBranchesTaken(): number {
    // Would need to track branch decisions during execution
    return 0;
  }

  /**
   * Delays execution.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Resets the manager state.
   */
  reset(): void {
    this.currentScenario = undefined;
    this.currentGraph = undefined;
    this.executionStatus = 'pending';
    this.startTime = undefined;
    this.stepResults.clear();
    this.cancelled = false;
    this.paused = false;
  }
}

// ============================================================================
// STATE PROVIDER INTERFACE
// ============================================================================

/**
 * Interface for providing state to scenario execution.
 */
export interface StateProvider {
  getState(): Readonly<Record<string, unknown>>;
  getValue(path: string): unknown;
  setValue(path: string, value: unknown): void;
  advanceTime(ms: number): void;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a scenario manager.
 */
export function createScenarioManager(
  config: ScenarioManagerConfig
): ScenarioManager {
  return new ScenarioManager(config);
}
