/**
 * Core Span Hierarchy Validator.
 *
 * Validates that external Core responses contain proper nested span
 * hierarchies. Flat results (missing repo spans, missing agent spans,
 * or incorrectly parented spans) are rejected.
 *
 * @module integration/cores/span-validator
 */

import type { SpanId, TraceId } from '../../types/common.js';
import type {
  CoreSpanHierarchy,
  SpanValidationResult,
  CoreName,
} from '../../types/core-delegation.js';

// ============================================================================
// SPAN HIERARCHY VALIDATION
// ============================================================================

/**
 * Validates that a Core response contains a proper nested span hierarchy.
 *
 * Requirements:
 * 1. spanHierarchy must be present (not null/undefined)
 * 2. repoSpan must exist with parentSpanId === the engine-assigned parentSpanId
 * 3. At least one agentSpan must exist
 * 4. Each agentSpan.parentSpanId must equal repoSpan.spanId
 * 5. traceId must match the engine's traceId throughout
 * 6. allSpans must contain repoSpan + all agentSpans
 *
 * @param hierarchy - The span hierarchy from the Core response
 * @param expectedParentSpanId - The span ID the engine assigned as parent
 * @param expectedTraceId - The trace ID the engine propagated
 * @param coreName - Name of the Core (for error messages)
 * @returns Validation result with errors if invalid
 */
export function validateCoreSpanHierarchy(
  hierarchy: CoreSpanHierarchy | undefined | null,
  expectedParentSpanId: SpanId,
  expectedTraceId: TraceId,
  coreName: CoreName
): SpanValidationResult {
  const errors: Array<{ code: string; message: string }> = [];

  // 1. Hierarchy must exist
  if (!hierarchy) {
    return {
      valid: false,
      errors: [
        {
          code: 'MISSING_SPAN_HIERARCHY',
          message:
            `Core ${coreName} returned no span hierarchy. ` +
            'All Core responses MUST include nested span data.',
        },
      ],
    };
  }

  // 2. Repo span must exist and reference engine's parent span
  if (!hierarchy.repoSpan) {
    errors.push({
      code: 'MISSING_REPO_SPAN',
      message: `Core ${coreName} returned no repo span.`,
    });
  } else {
    if (hierarchy.repoSpan.parentSpanId !== expectedParentSpanId) {
      errors.push({
        code: 'INVALID_REPO_PARENT',
        message:
          `Core ${coreName} repo span parentSpanId ` +
          `(${hierarchy.repoSpan.parentSpanId}) does not match ` +
          `engine-assigned parent (${expectedParentSpanId}).`,
      });
    }
    if (hierarchy.repoSpan.traceId !== expectedTraceId) {
      errors.push({
        code: 'TRACE_ID_MISMATCH',
        message:
          `Core ${coreName} repo span traceId ` +
          `(${hierarchy.repoSpan.traceId}) does not match ` +
          `engine traceId (${expectedTraceId}).`,
      });
    }
  }

  // 3. At least one agent span required
  if (!hierarchy.agentSpans || hierarchy.agentSpans.length === 0) {
    errors.push({
      code: 'NO_AGENT_SPANS',
      message:
        `Core ${coreName} returned zero agent spans. ` +
        'At least one agent span is required nested under the repo span.',
    });
  }

  // 4. Agent spans must be children of repo span
  if (hierarchy.repoSpan && hierarchy.agentSpans) {
    for (const agentSpan of hierarchy.agentSpans) {
      if (agentSpan.parentSpanId !== hierarchy.repoSpan.spanId) {
        errors.push({
          code: 'AGENT_SPAN_NOT_NESTED',
          message:
            `Core ${coreName} agent span ${agentSpan.spanId} ` +
            `parentSpanId (${agentSpan.parentSpanId}) does not match ` +
            `repo span (${hierarchy.repoSpan.spanId}). ` +
            'Agent spans MUST be nested under the repo span.',
        });
      }
    }
  }

  // 5. Validate traceId on agent spans
  if (hierarchy.agentSpans) {
    for (const agentSpan of hierarchy.agentSpans) {
      if (agentSpan.traceId !== expectedTraceId) {
        errors.push({
          code: 'TRACE_ID_MISMATCH',
          message:
            `Core ${coreName} agent span ${agentSpan.spanId} traceId ` +
            `(${agentSpan.traceId}) does not match ` +
            `engine traceId (${expectedTraceId}).`,
        });
      }
    }
  }

  // 6. allSpans completeness check
  if (hierarchy.allSpans) {
    const allSpanIds = new Set(hierarchy.allSpans.map((s) => s.spanId));

    if (hierarchy.repoSpan && !allSpanIds.has(hierarchy.repoSpan.spanId)) {
      errors.push({
        code: 'INCOMPLETE_ALL_SPANS',
        message: `Core ${coreName} allSpans does not contain the repo span.`,
      });
    }

    for (const agentSpan of hierarchy.agentSpans ?? []) {
      if (!allSpanIds.has(agentSpan.spanId)) {
        errors.push({
          code: 'INCOMPLETE_ALL_SPANS',
          message:
            `Core ${coreName} allSpans missing agent span ${agentSpan.spanId}.`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
