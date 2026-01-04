/**
 * Test fixtures for simulation engine tests.
 */

import type {
  SimulationId,
  ScenarioId,
  PolicyId,
  StepId,
  ISOTimestamp,
  ResourceLimits,
  TimingConfig,
} from '../../src/types/common.js';
import type { Scenario, ScenarioStep } from '../../src/types/scenario.js';
import type { Policy, PolicyRule } from '../../src/types/policy.js';
import type { SimulationConfig, ArtifactConfig } from '../../src/types/simulation.js';

// ============================================================================
// TEST IDS
// ============================================================================

export const TEST_SIMULATION_ID = 'sim-test-001' as SimulationId;
export const TEST_SCENARIO_ID = 'scenario-test-001' as ScenarioId;
export const TEST_POLICY_ID = 'policy-test-001' as PolicyId;
export const TEST_STEP_ID = 'step-test-001' as StepId;
export const TEST_TIMESTAMP = '2026-01-04T12:00:00.000Z' as ISOTimestamp;

// ============================================================================
// TEST RESOURCE LIMITS
// ============================================================================

export const TEST_RESOURCE_LIMITS: ResourceLimits = {
  maxExecutionTimeMs: 60_000,
  maxMemoryBytes: 512_000_000,
  maxConcurrency: 4,
  maxSnapshots: 10,
  maxTraceEvents: 1000,
};

// ============================================================================
// TEST TIMING CONFIG
// ============================================================================

export const TEST_TIMING_CONFIG: TimingConfig = {
  mode: 'controlled',
  simulatedStartTime: TEST_TIMESTAMP,
  stepDurationMs: 100,
};

// ============================================================================
// TEST SCENARIO
// ============================================================================

export function createTestStep(overrides?: Partial<ScenarioStep>): ScenarioStep {
  return {
    stepId: TEST_STEP_ID,
    name: 'Test Step',
    type: 'assertion',
    config: {
      condition: { type: 'literal', value: true },
    },
    timeout: 5000,
    retries: 0,
    ...overrides,
  };
}

export function createTestScenario(overrides?: Partial<Scenario>): Scenario {
  return {
    scenarioId: TEST_SCENARIO_ID,
    name: 'Test Scenario',
    version: '1.0.0',
    description: 'A test scenario for unit tests',
    steps: [createTestStep()],
    entryPoints: [TEST_STEP_ID],
    tags: ['test'],
    ...overrides,
  };
}

// ============================================================================
// TEST POLICIES
// ============================================================================

export function createTestPolicyRule(overrides?: Partial<PolicyRule>): PolicyRule {
  return {
    ruleId: 'rule-test-001',
    name: 'Test Rule',
    priority: 100,
    condition: {
      type: 'expression',
      language: 'jsonpath',
      expression: '$.allowed',
    },
    effect: 'allow',
    ...overrides,
  };
}

export function createTestPolicy(overrides?: Partial<Policy>): Policy {
  return {
    policyId: TEST_POLICY_ID,
    name: 'Test Policy',
    version: '1.0.0',
    description: 'A test policy for unit tests',
    enforcement: 'enforcing',
    rules: [createTestPolicyRule()],
    tags: ['test'],
    ...overrides,
  };
}

// ============================================================================
// TEST ARTIFACT CONFIG
// ============================================================================

export const TEST_ARTIFACT_CONFIG: ArtifactConfig = {
  generateReport: true,
  generatePolicyLog: true,
  generateStateSnapshots: false,
  generateTrace: true,
  formats: ['json'],
  signArtifacts: false,
};

// ============================================================================
// TEST SIMULATION CONFIG
// ============================================================================

export function createTestSimulationConfig(
  overrides?: Partial<SimulationConfig>
): SimulationConfig {
  return {
    simulationId: TEST_SIMULATION_ID,
    scenario: {
      scenarioId: TEST_SCENARIO_ID,
      version: '1.0.0',
    },
    policies: [
      {
        policyId: TEST_POLICY_ID,
        version: '1.0.0',
      },
    ],
    resourceLimits: TEST_RESOURCE_LIMITS,
    timing: TEST_TIMING_CONFIG,
    dataSources: [],
    artifactConfig: TEST_ARTIFACT_CONFIG,
    observability: {
      tracingEnabled: true,
      metricsEnabled: true,
      loggingLevel: 'info',
    },
    metadata: {
      createdBy: 'test',
      environment: 'test',
      seed: 12345,
    },
    ...overrides,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a mock time provider for testing.
 */
export function createMockTimeProvider(
  startTime: ISOTimestamp = TEST_TIMESTAMP
): () => ISOTimestamp {
  let current = new Date(startTime).getTime();
  return () => {
    const timestamp = new Date(current).toISOString() as ISOTimestamp;
    current += 1000; // Advance by 1 second each call
    return timestamp;
  };
}

/**
 * Creates a fixed time provider for testing.
 */
export function createFixedTimeProvider(
  time: ISOTimestamp = TEST_TIMESTAMP
): () => ISOTimestamp {
  return () => time;
}
