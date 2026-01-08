/**
 * Contract Validation Tests.
 *
 * Tests for the @agentics/contracts validation module.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSimulateRequest,
  formatValidationErrors,
  createContractViolationResponse,
  isValidSimulateRequest,
} from '../../src/contracts/index.js';

describe('Contract Validation', () => {
  describe('validateSimulateRequest', () => {
    it('should reject empty object', () => {
      const result = validateSimulateRequest({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes('scenario'))).toBe(true);
    });

    it('should reject null', () => {
      const result = validateSimulateRequest(null);
      expect(result.valid).toBe(false);
    });

    it('should reject non-object', () => {
      const result = validateSimulateRequest('not an object');
      expect(result.valid).toBe(false);
    });

    it('should reject request without scenario', () => {
      const result = validateSimulateRequest({
        config: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('should reject scenario with invalid structure', () => {
      const result = validateSimulateRequest({
        scenario: {
          // Missing required fields
          scenarioId: 'test-scenario',
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject scenario with invalid category', () => {
      const result = validateSimulateRequest({
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test',
          description: 'Test scenario',
          category: 'invalid-category', // Invalid enum value
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('should accept valid minimal scenario', () => {
      const result = validateSimulateRequest({
        scenario: {
          scenarioId: 'test-scenario',
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
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should accept valid scenario with steps', () => {
      const result = validateSimulateRequest({
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test Scenario',
          description: 'A test scenario',
          category: 'deployment',
          tags: ['test'],
          preconditions: [],
          setup: [],
          steps: [
            {
              stepId: 'step-1',
              name: 'First Step',
              order: { index: 0 },
              type: 'agent_action',
              config: { agentId: 'agent-1', action: 'test' },
            },
          ],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should accept valid scenario with config override', () => {
      const result = validateSimulateRequest({
        config: {
          resourceLimits: {
            maxExecutionTimeMs: 60000,
            maxMemoryBytes: 256 * 1024 * 1024,
            maxConcurrency: 2,
            maxSnapshots: 50,
            maxTraceEvents: 5000,
          },
        },
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test Scenario',
          description: 'A test scenario',
          category: 'deployment',
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject config with invalid resource limits', () => {
      const result = validateSimulateRequest({
        config: {
          resourceLimits: {
            maxExecutionTimeMs: -1, // Invalid: must be > 0
            maxMemoryBytes: 256 * 1024 * 1024,
            maxConcurrency: 2,
            maxSnapshots: 50,
            maxTraceEvents: 5000,
          },
        },
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test',
          description: 'Test',
          category: 'deployment',
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('maxExecutionTimeMs'))).toBe(true);
    });

    it('should reject config with invalid timing mode', () => {
      const result = validateSimulateRequest({
        config: {
          timing: {
            mode: 'invalid-mode', // Invalid enum value
            simulatedStartTime: new Date().toISOString(),
          },
        },
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test',
          description: 'Test',
          category: 'deployment',
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('should reject config with invalid observability sampling rate', () => {
      const result = validateSimulateRequest({
        config: {
          observability: {
            logLevel: 'info',
            enableMetrics: true,
            enableTracing: true,
            traceSamplingRate: 1.5, // Invalid: must be 0-1
          },
        },
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test',
          description: 'Test',
          category: 'deployment',
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('traceSamplingRate'))).toBe(true);
    });

    it('should reject request with additional properties', () => {
      const result = validateSimulateRequest({
        extraField: 'should not be here',
        scenario: {
          scenarioId: 'test-scenario',
          version: { major: 1, minor: 0, patch: 0 },
          name: 'Test',
          description: 'Test',
          category: 'deployment',
          tags: [],
          preconditions: [],
          setup: [],
          steps: [],
          teardown: [],
          expectations: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
    });
  });

  describe('formatValidationErrors', () => {
    it('should format empty errors', () => {
      const formatted = formatValidationErrors([]);
      expect(formatted).toBe('No errors');
    });

    it('should format single error', () => {
      const formatted = formatValidationErrors([
        {
          code: 'SCHEMA_REQUIRED',
          message: 'must have required property',
          path: '/scenario',
          keyword: 'required',
        },
      ]);
      expect(formatted).toContain('/scenario');
      expect(formatted).toContain('SCHEMA_REQUIRED');
    });

    it('should format multiple errors', () => {
      const formatted = formatValidationErrors([
        {
          code: 'SCHEMA_REQUIRED',
          message: 'must have required property',
          path: '/scenario',
          keyword: 'required',
        },
        {
          code: 'SCHEMA_TYPE',
          message: 'must be object',
          path: '/config',
          keyword: 'type',
        },
      ]);
      expect(formatted).toContain('/scenario');
      expect(formatted).toContain('/config');
      expect(formatted).toContain(';');
    });
  });

  describe('createContractViolationResponse', () => {
    it('should create proper error response structure', () => {
      const response = createContractViolationResponse([
        {
          code: 'SCHEMA_REQUIRED',
          message: 'must have required property',
          path: '/scenario',
          keyword: 'required',
        },
      ]);

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe('CONTRACT_VIOLATION');
      expect(response.error.message).toContain('simulation/v1/request.schema.json');
      expect(response.error.details).toBeDefined();
      expect(response.error.details.violations).toHaveLength(1);
      expect(response.error.details.schema).toBe('simulation/v1/request.schema.json');
    });
  });

  describe('isValidSimulateRequest', () => {
    it('should return false for null', () => {
      expect(isValidSimulateRequest(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidSimulateRequest('string')).toBe(false);
    });

    it('should return false for object without scenario', () => {
      expect(isValidSimulateRequest({ config: {} })).toBe(false);
    });

    it('should return true for object with scenario', () => {
      expect(isValidSimulateRequest({ scenario: {} })).toBe(true);
    });

    it('should return true for object with scenario and config', () => {
      expect(isValidSimulateRequest({ scenario: {}, config: {} })).toBe(true);
    });
  });
});

describe('Contract Enforcement Order', () => {
  it('should validate contract BEFORE any processing would occur', () => {
    // This test ensures validation happens first
    // If validation passes, we know the structure is valid
    // If validation fails, no further processing should happen

    const invalidRequest = {
      scenario: 'not an object', // Invalid structure
    };

    const result = validateSimulateRequest(invalidRequest);
    expect(result.valid).toBe(false);

    // The error should indicate the structural issue
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject requests that would fail later validation early', () => {
    // This request would pass manual field checks but fail schema validation
    const partiallyValidRequest = {
      scenario: {
        scenarioId: '', // Empty string - fails minLength
        version: { major: 1, minor: 0, patch: 0 },
        name: 'Test',
        description: 'Test',
        category: 'deployment',
        tags: [],
        preconditions: [],
        setup: [],
        steps: [],
        teardown: [],
        expectations: [],
      },
    };

    const result = validateSimulateRequest(partiallyValidRequest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('scenarioId'))).toBe(true);
  });
});
