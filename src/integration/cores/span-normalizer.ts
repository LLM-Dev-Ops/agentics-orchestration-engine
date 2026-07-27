/**
 * Core Execution Graph Normalizer.
 *
 * The Layer-3 Cores emit their span trees as an `execution_graph` in snake_case,
 * in two different shapes: a nested tree (`{ root }`, security-core) and a flat
 * list (`{ root_span_id, spans }`, data-core / automation-core). The engine
 * consumes the camelCase `CoreSpanHierarchy` contract. This module translates
 * one into the other without inventing spans.
 *
 * Level mapping: a Core's graph is Core -> Repo -> Agent, one level deeper than
 * CoreSpanHierarchy's parent -> repo -> agent. The Core's root span is the span
 * parented under the engine, so it fills `repoSpan`; the Core's own repo-level
 * children fill `agentSpans`. Every span of the tree, agent level included, is
 * preserved verbatim in `allSpans`.
 *
 * @module integration/cores/span-normalizer
 */

import type { ISOTimestamp, SpanId, TraceId } from '../../types/common.js';
import { createSpanId } from '../../types/common.js';
import type { SpanStatus, TraceSpanData } from '../../trace/span.js';
import type { CoreName, CoreSpanHierarchy } from '../../types/core-delegation.js';
import { CoreDelegationError } from './errors.js';

// ============================================================================
// RAW WIRE TYPES
// ============================================================================

/** A span as emitted by a Layer-3 Core. */
export interface RawCoreSpan {
  readonly span_id?: unknown;
  readonly parent_span_id?: unknown;
  readonly type?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
  readonly start_time?: unknown;
  readonly end_time?: unknown;
  readonly attributes?: unknown;
  readonly children?: unknown;
}

/** An `execution_graph` as emitted by a Layer-3 Core, in either shape. */
export interface RawExecutionGraph {
  readonly root?: unknown;
  readonly root_span_id?: unknown;
  readonly spans?: unknown;
}

// ============================================================================
// HELPERS
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Maps the Cores' status vocabularies onto the engine's SpanStatus. */
function mapStatus(raw: unknown): SpanStatus {
  switch (asString(raw)) {
    case 'failed':
      return 'failed';
    case 'running':
      return 'active';
    case 'cancelled':
      return 'cancelled';
    default:
      // 'ok' (security-core), 'completed' (data-core), 'partial', absent
      return 'completed';
  }
}

function durationOf(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return endMs - startMs;
}

/** Depth-first flatten of a nested `{ children }` tree into a span list. */
function flattenTree(node: unknown, out: Record<string, unknown>[]): void {
  if (!isRecord(node)) return;
  out.push(node);
  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      flattenTree(child, out);
    }
  }
}

function toTraceSpanData(
  raw: Record<string, unknown>,
  traceId: TraceId,
  serviceName: string
): TraceSpanData {
  const startTime = asString(raw['start_time']) ?? new Date(0).toISOString();
  const endTime = asString(raw['end_time']);
  const spanType = asString(raw['type']);

  return {
    spanId: createSpanId(asString(raw['span_id']) as string),
    traceId,
    parentSpanId: asString(raw['parent_span_id'])
      ? createSpanId(asString(raw['parent_span_id']) as string)
      : null,
    operationName: asString(raw['name']) ?? 'unnamed',
    serviceName,
    startTime: startTime as ISOTimestamp,
    endTime: (endTime ?? null) as ISOTimestamp | null,
    status: mapStatus(raw['status']),
    durationMs: durationOf(startTime, endTime),
    attributes: {
      ...(isRecord(raw['attributes']) ? raw['attributes'] : {}),
      ...(spanType !== undefined && { 'core.span.type': spanType }),
    },
    events: [],
    links: [],
  };
}

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Translates a Core's `execution_graph` into the engine's CoreSpanHierarchy.
 *
 * @param graph - The raw `execution_graph` from the Core response
 * @param expectedParentSpanId - Span ID the engine propagated to the Core
 * @param traceId - Trace ID the engine propagated
 * @param coreName - Core that produced the graph (for error messages)
 * @throws CoreDelegationError if the Core returned no usable span tree
 */
export function normalizeExecutionGraph(
  graph: RawExecutionGraph | undefined | null,
  expectedParentSpanId: SpanId,
  traceId: TraceId,
  coreName: CoreName
): CoreSpanHierarchy {
  if (!isRecord(graph)) {
    throw new CoreDelegationError(
      `Core ${coreName} returned no execution_graph`,
      'MISSING_SPAN_HIERARCHY',
      coreName,
      'The response body contained no execution_graph object. Every Core ' +
        'response must carry a nested core -> repo -> agent span tree.'
    );
  }

  const flat: Record<string, unknown>[] = [];
  let rootId: string | undefined;

  const root = graph['root'];
  const spans = graph['spans'];

  if (isRecord(root)) {
    flattenTree(root, flat);
    rootId = asString(root['span_id']);
  } else if (Array.isArray(spans)) {
    for (const span of spans) {
      if (isRecord(span)) flat.push(span);
    }
    rootId = asString(graph['root_span_id']);
  }

  const usable = flat.filter((s) => asString(s['span_id']) !== undefined);

  if (usable.length === 0 || rootId === undefined) {
    throw new CoreDelegationError(
      `Core ${coreName} returned an empty execution_graph`,
      'MISSING_SPAN_HIERARCHY',
      coreName,
      `execution_graph carried ${usable.length} identifiable span(s) and ` +
        `root span id ${rootId ?? '<none>'}.`
    );
  }

  const rawRoot = usable.find((s) => asString(s['span_id']) === rootId);
  if (!rawRoot) {
    throw new CoreDelegationError(
      `Core ${coreName} execution_graph has no span matching its root span id`,
      'MISSING_REPO_SPAN',
      coreName,
      `root span id ${rootId} is not present among the ${usable.length} returned spans.`
    );
  }

  const serviceName = coreName;
  const repoSpan = toTraceSpanData(rawRoot, traceId, serviceName);
  const agentSpans = usable
    .filter((s) => asString(s['parent_span_id']) === rootId)
    .map((s) => toTraceSpanData(s, traceId, serviceName));
  const allSpans = usable.map((s) => toTraceSpanData(s, traceId, serviceName));

  if (repoSpan.parentSpanId !== expectedParentSpanId) {
    throw new CoreDelegationError(
      `Core ${coreName} did not parent its execution graph under the engine span`,
      'INVALID_REPO_PARENT',
      coreName,
      `root span parent_span_id was ${repoSpan.parentSpanId ?? 'null'}, ` +
        `expected ${expectedParentSpanId}. The Core must echo the propagated parent span.`
    );
  }

  return {
    parentSpanId: expectedParentSpanId,
    traceId,
    repoSpan,
    agentSpans,
    allSpans,
  };
}
