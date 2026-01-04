/**
 * Scenario types for the Agentics Simulation Engine.
 *
 * Scenarios define what to simulate - the sequence of steps,
 * conditions, assertions, and expected outcomes.
 *
 * @module types/scenario
 */

import type {
  ScenarioId,
  StepId,
  ISOTimestamp,
  SemanticVersion,
  ContentHash,
} from './common.js';

// ============================================================================
// SCENARIO CATEGORY
// ============================================================================

/**
 * Categories of scenarios for organization and filtering.
 */
export type ScenarioCategory =
  | 'deployment'
  | 'policy'
  | 'integration'
  | 'failure'
  | 'performance'
  | 'compliance'
  | 'migration'
  | 'what-if'
  | 'custom';

// ============================================================================
// STEP TYPES
// ============================================================================

/**
 * Types of steps that can be executed in a scenario.
 */
export type StepType =
  | 'agent_action'
  | 'data_injection'
  | 'state_mutation'
  | 'policy_evaluation'
  | 'assertion'
  | 'delay'
  | 'branch'
  | 'loop'
  | 'subprocess'
  | 'checkpoint'
  | 'custom';

// ============================================================================
// PRECONDITIONS AND POSTCONDITIONS
// ============================================================================

/**
 * A precondition that must be satisfied before scenario execution.
 */
export interface Precondition {
  readonly id: string;
  readonly description: string;
  readonly expression: string;
  readonly errorMessage?: string;
}

/**
 * A postcondition that should be verified after scenario execution.
 */
export interface Postcondition {
  readonly id: string;
  readonly description: string;
  readonly expression: string;
  readonly severity: 'error' | 'warning';
}

// ============================================================================
// STEP CONFIGURATION
// ============================================================================

/**
 * Ordering constraints for a step.
 */
export interface StepOrder {
  /** Execution index (for sequential ordering) */
  readonly index: number;
  /** Parallel execution group (steps in same group can run concurrently) */
  readonly parallelGroup?: string;
  /** Steps that must complete before this step can run */
  readonly dependsOn?: ReadonlyArray<StepId>;
}

/**
 * Retry configuration for a step.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  readonly maxAttempts: number;
  /** Delay between retries in milliseconds */
  readonly delayMs: number;
  /** Backoff multiplier for exponential backoff */
  readonly backoffMultiplier?: number;
  /** Maximum delay between retries */
  readonly maxDelayMs?: number;
  /** Error codes that should trigger retry */
  readonly retryableErrors?: ReadonlyArray<string>;
}

/**
 * Condition for conditional step execution.
 */
export interface StepCondition {
  /** Expression language */
  readonly lang: 'jsonpath' | 'jmespath' | 'custom';
  /** Condition expression */
  readonly expression: string;
  /** What to do if condition is not met */
  readonly onFalse?: 'skip' | 'fail' | 'warn';
}

/**
 * An assertion to verify after step execution.
 */
export interface StepAssertion {
  readonly id: string;
  readonly type: 'equals' | 'not_equals' | 'contains' | 'matches' | 'greater_than' | 'less_than' | 'exists' | 'not_exists' | 'custom';
  readonly description?: string;
  readonly expression: string;
  readonly expected?: unknown;
  readonly message?: string;
  readonly severity: 'error' | 'warning';
}

// ============================================================================
// STEP TYPE CONFIGURATIONS
// ============================================================================

/**
 * Configuration for an agent action step.
 */
export interface AgentActionConfig {
  readonly agentId: string;
  readonly action: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly timeout?: number;
}

/**
 * Configuration for a data injection step.
 */
export interface DataInjectionConfig {
  readonly dataSource: string;
  readonly entityType: string;
  readonly data: ReadonlyArray<Readonly<Record<string, unknown>>> | string;
  readonly mode: 'insert' | 'upsert' | 'replace';
}

/**
 * Configuration for a state mutation step.
 */
export interface StateMutationConfig {
  readonly path: string;
  readonly operation: 'set' | 'append' | 'remove' | 'increment' | 'merge';
  readonly value?: unknown;
}

/**
 * Configuration for a policy evaluation step.
 */
export interface PolicyEvaluationConfig {
  readonly policyIds?: ReadonlyArray<string>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly expectOutcome?: 'allow' | 'deny' | 'warn';
}

/**
 * Configuration for an assertion step.
 */
export interface AssertionConfig {
  readonly assertions: ReadonlyArray<StepAssertion>;
  readonly failFast?: boolean;
}

/**
 * Configuration for a delay step.
 */
export interface DelayConfig {
  readonly durationMs: number;
  readonly simulatedOnly?: boolean;
}

/**
 * Configuration for a branch step.
 */
export interface BranchConfig {
  readonly condition: StepCondition;
  readonly trueBranch: ReadonlyArray<ScenarioStep>;
  readonly falseBranch?: ReadonlyArray<ScenarioStep>;
}

/**
 * Configuration for a loop step.
 */
export interface LoopConfig {
  readonly type: 'count' | 'while' | 'for_each';
  readonly count?: number;
  readonly condition?: StepCondition;
  readonly items?: string; // JSONPath to array
  readonly itemVariable?: string;
  readonly maxIterations?: number;
  readonly body: ReadonlyArray<ScenarioStep>;
}

/**
 * Configuration for a subprocess step.
 */
export interface SubprocessConfig {
  readonly scenarioId: ScenarioId;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly isolated?: boolean;
}

/**
 * Configuration for a checkpoint step.
 */
export interface CheckpointConfig {
  readonly label: string;
  readonly description?: string;
}

/**
 * Union of all step configurations.
 */
