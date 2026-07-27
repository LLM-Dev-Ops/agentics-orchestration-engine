/**
 * ADR-0001 verification 3: the real Core clients speak HTTP to the real Cores.
 *
 * These tests run genuine in-process node:http servers as stand-ins for the
 * Layer-3 Cores, so the client is exercised across a real socket: real request
 * serialisation, real status codes, real JSON parsing. The test double sits at
 * the HTTP boundary, never inside the client.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  HttpSecurityCoreClient,
  HttpDataCoreClient,
  HttpGovernanceCoreClient,
  HttpAutomationCoreClient,
  createHttpCoreClientRegistry,
} from '../../../src/integration/cores/http-cores.js';
import { normalizeExecutionGraph } from '../../../src/integration/cores/span-normalizer.js';
import { validateCoreSpanHierarchy } from '../../../src/integration/cores/span-validator.js';
import { CoreDelegationError } from '../../../src/integration/cores/errors.js';
import { createOrchestrationEngine } from '../../../src/core/engine.js';
import { createSpanId, createTraceId, createSimulationId } from '../../../src/types/common.js';
import type { SpanId, TraceId, ISOTimestamp } from '../../../src/types/common.js';
import type { RuvectorClient } from '../../../src/ruvector/client.js';
import type {
  SecurityCoreRequest,
  DataCoreRequest,
  GovernanceCoreRequest,
  AutomationCoreRequest,
} from '../../../src/types/core-delegation.js';

// ============================================================================
// STUB CORE SERVER
// ============================================================================

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Record<string, unknown>;
}

interface StubCore {
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

type StubHandler = (
  body: Record<string, unknown>,
  url: string
) => { status: number; payload: unknown };

const openServers: Server[] = [];

async function startStubCore(handler: StubHandler): Promise<StubCore> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      });

      const { status, payload } = handler(body, req.url ?? '');
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  openServers.push(server);

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

// ============================================================================
// EXECUTION GRAPH BUILDERS (mirroring each Core's real wire shape)
// ============================================================================

const NOW = '2026-07-27T00:00:00.000Z';

/** security-core's shape: a nested `{ root, children }` tree. */
function nestedGraph(parentSpanId: string, repoName: string, agentName: string) {
  return {
    root: {
      span_id: 'core-span-1',
      parent_span_id: parentSpanId,
      type: 'core',
      name: 'security-core',
      status: 'ok',
      start_time: NOW,
      end_time: NOW,
      children: [
        {
          span_id: 'repo-span-1',
          parent_span_id: 'core-span-1',
          type: 'repo',
          name: repoName,
          status: 'ok',
          start_time: NOW,
          end_time: NOW,
          children: [
            {
              span_id: 'agent-span-1',
              parent_span_id: 'repo-span-1',
              type: 'agent',
              name: agentName,
              status: 'ok',
              start_time: NOW,
              end_time: NOW,
              children: [],
            },
          ],
        },
      ],
    },
    span_count: 3,
    depth: 3,
    is_valid: true,
    validation_errors: [],
  };
}

/** data-core / automation-core shape: a flat `{ root_span_id, spans }` list. */
function flatGraph(parentSpanId: string, coreName: string) {
  return {
    root_span_id: 'core-span-1',
    spans: [
      {
        span_id: 'core-span-1',
        parent_span_id: parentSpanId,
        type: 'core',
        name: coreName,
        status: 'completed',
        start_time: NOW,
        end_time: NOW,
      },
      {
        span_id: 'repo-span-1',
        parent_span_id: 'core-span-1',
        type: 'repo',
        name: `${coreName}-repo`,
        status: 'completed',
        start_time: NOW,
        end_time: NOW,
      },
      {
        span_id: 'agent-span-1',
        parent_span_id: 'repo-span-1',
        type: 'agent',
        name: `${coreName}-agent`,
        status: 'completed',
        start_time: NOW,
        end_time: NOW,
      },
    ],
    metadata: { core_name: coreName, created_at: NOW, version: '1.0.0' },
  };
}

const ARTIFACT_MANIFEST = {
  simulationId: 'sim-1',
  generatedAt: NOW,
  artifacts: [],
  totalSizeBytes: 0,
  checksums: {},
  manifestHash: 'hash-manifest',
};

