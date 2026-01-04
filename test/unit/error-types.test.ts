/**
 * Unit tests for error types.
 */

import { describe, it, expect } from 'vitest';
import {
  SimulationError,
  TransientError,
  PolicyViolationError,
  ResourceExhaustionError,
  IsolationBreachError,
  ConfigurationError,
  FatalError,
  ErrorCodes,
  classifyError,
} from '../../src/error/types.js';
import type { PolicyId } from '../../src/types/common.js';

describe('Error Types', () => {
  const testContext = {
    component: 'test-component',
    operation: 'test-operation',
  };

  describe('SimulationError', () => {
    it('creates error with all properties', () => {
      const error = new SimulationError(
        'Test error message',
        ErrorCodes.INTERNAL_ERROR,
        'FATAL',
        'high',
        testContext
      );

      expect(error.message).toBe('Test error message');
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.classification).toBe('FATAL');
      expect(error.severity).toBe('high');
      expect(error.context).toEqual(testContext);
      expect(error.name).toBe('SimulationError');
    });

    it('preserves cause chain', () => {
      const cause = new Error('Original error');
      const error = new SimulationError(
        'Wrapped error',
        ErrorCodes.INTERNAL_ERROR,
        'FATAL',
        'high',
        testContext,
        { cause }
      );

      expect(error.cause).toBe(cause);
    });

    it('serializes to JSON', () => {
      const error = new SimulationError(
        'Test error',
        ErrorCodes.INTERNAL_ERROR,
        'FATAL',
        'high',
        testContext
      );

      const json = error.toJSON();
      expect(json).toHaveProperty('name', 'SimulationError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('code', ErrorCodes.INTERNAL_ERROR);
    });
  });

  describe('TransientError', () => {
    it('includes retry information', () => {
      const error = new TransientError(
        'Network timeout',
        ErrorCodes.NETWORK_TIMEOUT,
        testContext,
        { retryCount: 2, suggestedDelayMs: 2000 }
      );

      expect(error.name).toBe('TransientError');
      expect(error.classification).toBe('TRANSIENT');
      expect(error.retryable).toBe(true);
      expect(error.retryCount).toBe(2);
      expect(error.suggestedDelayMs).toBe(2000);
    });
  });

  describe('PolicyViolationError', () => {
    it('includes policy violation details', () => {
      const error = new PolicyViolationError(
        'Policy violation detected',
        'policy-123' as PolicyId,
        'rule-456',
        'access_denied',
        testContext
      );

      expect(error.name).toBe('PolicyViolationError');
      expect(error.code).toBe(ErrorCodes.POLICY_DENIED);
      expect(error.classification).toBe('POLICY_VIOLATION');
      expect(error.policyId).toBe('policy-123');
      expect(error.ruleId).toBe('rule-456');
      expect(error.violationType).toBe('access_denied');
    });
  });

  describe('ResourceExhaustionError', () => {
    it('includes resource details', () => {
      const error = new ResourceExhaustionError(
        'Memory limit exceeded',
        ErrorCodes.MEMORY_LIMIT_EXCEEDED,
        'memory',
        2147483648,
        1073741824,
        testContext
      );

      expect(error.name).toBe('ResourceExhaustionError');
      expect(error.classification).toBe('RESOURCE_EXHAUSTION');
      expect(error.resourceType).toBe('memory');
      expect(error.currentUsage).toBe(2147483648);
      expect(error.limit).toBe(1073741824);
    });
  });

  describe('IsolationBreachError', () => {
    it('includes breach details', () => {
      const error = new IsolationBreachError(
        'https://prod.api.example.com',
        'network',
        testContext
      );

      expect(error.name).toBe('IsolationBreachError');
      expect(error.code).toBe(ErrorCodes.ISOLATION_BREACH);
      expect(error.classification).toBe('FATAL');
      expect(error.target).toBe('https://prod.api.example.com');
      expect(error.accessType).toBe('network');
    });
  });

  describe('ConfigurationError', () => {
    it('includes config path', () => {
      const error = new ConfigurationError(
        'Invalid value',
        testContext,
        { configPath: 'simulation.timeout' }
      );

      expect(error.name).toBe('ConfigurationError');
      expect(error.code).toBe(ErrorCodes.CONFIGURATION_INVALID);
      expect(error.classification).toBe('FATAL');
      expect(error.configPath).toBe('simulation.timeout');
    });
  });

  describe('FatalError', () => {
    it('creates fatal error', () => {
      const error = new FatalError(
        'Fatal error occurred',
        ErrorCodes.FATAL_ERROR,
        testContext
      );

      expect(error.name).toBe('FatalError');
      expect(error.classification).toBe('FATAL');
      expect(error.retryable).toBe(false);
    });
  });

  describe('classifyError', () => {
    it('classifies SimulationError by its classification', () => {
      const error = new ResourceExhaustionError(
        'Timeout',
        ErrorCodes.EXECUTION_TIMEOUT,
        'time',
        0,
        0,
        testContext
      );
      const classification = classifyError(error);

      expect(classification).toBe('RESOURCE_EXHAUSTION');
    });

    it('classifies PolicyViolationError', () => {
      const error = new PolicyViolationError(
        'Violation',
        'p1' as PolicyId,
        'r1',
        'type',
        testContext
      );
      const classification = classifyError(error);

      expect(classification).toBe('POLICY_VIOLATION');
    });

    it('classifies IsolationBreachError as FATAL', () => {
      const error = new IsolationBreachError('target', 'network', testContext);
      const classification = classifyError(error);

      expect(classification).toBe('FATAL');
    });

    it('classifies network errors as TRANSIENT', () => {
      const error = new Error('ECONNREFUSED');
      const classification = classifyError(error);

      expect(classification).toBe('TRANSIENT');
    });

    it('classifies timeout errors as TRANSIENT', () => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      const classification = classifyError(error);

      expect(classification).toBe('TRANSIENT');
    });

    it('classifies unknown errors as FATAL', () => {
      const error = new Error('Unknown error');
      const classification = classifyError(error);

      expect(classification).toBe('FATAL');
    });
  });
});