export type StepConfig =
  | AgentActionConfig
  | DataInjectionConfig
  | StateMutationConfig
  | PolicyEvaluationConfig
  | AssertionConfig
  | DelayConfig
  | BranchConfig
  | LoopConfig
  | SubprocessConfig
  | CheckpointConfig
  | Readonly<Record<string, unknown>>;

// ============================================================================
// SCENARIO STEP
// ============================================================================

/**
 * A single step in a scenario.
 */
export interface ScenarioStep {
  /** Unique identifier for this step */
  readonly stepId: StepId;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this step does */
  readonly description?: string;
  /** Ordering constraints */
  readonly order: StepOrder;
  /** Type of step */
  readonly type: StepType;
  /** Type-specific configuration */
  readonly config: StepConfig;
  /** Condition for execution (optional) */
  readonly when?: StepCondition;
  /** Retry configuration (optional) */
  readonly retry?: RetryConfig;
  /** Timeout in milliseconds */
  readonly timeoutMs?: number;
  /** Assertions to run after step completion */
  readonly assertions?: ReadonlyArray<StepAssertion>;
  /** Whether to continue scenario if this step fails */
  readonly continueOnFailure?: boolean;
  /** Tags for categorization */
  readonly tags?: ReadonlyArray<string>;
  /** Custom metadata */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SETUP AND TEARDOWN
// ============================================================================

/**
 * A setup step that runs before scenario execution.
 */
export interface SetupStep {
  readonly id: string;
  readonly name: string;
  readonly type: 'data_injection' | 'state_mutation' | 'mock_setup' | 'custom';
  readonly config: Readonly<Record<string, unknown>>;
  readonly required: boolean;
}

/**
 * A teardown step that runs after scenario execution.
 */
export interface TeardownStep {
  readonly id: string;
  readonly name: string;
  readonly type: 'cleanup' | 'verify' | 'report' | 'custom';
  readonly config: Readonly<Record<string, unknown>>;
  readonly alwaysRun: boolean;
}

// ============================================================================
// EXPECTATIONS
// ============================================================================

/**
 * An expectation to verify scenario outcomes.
 */
export interface Expectation {
  readonly id: string;
  readonly description: string;
  readonly type: 'state' | 'output' | 'policy' | 'performance' | 'custom';
  readonly expression: string;
  readonly expected?: unknown;
  readonly tolerance?: number;
  readonly severity: 'error' | 'warning' | 'info';
}

// ============================================================================
// SCENARIO PARAMETERS
// ============================================================================

/**
 * Definition of a scenario parameter.
 */
export interface ParameterDefinition {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly required: boolean;
  readonly default?: unknown;
  readonly validation?: {
    readonly min?: number;
    readonly max?: number;
    readonly pattern?: string;
    readonly enum?: ReadonlyArray<unknown>;
  };
}

/**
 * Parameters for scenario execution.
 */
export type ScenarioParameters = Readonly<Record<string, unknown>>;

// ============================================================================
// SCENARIO DEFINITION
// ============================================================================

/**
 * Complete scenario definition.
 */
export interface Scenario {
  /** Unique identifier for this scenario */
  readonly scenarioId: ScenarioId;
  /** Version of this scenario */
  readonly version: SemanticVersion;
  /** Human-readable name */
  readonly name: string;
  /** Detailed description */
  readonly description: string;
  /** Category for organization */
  readonly category: ScenarioCategory;
  /** Tags for filtering */
  readonly tags: ReadonlyArray<string>;
  /** Parameter definitions */
  readonly parameterDefinitions?: ReadonlyArray<ParameterDefinition>;
  /** Default parameter values */
  readonly defaultParameters?: ScenarioParameters;
  /** Preconditions to check before execution */
  readonly preconditions: ReadonlyArray<Precondition>;
  /** Setup steps to run before main execution */
  readonly setup: ReadonlyArray<SetupStep>;
  /** Main scenario steps */
  readonly steps: ReadonlyArray<ScenarioStep>;
  /** Teardown steps to run after execution */
  readonly teardown: ReadonlyArray<TeardownStep>;
  /** Expectations to verify */
  readonly expectations: ReadonlyArray<Expectation>;
  /** Postconditions to check after execution */
  readonly postconditions?: ReadonlyArray<Postcondition>;
  /** Overall timeout for the scenario */
  readonly timeoutMs?: number;
  /** Whether this scenario can be run in parallel with others */
  readonly parallelizable?: boolean;
  /** Dependencies on other scenarios */
  readonly dependencies?: ReadonlyArray<ScenarioId>;
  /** Scenario author */
  readonly author?: string;
  /** Creation timestamp */
  readonly createdAt?: ISOTimestamp;
  /** Last modified timestamp */
  readonly updatedAt?: ISOTimestamp;
  /** Content hash for integrity verification */
  readonly contentHash?: ContentHash;
}

// ============================================================================
// PREPARED SCENARIO
// ============================================================================

/**
 * A scenario that has been loaded and prepared for execution.
 * This includes resolved parameters and computed execution graph.
 */
export interface PreparedScenario {
  /** The original scenario definition */
  readonly definition: Scenario;
  /** Resolved parameters (defaults merged with provided values) */
  readonly resolvedParameters: ScenarioParameters;
  /** Total number of steps to execute */
  readonly totalSteps: number;
  /** Estimated duration in milliseconds */
  readonly estimatedDurationMs: number;
  /** Content hash after parameter resolution */
  readonly contentHash: ContentHash;
}

// ============================================================================
// SCENARIO VALIDATION
// ============================================================================

/**
 * Result of scenario validation.
 */
export interface ScenarioValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly severity: 'error';
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly severity: 'warning';
  }>;
}