// ============================================================================
// REQUEST FIXTURES
// ============================================================================

const PARENT_SPAN = createSpanId('engine-span-1');
const TRACE = createTraceId('trace-1');
const SIM = createSimulationId('sim-1');

const securityRequest: SecurityCoreRequest = {
  coreType: 'llm-security-core',
  simulationId: SIM,
  traceId: TRACE,
  parentSpanId: PARENT_SPAN,
  requestedAt: NOW as ISOTimestamp,
  timeoutMs: 5000,
  policyReferences: [{ policyId: 'policy-1' }],
  evaluationContext: { scenarioId: 'scenario-1' },
  phase: 'pre-execution',
};

const dataRequest: DataCoreRequest = {
  coreType: 'llm-data-core',
  simulationId: SIM,
  traceId: TRACE,
  parentSpanId: PARENT_SPAN,
  requestedAt: NOW as ISOTimestamp,
  timeoutMs: 5000,
  entityReferences: [{ entityType: 'dataset', entityId: 'entity-1' }],
  executionSummary: { stepCount: 1 },
};

const governanceRequest: GovernanceCoreRequest = {
  coreType: 'llm-governance-core',
  simulationId: SIM,
  traceId: TRACE,
  parentSpanId: PARENT_SPAN,
  requestedAt: NOW as ISOTimestamp,
  timeoutMs: 5000,
  policyResults: {
    policiesEvaluated: 1,
    decisionCounts: { allow: 1, deny: 0, warn: 0, require_approval: 0 },
    violations: [],
    complianceScore: 100,
    policyResults: [],
  },
  scenarioResults: { status: 'delegated' },
  complianceRequirements: [{ framework: 'SOC2', controls: ['CC6.1'] }],
};

const automationRequest: AutomationCoreRequest = {
  coreType: 'llm-automation-core',
  simulationId: SIM,
  traceId: TRACE,
  parentSpanId: PARENT_SPAN,
  requestedAt: NOW as ISOTimestamp,
  timeoutMs: 5000,
  simulationResult: { status: 'delegated' },
  simulationConfig: { simulationId: SIM },
  artifactConfig: {
    generateReport: true,
    generatePolicyLog: true,
    generateStateSnapshots: false,
    generateTrace: true,
    formats: ['json'],
  },
};

// ============================================================================
// SECURITY CORE CLIENT
// ============================================================================

describe('HttpSecurityCoreClient', () => {
  it('POSTs /gate with the engine span propagated as options.parentSpanId', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        execution_graph: nestedGraph(
          ((body['options'] as Record<string, unknown>)['parentSpanId'] as string),
          'llm-policy-engine',
          'policy-evaluator'
        ),
        gate: {
          requestId: 'sim-1:pre-execution',
          decision: 'allow',
          policyDecisions: [
            { policyId: 'policy-1', action: 'allow', reason: 'within policy' },
          ],
        },
        status: 'ok',
        core_span_id: 'core-span-1',
      },
    }));

    const client = new HttpSecurityCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(securityRequest);

    expect(core.requests).toHaveLength(1);
    const sent = core.requests[0]!;
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('/gate');
    expect((sent.body['options'] as Record<string, unknown>)['parentSpanId']).toBe(
      PARENT_SPAN
    );
    expect(sent.headers['x-correlation-id']).toBe(TRACE);

    expect(response.coreName).toBe('llm-security-core');
    expect(response.success).toBe(true);
    expect(response.decisions).toEqual([
      {
        policyId: 'policy-1',
        outcome: 'allow',
        reason: 'within policy',
        evaluationTimeMs: 0,
      },
    ]);
    expect(response.policyResult.complianceScore).toBe(100);
    expect(response.policyResult.policiesEvaluated).toBe(1);
  });

  it('produces a span hierarchy the engine validator accepts', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        execution_graph: nestedGraph(
          ((body['options'] as Record<string, unknown>)['parentSpanId'] as string),
          'llm-policy-engine',
          'policy-evaluator'
        ),
        gate: { decision: 'allow', policyDecisions: [] },
      },
    }));

    const client = new HttpSecurityCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(securityRequest);

    const validation = validateCoreSpanHierarchy(
      response.spanHierarchy,
      PARENT_SPAN,
      TRACE,
      'llm-security-core'
    );

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(response.spanHierarchy.allSpans).toHaveLength(3);
  });

  it('treats a 403 deny as a real decision, not a transport failure', async () => {
    const core = await startStubCore((body) => ({
      status: 403,
      payload: {
        execution_graph: nestedGraph(
          ((body['options'] as Record<string, unknown>)['parentSpanId'] as string),
          'llm-policy-engine',
          'policy-evaluator'
        ),
        gate: {
          decision: 'deny',
          policyDecisions: [
            { policyId: 'policy-1', action: 'deny', reason: 'prohibited' },
          ],
        },
      },
    }));

    const client = new HttpSecurityCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(securityRequest);

    expect(response.success).toBe(false);
    expect(response.policyResult.complianceScore).toBe(0);
    expect(response.decisions[0]!.outcome).toBe('deny');
  });

  it('reports health from GET /health', async () => {
    const core = await startStubCore(() => ({ status: 200, payload: {} }));
    const client = new HttpSecurityCoreClient({ baseUrl: core.baseUrl });

    const health = await client.checkHealth();

    expect(health.coreName).toBe('llm-security-core');
    expect(health.healthy).toBe(true);
  });
});

