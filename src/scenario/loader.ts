/**
 * Scenario Loader.
 *
 * Loads, validates, and prepares scenarios for execution.
 *
 * @module scenario/loader
 */

import type { ScenarioId, ContentHash } from '../types/common.js';
import type {
  Scenario,
  PreparedScenario,
  ScenarioParameters,
  ScenarioValidationResult,
  ParameterDefinition,
  ScenarioStep,
} from '../types/scenario.js';
import { createContentHashFromObject } from '../utils/hash.js';

// ============================================================================
// SCENARIO SOURCE TYPES
// ============================================================================

/**
 * Source for loading a scenario.
 */
export type ScenarioSource =
  | { type: 'inline'; scenario: Scenario }
  | { type: 'file'; path: string }
  | { type: 'registry'; scenarioId: ScenarioId; version?: string };

/**
 * Options for scenario loading.
 */
export interface ScenarioLoadOptions {
  /** Whether to validate scenarios during load */
  readonly validate?: boolean;
  /** Parameters to merge with defaults */
  readonly parameters?: ScenarioParameters;
}

// ============================================================================
// SCENARIO LOADER CLASS
// ============================================================================

/**
 * Loads and manages scenarios from various sources.
 */
export class ScenarioLoader {
  private readonly loadedScenarios: Map<ScenarioId, Scenario> = new Map();
  private readonly preparedScenarios: Map<string, PreparedScenario> = new Map();

  // ==========================================================================
  // SCENARIO LOADING
  // ==========================================================================

  /**
   * Loads a scenario from a source.
   *
   * @param source - Scenario source
   * @param options - Load options
   * @returns Loaded scenario
   */
  async load(
    source: ScenarioSource,
    options: ScenarioLoadOptions = {}
  ): Promise<Scenario> {
    let scenario: Scenario;

    switch (source.type) {
      case 'inline':
        scenario = source.scenario;
        break;
      case 'file':
        scenario = await this.loadFromFile(source.path);
        break;
      case 'registry':
        scenario = await this.loadFromRegistry(source.scenarioId, source.version);
        break;
    }

    // Validate if requested
    if (options.validate !== false) {
      const validation = this.validate(scenario);
      if (!validation.valid) {
        throw new Error(
          `Scenario validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
        );
      }
    }

    // Compute content hash if not present
    if (!scenario.contentHash) {
      scenario = {
        ...scenario,
        contentHash: this.computeScenarioHash(scenario),
      };
    }

    // Store loaded scenario
    this.loadedScenarios.set(scenario.scenarioId, scenario);

    return scenario;
  }

  /**
   * Prepares a scenario for execution with resolved parameters.
   *
   * @param scenario - Scenario to prepare
   * @param parameters - Parameters to merge with defaults
   * @returns Prepared scenario
   */
  prepare(
    scenario: Scenario,
    parameters: ScenarioParameters = {}
  ): PreparedScenario {
    // Merge parameters with defaults
    const resolvedParameters = this.resolveParameters(
      scenario.parameterDefinitions ?? [],
      scenario.defaultParameters ?? {},
      parameters
    );

    // Calculate total steps (including nested)
    const totalSteps = this.countSteps(scenario.steps);

    // Estimate duration
    const estimatedDurationMs = this.estimateDuration(scenario);

    // Create prepared scenario
    const prepared: PreparedScenario = {
      definition: scenario,
      resolvedParameters,
      totalSteps,
      estimatedDurationMs,
      contentHash: createContentHashFromObject({
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        parameters: resolvedParameters,
      }),
    };

    // Cache prepared scenario
    const cacheKey = `${scenario.scenarioId}:${JSON.stringify(resolvedParameters)}`;
    this.preparedScenarios.set(cacheKey, prepared);

    return prepared;
  }

  // ==========================================================================
  // SCENARIO ACCESS
  // ==========================================================================

  /**
   * Gets a loaded scenario by ID.
   */
  getScenario(scenarioId: ScenarioId): Scenario | undefined {
    return this.loadedScenarios.get(scenarioId);
  }

  /**
   * Gets all loaded scenarios.
   */
  getAllScenarios(): ReadonlyArray<Scenario> {
    return Array.from(this.loadedScenarios.values());
  }

  /**
   * Checks if a scenario is loaded.
   */
  hasScenario(scenarioId: ScenarioId): boolean {
    return this.loadedScenarios.has(scenarioId);
  }

  // ==========================================================================
  // PARAMETER RESOLUTION
  // ==========================================================================

  /**
   * Resolves parameters by merging defaults with provided values.
   */
  private resolveParameters(
    definitions: ReadonlyArray<ParameterDefinition>,
    defaults: ScenarioParameters,
    provided: ScenarioParameters
  ): ScenarioParameters {
    const resolved: Record<string, unknown> = { ...defaults };

    // Merge provided values
    for (const [key, value] of Object.entries(provided)) {
      resolved[key] = value;
    }

    // Apply defaults from definitions
    for (const def of definitions) {
      if (!(def.name in resolved) && def.default !== undefined) {
        resolved[def.name] = def.default;
      }
    }

    // Validate required parameters
    for (const def of definitions) {
      if (def.required && !(def.name in resolved)) {
        throw new Error(`Missing required parameter: ${def.name}`);
      }
    }

    // Validate parameter values
    for (const def of definitions) {
      if (def.name in resolved) {
        this.validateParameter(def, resolved[def.name]);
      }
    }

    return resolved;
  }

  /**
   * Validates a single parameter value.
   */
  private validateParameter(def: ParameterDefinition, value: unknown): void {
    // Type validation
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== def.type && !(def.type === 'object' && actualType === 'object')) {
      throw new Error(
        `Parameter '${def.name}' has wrong type: expected ${def.type}, got ${actualType}`
      );
    }

    if (!def.validation) return;

    // Range validation for numbers
    if (typeof value === 'number') {
      if (def.validation.min !== undefined && value < def.validation.min) {
        throw new Error(
          `Parameter '${def.name}' is below minimum: ${value} < ${def.validation.min}`
        );
      }
      if (def.validation.max !== undefined && value > def.validation.max) {
        throw new Error(
          `Parameter '${def.name}' is above maximum: ${value} > ${def.validation.max}`
        );
      }
    }

    // Pattern validation for strings
    if (typeof value === 'string' && def.validation.pattern) {
      const regex = new RegExp(def.validation.pattern);
      if (!regex.test(value)) {
        throw new Error(
          `Parameter '${def.name}' doesn't match pattern: ${def.validation.pattern}`
        );
      }
    }

    // Enum validation
    if (def.validation.enum) {
      const found = def.validation.enum.some(
        (e) => JSON.stringify(e) === JSON.stringify(value)
      );
      if (!found) {
        throw new Error(
          `Parameter '${def.name}' is not in allowed values: ${JSON.stringify(def.validation.enum)}`
        );
      }
    }
  }

