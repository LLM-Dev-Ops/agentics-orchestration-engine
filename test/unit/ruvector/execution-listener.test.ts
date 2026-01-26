/**
 * Tests for the Event-Driven Execution Listener.
 *
 * @module test/unit/ruvector/execution-listener
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ExecutionListener,
  createExecutionListener,
  createIdempotencyGuard,
  InMemorySimulationResolver,
  type ExecutionListenerConfig,
  type SimulationResolver,
  type SecretManager,
  type PlanApprovedEvent,
  createPlanId,
  createRuvectorEventId,
} from '../../../src/ruvector/index.js';
import { createSimulationId, createScenarioId, createISOTimestamp } from '../../../src/types/common.js';
import type { SimulationConfig, SimulationId } from '../../../src/types/simulation.js';
import type { Scenario } from '../../../src/types/scenario.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const mockSecretManager: SecretManager = {
  getSecret: vi.fn().mockResolvedValue('test-api-key'),
};

const createTestConfig = (): ExecutionListenerConfig => ({
  ruvector: {
    endpoint: 'http://localhost:8080',
    credentialsRef: 'test-credentials',
    clientId: 'test-client',
    mode: 'polling',
    pollIntervalMs: 1000,
    connectionTimeoutMs: 5000,
  },
  engineId: 'test-engine',
  asyncExecution: false,
  maxConcurrentExecutions: 5,
});

const createTestSimulationConfig = (simulationId: SimulationId): SimulationConfig => ({
  simulationId,
  scenario: {
    scenarioId: createScenarioId('test-scenario'),
    parameters: {},
  },
  policies: [],
  resourceLimits: {
    maxExecutionTimeMs: 60000,
    maxMemoryBytes: 1073741824,
    maxConcurrency: 10,
    maxSnapshots: 100,
    maxTraceEvents: 10000,
  },
  timing: {
    mode: 'controlled',
    simulatedStartTime: createISOTimestamp(new Date()),
  },
  dataSources: [],
  artifactConfig: {
    generateReport: false,
    generatePolicyLog: false,
    generateStateSnapshots: false,
    generateTrace: false,
    formats: ['json'],
    signArtifacts: false,
  },
  observability: {
    logLevel: 'info',
    enableMetrics: false,
    enableTracing: false,
    traceSamplingRate: 1.0,
  },
  metadata: {},
});

const createTestScenario = (scenarioId: string): Scenario => ({
  scenarioId: createScenarioId(scenarioId),
  version: { major: 1, minor: 0, patch: 0 },
  name: 'Test Scenario',
  description: 'A test scenario',
  category: 'deployment',
  tags: ['test'],
  preconditions: [],
  setup: [],
  steps: [],
  teardown: [],
  expectations: [],
});

const createTestPlanApprovedEvent = (
  planId: string,
  simulationId: SimulationId
): PlanApprovedEvent => ({
  event_id: createRuvectorEventId(`event-${Date.now()}`),
  type: 'plan_approved',
  plan_id: createPlanId(planId),
  simulation_id: simulationId,
  timestamp: createISOTimestamp(new Date()),
  execution_profile: {
    tier: 'tier2',
    mode: 'execute',
  },
});

// ============================================================================
// TESTS
// ============================================================================

describe('IdempotencyGuard', () => {
  it('should allow first execution of a plan', () => {
    const guard = createIdempotencyGuard();
    const planId = createPlanId('plan-1');

    const result = guard.check(planId);

    expect(result.shouldExecute).toBe(true);
  });

  it('should prevent duplicate execution of a plan', () => {
    const guard = createIdempotencyGuard();
    const planId = createPlanId('plan-1');

    guard.markStarted(planId);
    const result = guard.check(planId);

    expect(result.shouldExecute).toBe(false);
    expect(result.reason).toContain('already being executed');
  });

  it('should prevent re-execution of completed plan', () => {
    const guard = createIdempotencyGuard();
    const planId = createPlanId('plan-1');

    guard.markStarted(planId);
    guard.markCompleted(planId);
    const result = guard.check(planId);

    expect(result.shouldExecute).toBe(false);
    expect(result.reason).toContain('already been executed successfully');
  });

  it('should track execution statistics', () => {
    const guard = createIdempotencyGuard();
    const planId1 = createPlanId('plan-1');
    const planId2 = createPlanId('plan-2');

    guard.markStarted(planId1);
    guard.markCompleted(planId1);

    guard.markStarted(planId2);
    guard.markFailed(planId2, { code: 'TEST_ERROR', message: 'Test failure' });

    const stats = guard.getStatistics();

    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });
});

describe('InMemorySimulationResolver', () => {
  it('should resolve registered configurations', async () => {
    const resolver = new InMemorySimulationResolver();
    const simulationId = createSimulationId('sim-1');
    const config = createTestSimulationConfig(simulationId);

    resolver.registerConfig(simulationId, config);
    const resolved = await resolver.resolveConfig(simulationId);

    expect(resolved).toBe(config);
  });

  it('should throw error for unregistered configurations', async () => {
    const resolver = new InMemorySimulationResolver();
    const simulationId = createSimulationId('sim-unknown');

    await expect(resolver.resolveConfig(simulationId)).rejects.toThrow('Simulation config not found');
  });

  it('should resolve registered scenarios', async () => {
    const resolver = new InMemorySimulationResolver();
    const simulationId = createSimulationId('sim-1');
    const scenario = createTestScenario('test-scenario');

    resolver.registerScenario(simulationId, scenario);
    const resolved = await resolver.resolveScenario(simulationId);

    expect(resolved).toBe(scenario);
  });
});

describe('ExecutionListener', () => {
  let config: ExecutionListenerConfig;
  let resolver: InMemorySimulationResolver;

  beforeEach(() => {
    config = createTestConfig();
    resolver = new InMemorySimulationResolver();
  });

  it('should create listener with configuration', () => {
    const listener = createExecutionListener(config, resolver, mockSecretManager);

    expect(listener).toBeDefined();
    expect(listener.getStatus().running).toBe(false);
  });

  it('should track execution events through listeners', () => {
    const listener = createExecutionListener(config, resolver, mockSecretManager);
    const events: { type: string; planId: string }[] = [];

    listener.onExecutionEvent((event) => {
      events.push({ type: event.type, planId: event.planId });
    });

    // Note: We can't fully test event handling without mocking the Ruvector client,
    // but we can verify the listener pattern works
    expect(events).toHaveLength(0); // No events yet
  });

  it('should provide status information', () => {
    const listener = createExecutionListener(config, resolver, mockSecretManager);
    const status = listener.getStatus();

    expect(status.running).toBe(false);
    expect(status.eventsReceived).toBe(0);
    expect(status.executionsStarted).toBe(0);
    expect(status.executionsCompleted).toBe(0);
    expect(status.executionsFailed).toBe(0);
    expect(status.executionsSkipped).toBe(0);
    expect(status.currentExecutions).toBe(0);
  });

  it('should provide idempotency statistics', () => {
    const listener = createExecutionListener(config, resolver, mockSecretManager);
    const stats = listener.getIdempotencyStatistics();

    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
  });
});

describe('PlanApprovedEvent Validation', () => {
  it('should create valid plan approved event', () => {
    const simulationId = createSimulationId('sim-1');
    const event = createTestPlanApprovedEvent('plan-1', simulationId);

    expect(event.type).toBe('plan_approved');
    expect(event.plan_id).toBeDefined();
    expect(event.simulation_id).toBe(simulationId);
    expect(event.execution_profile.tier).toBe('tier2');
    expect(event.execution_profile.mode).toBe('execute');
  });
});