// ============================================================================
// DATA / GOVERNANCE / AUTOMATION CLIENTS
// ============================================================================

describe('HttpDataCoreClient', () => {
  it('POSTs /simulation/persist with the engine span in metadata', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        success: true,
        execution_graph: flatGraph(
          (body['metadata'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-data-core'
        ),
        costMetrics: {
          totalCost: 12.5,
          currency: 'USD',
          breakdown: [{ category: 'compute', amount: 12.5, description: 'vCPU' }],
        },
        executionMetrics: { externalCalls: 3 },
      },
    }));

    const client = new HttpDataCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(dataRequest);

    expect(core.requests[0]!.url).toBe('/simulation/persist');
    expect(core.requests[0]!.body['simulationId']).toBe(SIM);
    expect(response.costMetrics.totalCost).toBe(12.5);
    expect(response.costMetrics.breakdown).toHaveLength(1);
    expect(
      validateCoreSpanHierarchy(response.spanHierarchy, PARENT_SPAN, TRACE, 'llm-data-core')
        .valid
    ).toBe(true);
  });
});

describe('HttpGovernanceCoreClient', () => {
  it('POSTs /gate and carries the allow decision into governance metrics', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        allowed: true,
        passed: true,
        execution_graph: flatGraph(
          (body['context'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-governance-core'
        ),
      },
    }));

    const client = new HttpGovernanceCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(governanceRequest);

    expect(core.requests[0]!.url).toBe('/gate');
    expect(core.requests[0]!.body['principal']).toBe('agentics-orchestration-engine');
    expect(response.success).toBe(true);
    expect(response.governanceMetrics.complianceScore).toBe(100);
    expect(response.governanceMetrics.frameworkResults).toEqual([
      { framework: 'SOC2', score: 100, passed: 1, failed: 0 },
    ]);
  });

  it('zeroes the compliance score when governance denies', async () => {
    const core = await startStubCore((body) => ({
      status: 403,
      payload: {
        allowed: false,
        passed: false,
        reason: 'gate_denied',
        execution_graph: flatGraph(
          (body['context'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-governance-core'
        ),
      },
    }));

    const client = new HttpGovernanceCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(governanceRequest);

    expect(response.success).toBe(false);
    expect(response.validatedPolicyResult.complianceScore).toBe(0);
  });
});

describe('HttpAutomationCoreClient', () => {
  it('POSTs /execute with a validator-satisfying input object', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        success: true,
        output: { artifacts: ARTIFACT_MANIFEST },
        execution_graph: flatGraph(
          (body['options'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-automation-core'
        ),
      },
    }));

    const client = new HttpAutomationCoreClient({ baseUrl: core.baseUrl });
    const response = await client.call(automationRequest);

    const sent = core.requests[0]!;
    expect(sent.url).toBe('/execute');
    // automation-core rejects any request whose `input` is not an object.
    expect(typeof sent.body['input']).toBe('object');
    expect((sent.body['options'] as Record<string, unknown>)['parentSpanId']).toBe(
      PARENT_SPAN
    );
    expect(response.artifacts).toEqual(ARTIFACT_MANIFEST);
  });

  it('fails when the Core returns no artifact manifest', async () => {
    const core = await startStubCore((body) => ({
      status: 200,
      payload: {
        success: true,
        execution_graph: flatGraph(
          (body['options'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-automation-core'
        ),
      },
    }));

    const client = new HttpAutomationCoreClient({ baseUrl: core.baseUrl });

    await expect(client.call(automationRequest)).rejects.toMatchObject({
      code: 'CORE_INVALID_RESPONSE',
    });
  });
});