  // ==========================================================================
  // SCENARIO VALIDATION
  // ==========================================================================

  /**
   * Validates a scenario definition.
   */
  validate(scenario: Scenario): ScenarioValidationResult {
    const errors: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'error';
    }> = [];
    const warnings: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'warning';
    }> = [];

    // Validate required fields
    if (!scenario.scenarioId) {
      errors.push({
        code: 'MISSING_ID',
        message: 'Scenario ID is required',
        path: 'scenarioId',
        severity: 'error',
      });
    }

    if (!scenario.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'Scenario version is required',
        path: 'version',
        severity: 'error',
      });
    }

    if (!scenario.name || scenario.name.trim() === '') {
      errors.push({
        code: 'MISSING_NAME',
        message: 'Scenario name is required',
        path: 'name',
        severity: 'error',
      });
    }

    // Validate steps
    if (!scenario.steps || scenario.steps.length === 0) {
      errors.push({
        code: 'NO_STEPS',
        message: 'Scenario must have at least one step',
        path: 'steps',
        severity: 'error',
      });
    } else {
      // Validate each step
      const stepIds = new Set<string>();
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i]!;
        const stepErrors = this.validateStep(step, i, stepIds);
        errors.push(...stepErrors.errors);
        warnings.push(...stepErrors.warnings);
        stepIds.add(step.stepId);
      }
    }

    // Validate dependencies reference valid step IDs
    const allStepIds = new Set(scenario.steps.map((s) => s.stepId));
    for (const step of scenario.steps) {
      if (step.order.dependsOn) {
        for (const depId of step.order.dependsOn) {
          if (!allStepIds.has(depId)) {
            errors.push({
              code: 'INVALID_DEPENDENCY',
              message: `Step '${step.stepId}' depends on unknown step '${depId}'`,
              path: `steps.${step.stepId}.order.dependsOn`,
              severity: 'error',
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates a single step.
   */
  private validateStep(
    step: ScenarioStep,
    index: number,
    existingIds: Set<string>
  ): {
    errors: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'error';
    }>;
    warnings: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'warning';
    }>;
  } {
    const errors: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'error';
    }> = [];
    const warnings: Array<{
      code: string;
      message: string;
      path?: string;
      severity: 'warning';
    }> = [];

    const path = `steps[${index}]`;

    // Validate step ID
    if (!step.stepId) {
      errors.push({
        code: 'MISSING_STEP_ID',
        message: 'Step ID is required',
        path: `${path}.stepId`,
        severity: 'error',
      });
    } else if (existingIds.has(step.stepId)) {
      errors.push({
        code: 'DUPLICATE_STEP_ID',
        message: `Duplicate step ID: ${step.stepId}`,
        path: `${path}.stepId`,
        severity: 'error',
      });
    }

    // Validate step name
    if (!step.name || step.name.trim() === '') {
      errors.push({
        code: 'MISSING_STEP_NAME',
        message: 'Step name is required',
        path: `${path}.name`,
        severity: 'error',
      });
    }

    // Validate step type
    const validTypes = [
      'agent_action',
      'data_injection',
      'state_mutation',
      'policy_evaluation',
      'assertion',
      'delay',
      'branch',
      'loop',
      'subprocess',
      'checkpoint',
      'custom',
    ];
    if (!validTypes.includes(step.type)) {
      errors.push({
        code: 'INVALID_STEP_TYPE',
        message: `Invalid step type: ${step.type}`,
        path: `${path}.type`,
        severity: 'error',
      });
    }

    // Validate order
    if (typeof step.order.index !== 'number') {
      errors.push({
        code: 'INVALID_ORDER_INDEX',
        message: 'Step order index must be a number',
        path: `${path}.order.index`,
        severity: 'error',
      });
    }

    // Validate timeout
    if (step.timeoutMs !== undefined && step.timeoutMs <= 0) {
      warnings.push({
        code: 'INVALID_TIMEOUT',
        message: 'Step timeout should be positive',
        path: `${path}.timeoutMs`,
        severity: 'warning',
      });
    }

    return { errors, warnings };
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Counts total steps including nested steps.
   */
  private countSteps(steps: ReadonlyArray<ScenarioStep>): number {
    let count = 0;

    for (const step of steps) {
      count++;

      // Count nested steps in branches and loops
      if (step.type === 'branch') {
        const config = step.config as {
          trueBranch?: ReadonlyArray<ScenarioStep>;
          falseBranch?: ReadonlyArray<ScenarioStep>;
        };
        if (config.trueBranch) {
          count += this.countSteps(config.trueBranch);
        }
        if (config.falseBranch) {
          count += this.countSteps(config.falseBranch);
        }
      } else if (step.type === 'loop') {
        const config = step.config as {
          body?: ReadonlyArray<ScenarioStep>;
        };
        if (config.body) {
          count += this.countSteps(config.body);
        }
      }
    }

    return count;
  }

  /**
   * Estimates scenario duration.
   */
  private estimateDuration(scenario: Scenario): number {
    // Base estimate: 1 second per step
    let estimate = scenario.steps.length * 1000;

    // Add explicit delays
    for (const step of scenario.steps) {
      if (step.type === 'delay') {
        const config = step.config as { durationMs?: number };
        if (config.durationMs) {
          estimate += config.durationMs;
        }
      }
      // Add step timeouts as upper bound contribution
      if (step.timeoutMs) {
        estimate += step.timeoutMs / 10; // 10% of timeout as buffer
      }
    }

    // Apply scenario timeout as cap
    if (scenario.timeoutMs) {
      estimate = Math.min(estimate, scenario.timeoutMs);
    }

    return estimate;
  }

  /**
   * Computes content hash for a scenario.
   */
  private computeScenarioHash(scenario: Scenario): ContentHash {
    const canonical = {
      scenarioId: scenario.scenarioId,
      version: scenario.version,
      name: scenario.name,
      category: scenario.category,
      steps: scenario.steps.map((s) => ({
        stepId: s.stepId,
        type: s.type,
        config: s.config,
        order: s.order,
      })),
    };

    return createContentHashFromObject(canonical);
  }

  // ==========================================================================
  // FILE/REGISTRY LOADING (PLACEHOLDERS)
  // ==========================================================================

  /**
   * Loads a scenario from a file.
   */
  private async loadFromFile(path: string): Promise<Scenario> {
    throw new Error(
      `File-based scenario loading not implemented. Path: ${path}`
    );
  }

  /**
   * Loads a scenario from a registry.
   */
  private async loadFromRegistry(
    scenarioId: ScenarioId,
    _version?: string
  ): Promise<Scenario> {
    throw new Error(
      `Registry-based scenario loading not implemented. Scenario: ${scenarioId}`
    );
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Clears all loaded scenarios.
   */
  clear(): void {
    this.loadedScenarios.clear();
    this.preparedScenarios.clear();
  }

  /**
   * Removes a specific scenario.
   */
  remove(scenarioId: ScenarioId): boolean {
    return this.loadedScenarios.delete(scenarioId);
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new scenario loader.
 */
export function createScenarioLoader(): ScenarioLoader {
  return new ScenarioLoader();
}
