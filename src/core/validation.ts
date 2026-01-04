/**
 * Configuration Validation.
 *
 * Validates simulation configuration for correctness
 * before execution begins.
 *
 * @module core/validation
 */

import type { SimulationConfig } from '../types/simulation.js';
import type { ResourceLimits, TimingConfig } from '../types/common.js';

// ============================================================================
// VALIDATION RESULT
// ============================================================================

/**
 * Result of configuration validation.
 */
export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path: string;
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path: string;
  }>;
}

// ============================================================================
// CONFIGURATION VALIDATOR
// ============================================================================

/**
 * Validates simulation configurations.
 */
export class ConfigurationValidator {
  /**
   * Validates a complete simulation configuration.
   */
  validate(config: SimulationConfig): ConfigValidationResult {
    const errors: Array<{
      code: string;
      message: string;
      path: string;
    }> = [];
    const warnings: Array<{
      code: string;
      message: string;
      path: string;
    }> = [];

    // Validate simulation ID
    if (!config.simulationId) {
      errors.push({
        code: 'MISSING_SIMULATION_ID',
        message: 'Simulation ID is required',
        path: 'simulationId',
      });
    }

    // Validate scenario reference
    if (!config.scenario) {
      errors.push({
        code: 'MISSING_SCENARIO',
        message: 'Scenario reference is required',
        path: 'scenario',
      });
    } else if (!config.scenario.scenarioId) {
      errors.push({
        code: 'MISSING_SCENARIO_ID',
        message: 'Scenario ID is required',
        path: 'scenario.scenarioId',
      });
    }

    // Validate resource limits
    const resourceErrors = this.validateResourceLimits(config.resourceLimits);
    errors.push(...resourceErrors.errors);
    warnings.push(...resourceErrors.warnings);

    // Validate timing configuration
    const timingErrors = this.validateTimingConfig(config.timing);
    errors.push(...timingErrors.errors);
    warnings.push(...timingErrors.warnings);

    // Validate policies
    if (!config.policies) {
      warnings.push({
        code: 'NO_POLICIES',
        message: 'No policies configured',
        path: 'policies',
      });
    }

    // Validate data sources
    if (!config.dataSources || config.dataSources.length === 0) {
      warnings.push({
        code: 'NO_DATA_SOURCES',
        message: 'No data sources configured',
        path: 'dataSources',
      });
    }

    // Validate observability
    if (config.observability) {
      if (config.observability.traceSamplingRate < 0 || config.observability.traceSamplingRate > 1) {
        errors.push({
          code: 'INVALID_SAMPLING_RATE',
          message: 'Trace sampling rate must be between 0 and 1',
          path: 'observability.traceSamplingRate',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates resource limits.
   */
  validateResourceLimits(limits: ResourceLimits): {
    errors: Array<{ code: string; message: string; path: string }>;
    warnings: Array<{ code: string; message: string; path: string }>;
  } {
    const errors: Array<{ code: string; message: string; path: string }> = [];
    const warnings: Array<{ code: string; message: string; path: string }> = [];

    if (!limits) {
      errors.push({
        code: 'MISSING_RESOURCE_LIMITS',
        message: 'Resource limits are required',
        path: 'resourceLimits',
      });
      return { errors, warnings };
    }

    // Validate execution time
    if (limits.maxExecutionTimeMs <= 0) {
      errors.push({
        code: 'INVALID_EXECUTION_TIME',
        message: 'Max execution time must be positive',
        path: 'resourceLimits.maxExecutionTimeMs',
      });
    } else if (limits.maxExecutionTimeMs < 1000) {
      warnings.push({
        code: 'SHORT_EXECUTION_TIME',
        message: 'Max execution time is very short (< 1 second)',
        path: 'resourceLimits.maxExecutionTimeMs',
      });
    }

    // Validate memory
    if (limits.maxMemoryBytes <= 0) {
      errors.push({
        code: 'INVALID_MEMORY_LIMIT',
        message: 'Max memory must be positive',
        path: 'resourceLimits.maxMemoryBytes',
      });
    } else if (limits.maxMemoryBytes < 10 * 1024 * 1024) {
      warnings.push({
        code: 'LOW_MEMORY_LIMIT',
        message: 'Max memory is very low (< 10MB)',
        path: 'resourceLimits.maxMemoryBytes',
      });
    }

    // Validate concurrency
    if (limits.maxConcurrency <= 0) {
      errors.push({
        code: 'INVALID_CONCURRENCY',
        message: 'Max concurrency must be positive',
        path: 'resourceLimits.maxConcurrency',
      });
    }

    // Validate snapshots
    if (limits.maxSnapshots < 0) {
      errors.push({
        code: 'INVALID_SNAPSHOTS',
        message: 'Max snapshots cannot be negative',
        path: 'resourceLimits.maxSnapshots',
      });
    }

    // Validate trace events
    if (limits.maxTraceEvents < 0) {
      errors.push({
        code: 'INVALID_TRACE_EVENTS',
        message: 'Max trace events cannot be negative',
        path: 'resourceLimits.maxTraceEvents',
      });
    }

    return { errors, warnings };
  }

  /**
   * Validates timing configuration.
   */
  validateTimingConfig(timing: TimingConfig): {
    errors: Array<{ code: string; message: string; path: string }>;
    warnings: Array<{ code: string; message: string; path: string }>;
  } {
    const errors: Array<{ code: string; message: string; path: string }> = [];
    const warnings: Array<{ code: string; message: string; path: string }> = [];

    if (!timing) {
      errors.push({
        code: 'MISSING_TIMING_CONFIG',
        message: 'Timing configuration is required',
        path: 'timing',
      });
      return { errors, warnings };
    }

    // Validate simulated start time
    if (!timing.simulatedStartTime) {
      errors.push({
        code: 'MISSING_START_TIME',
        message: 'Simulated start time is required',
        path: 'timing.simulatedStartTime',
      });
    } else {
      const startTime = new Date(timing.simulatedStartTime);
      if (isNaN(startTime.getTime())) {
        errors.push({
          code: 'INVALID_START_TIME',
          message: 'Simulated start time is not a valid ISO timestamp',
          path: 'timing.simulatedStartTime',
        });
      }
    }

    // Validate time mode
    if (!['controlled', 'accelerated', 'real'].includes(timing.mode)) {
      errors.push({
        code: 'INVALID_TIME_MODE',
        message: `Invalid time mode: ${timing.mode}`,
        path: 'timing.mode',
      });
    }

    // Validate acceleration factor
    if (timing.mode === 'accelerated') {
      if (timing.accelerationFactor === undefined || timing.accelerationFactor <= 0) {
        errors.push({
          code: 'INVALID_ACCELERATION',
          message: 'Acceleration factor must be positive for accelerated mode',
          path: 'timing.accelerationFactor',
        });
      } else if (timing.accelerationFactor > 1000) {
        warnings.push({
          code: 'HIGH_ACCELERATION',
          message: 'Acceleration factor is very high (> 1000x)',
          path: 'timing.accelerationFactor',
        });
      }
    }

    return { errors, warnings };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a configuration validator.
 */
export function createConfigurationValidator(): ConfigurationValidator {
  return new ConfigurationValidator();
}

/**
 * Validates a simulation configuration.
 */
export function validateConfig(config: SimulationConfig): ConfigValidationResult {
  const validator = new ConfigurationValidator();
  return validator.validate(config);
}