// ============================================================================
// FAIL-CLOSED BEHAVIOUR
// ============================================================================

describe('fail-closed transport behaviour', () => {
  it('rejects a Core response carrying no execution_graph', async () => {
    // This is governance-core's and data-core's response shape today: a real
    // decision body with no span tree at all.
    const core = await startStubCore(() => ({
      status: 200,
      payload: { allowed: true, passed: true, requestId: 'r1', clearance: {} },
    }));

    const client = new HttpGovernanceCoreClient({ baseUrl: core.baseUrl });

    await expect(client.call(governanceRequest)).rejects.toMatchObject({
      code: 'MISSING_SPAN_HIERARCHY',
      coreName: 'llm-governance-core',
    });
  });

  it('rejects a graph the Core did not parent under the engine span', async () => {
    const core = await startStubCore(() => ({
      status: 200,
      payload: {
        success: true,
        execution_graph: flatGraph('some-unrelated-span', 'llm-data-core'),
      },
    }));

    const client = new HttpDataCoreClient({ baseUrl: core.baseUrl });

    await expect(client.call(dataRequest)).rejects.toMatchObject({
      code: 'INVALID_REPO_PARENT',
    });
  });

  it('surfaces a Core 500 as CORE_HTTP_ERROR', async () => {
    const core = await startStubCore(() => ({
      status: 500,
      payload: { error: 'boom' },
    }));

    const client = new HttpDataCoreClient({ baseUrl: core.baseUrl });

    await expect(client.call(dataRequest)).rejects.toMatchObject({
      code: 'CORE_HTTP_ERROR',
    });
  });

  it('surfaces an unreachable Core as CORE_UNAVAILABLE', async () => {
    const core = await startStubCore(() => ({ status: 200, payload: {} }));
    const baseUrl = core.baseUrl;
    await core.close();

    const client = new HttpDataCoreClient({ baseUrl });

    await expect(client.call(dataRequest)).rejects.toMatchObject({
      code: 'CORE_UNAVAILABLE',
    });
  });

  it('aborts and reports CORE_TIMEOUT when a Core stops responding', async () => {
    const server = createServer(() => {
      // Accept the connection and never answer.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    openServers.push(server);
    const { port } = server.address() as AddressInfo;

    const client = new HttpDataCoreClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 100,
    });

    await expect(
      client.call({ ...dataRequest, timeoutMs: 100 })
    ).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });
  });

  it('reports an unhealthy Core rather than throwing', async () => {
    const core = await startStubCore(() => ({ status: 503, payload: {} }));
    const client = new HttpSecurityCoreClient({ baseUrl: core.baseUrl });

    const health = await client.checkHealth();

    expect(health.healthy).toBe(false);
    expect(health.errors?.[0]).toContain('503');
  });
});

// ============================================================================
// SPAN NORMALIZER PROPERTIES
// ============================================================================

describe('normalizeExecutionGraph', () => {
  const spanTree = fc.record({
    repos: fc.array(
      fc.record({ agents: fc.array(fc.constant(true), { minLength: 1, maxLength: 3 }) }),
      { minLength: 1, maxLength: 4 }
    ),
  });

  it('always yields a hierarchy the engine validator accepts, for any well-formed tree', () => {
    fc.assert(
      fc.property(spanTree, ({ repos }) => {
        const parent = createSpanId('engine-span');
        const trace = createTraceId('trace');

        const spans: Record<string, unknown>[] = [
          {
            span_id: 'core',
            parent_span_id: parent,
            type: 'core',
            name: 'core',
            status: 'ok',
            start_time: NOW,
            end_time: NOW,
          },
        ];

        repos.forEach((repo, repoIndex) => {
          spans.push({
            span_id: `repo-${repoIndex}`,
            parent_span_id: 'core',
            type: 'repo',
            name: `repo-${repoIndex}`,
            status: 'ok',
            start_time: NOW,
            end_time: NOW,
          });
          repo.agents.forEach((_, agentIndex) => {
            spans.push({
              span_id: `agent-${repoIndex}-${agentIndex}`,
              parent_span_id: `repo-${repoIndex}`,
              type: 'agent',
              name: `agent-${repoIndex}-${agentIndex}`,
              status: 'ok',
              start_time: NOW,
              end_time: NOW,
            });
          });
        });

        const hierarchy = normalizeExecutionGraph(
          { root_span_id: 'core', spans },
          parent,
          trace,
          'llm-data-core'
        );

        const validation = validateCoreSpanHierarchy(
          hierarchy,
          parent,
          trace,
          'llm-data-core'
        );

        return (
          validation.valid &&
          hierarchy.agentSpans.length === repos.length &&
          hierarchy.allSpans.length === spans.length
        );
      })
    );
  });

  it('normalizes the nested and flat wire shapes to the same hierarchy', () => {
    const parent = createSpanId('engine-span-1');
    const trace = createTraceId('trace-1');

    const fromNested = normalizeExecutionGraph(
      nestedGraph(parent, 'repo', 'agent'),
      parent,
      trace,
      'llm-security-core'
    );
    const fromFlat = normalizeExecutionGraph(
      {
        root_span_id: 'core-span-1',
        spans: [
          {
            span_id: 'core-span-1',
            parent_span_id: parent,
            type: 'core',
            name: 'security-core',
            status: 'ok',
            start_time: NOW,
            end_time: NOW,
          },
          {
            span_id: 'repo-span-1',
            parent_span_id: 'core-span-1',
            type: 'repo',
            name: 'repo',
            status: 'ok',
            start_time: NOW,
            end_time: NOW,
          },
          {
            span_id: 'agent-span-1',
            parent_span_id: 'repo-span-1',
            type: 'agent',
            name: 'agent',
            status: 'ok',
            start_time: NOW,
            end_time: NOW,
          },
        ],
      },
      parent,
      trace,
      'llm-security-core'
    );

    expect(fromNested.repoSpan.spanId).toBe(fromFlat.repoSpan.spanId);
    expect(fromNested.agentSpans.map((s) => s.spanId)).toEqual(
      fromFlat.agentSpans.map((s) => s.spanId)
    );
    expect(fromNested.allSpans).toHaveLength(fromFlat.allSpans.length);
  });

  it('throws MISSING_SPAN_HIERARCHY on an absent graph', () => {
    expect(() =>
      normalizeExecutionGraph(undefined, PARENT_SPAN, TRACE, 'llm-data-core')
    ).toThrow(CoreDelegationError);
  });
});

// ============================================================================
// ENGINE INTEGRATION — all four Cores receive a real request
// ============================================================================

describe('OrchestrationEngine with the real HTTP Core registry', () => {
  it('delegates to all four Cores over HTTP and collates their responses', async () => {
    const security = await startStubCore((body) => ({
      status: 200,
      payload: {
        execution_graph: nestedGraph(
          (body['options'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-policy-engine',
          'policy-evaluator'
        ),
        gate: {
          decision: 'allow',
          policyDecisions: [
            { policyId: 'policy-1', action: 'allow', reason: 'ok' },
          ],
        },
      },
    }));

    const data = await startStubCore((body) => ({
      status: 200,
      payload: {
        success: true,
        execution_graph: flatGraph(
          (body['metadata'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-data-core'
        ),
        costMetrics: { totalCost: 42, currency: 'USD', breakdown: [] },
        executionMetrics: { externalCalls: 7, custom: { source: 'data-core-stub' } },
      },
    }));

    const governance = await startStubCore((body) => ({
      status: 200,
      payload: {
        allowed: true,
        passed: true,
        execution_graph: flatGraph(
          (body['context'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-governance-core'
        ),
      },
    }));

    const automation = await startStubCore((body) => ({
      status: 200,
      payload: {
        success: true,
        output: { artifacts: ARTIFACT_MANIFEST },
        execution_graph: flatGraph(
          (body['options'] as Record<string, unknown>)['parentSpanId'] as string,
          'llm-automation-core'
        ),
      },
    }));

    const coreClients = createHttpCoreClientRegistry({
      endpoints: {
        security: security.baseUrl,
        data: data.baseUrl,
        governance: governance.baseUrl,
        automation: automation.baseUrl,
      },
    });

    const ruvectorStub = {
      requestExecutionAcceptance: async () => ({
        accepted: true,
        execution_id: 'exec-ruvector-1',
        root_span_id: createSpanId('ruvector-root'),
        trace_id: createTraceId('ruvector-trace'),
        simulation_resolution: 'aggregate',
      }),
    } as unknown as RuvectorClient;

    const engine = createOrchestrationEngine();
    engine.initialize(ruvectorStub, coreClients);

    const result = await engine.orchestrate({
      simulationId: SIM,
      simulationConfig: {
        simulationId: SIM,
        scenario: { scenarioId: 'scenario-1' },
        policies: [{ policyId: 'policy-1' }],
        resourceLimits: {},
        artifactConfig: {
          generateReport: true,
          generatePolicyLog: true,
          generateStateSnapshots: false,
          generateTrace: true,
          formats: ['json'],
          signArtifacts: false,
        },
        dataSources: [{ type: 'dataset', id: 'entity-1' }],
      } as never,
      scenario: {
        scenarioId: 'scenario-1',
        name: 'Scenario 1',
        category: 'custom',
        steps: [{ stepId: 'step-1' }],
        tags: [],
      } as never,
      engineId: 'test-engine',
    });

    // Every Core received exactly one real HTTP request.
    expect(security.requests).toHaveLength(1);
    expect(data.requests).toHaveLength(1);
    expect(governance.requests).toHaveLength(1);
    expect(automation.requests).toHaveLength(1);

    expect(security.requests[0]!.url).toBe('/gate');
    expect(data.requests[0]!.url).toBe('/simulation/persist');
    expect(governance.requests[0]!.url).toBe('/gate');
    expect(automation.requests[0]!.url).toBe('/execute');

    // The result reflects the stub Cores' responses, not local computation.
    expect(result.executionId).toBe('exec-ruvector-1');
    expect(result.result.artifacts).toEqual(ARTIFACT_MANIFEST);
    expect(result.result.metrics.custom!['source']).toBe('data-core-stub');
    expect(result.executionGraph).toHaveLength(4);
    expect(result.executionGraph.every((record) => record.success)).toBe(true);
    expect(result.executionGraph.map((record) => record.coreName)).toEqual([
      'llm-security-core',
      'llm-data-core',
      'llm-governance-core',
      'llm-automation-core',
    ]);
  });

  it('aborts orchestration when a Core returns no span hierarchy', async () => {
    const security = await startStubCore(() => ({
      status: 200,
      payload: { gate: { decision: 'allow', policyDecisions: [] } },
    }));
    const unused = await startStubCore(() => ({ status: 200, payload: {} }));

    const coreClients = createHttpCoreClientRegistry({
      endpoints: {
        security: security.baseUrl,
        data: unused.baseUrl,
        governance: unused.baseUrl,
        automation: unused.baseUrl,
      },
    });

    const ruvectorStub = {
      requestExecutionAcceptance: async () => ({
        accepted: true,
        execution_id: 'exec-ruvector-2',
        root_span_id: createSpanId('ruvector-root'),
        trace_id: createTraceId('ruvector-trace'),
      }),
    } as unknown as RuvectorClient;

    const engine = createOrchestrationEngine();
    engine.initialize(ruvectorStub, coreClients);

    await expect(
      engine.orchestrate({
        simulationId: SIM,
        simulationConfig: {
          simulationId: SIM,
          scenario: { scenarioId: 'scenario-1' },
          policies: [],
          artifactConfig: { formats: [] },
          dataSources: [],
        } as never,
        scenario: { scenarioId: 'scenario-1', steps: [], tags: [] } as never,
        engineId: 'test-engine',
      })
    ).rejects.toMatchObject({ code: 'MISSING_SPAN_HIERARCHY' });

    // Nothing was delegated past the failing Core.
    expect(unused.requests).toHaveLength(0);
  });
});

// Keep unused imports honest.
export type { SpanId, TraceId };
