/**
 * Policy Evaluation Context Builder.
 *
 * Provides utilities for building policy evaluation contexts
 * from various sources and ensuring all required fields are populated.
 *
 * @module policy/context
 */

import type { ISOTimestamp, SimulationId } from '../types/common.js';
import type {
  PolicyEvaluationContext,
  PolicyDecisionRecord,
} from '../types/policy.js';

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

/**
 * Builder for creating policy evaluation contexts.
 *
 * Provides a fluent API for constructing contexts with
 * validation and default values.
 */
export class PolicyContextBuilder {
  private actionType = '';
  private actionConfig?: Record<string, unknown>;
  private resourceType = '';
  private resourceId?: string;
  private resourceAttributes?: Record<string, unknown>;
  private environment = 'simulation';
  private simulationId = '';
  private simulatedTime: ISOTimestamp = new Date().toISOString() as ISOTimestamp;
  private currentState?: Record<string, unknown>;
  private previousDecisions: PolicyDecisionRecord[] = [];
  private actor?: {
    type: string;
    id: string;
    attributes?: Record<string, unknown>;
  };
  private targetEntities: Array<{
    type: string;
    id: string;
    attributes?: Record<string, unknown>;
  }> = [];
  private customAttributes: Record<string, unknown> = {};

  /**
   * Sets the action type.
   */
  withAction(
    type: string,
    config?: Record<string, unknown>
  ): PolicyContextBuilder {
    this.actionType = type;
    this.actionConfig = config;
    return this;
  }

  /**
   * Sets the resource information.
   */
  withResource(
    type: string,
    id?: string,
    attributes?: Record<string, unknown>
  ): PolicyContextBuilder {
    this.resourceType = type;
    this.resourceId = id;
    this.resourceAttributes = attributes;
    return this;
  }

  /**
   * Sets the environment.
   */
  withEnvironment(environment: string): PolicyContextBuilder {
    this.environment = environment;
    return this;
  }

  /**
   * Sets the simulation context.
   */
  withSimulation(
    simulationId: SimulationId,
    simulatedTime: ISOTimestamp
  ): PolicyContextBuilder {
    this.simulationId = simulationId;
    this.simulatedTime = simulatedTime;
    return this;
  }

  /**
   * Sets the current state.
   */
  withState(state: Record<string, unknown>): PolicyContextBuilder {
    this.currentState = state;
    return this;
  }

  /**
   * Adds previous policy decisions.
   */
  withPreviousDecisions(
    decisions: ReadonlyArray<PolicyDecisionRecord>
  ): PolicyContextBuilder {
    this.previousDecisions = [...decisions];
    return this;
  }

  /**
   * Sets the actor performing the action.
   */
  withActor(
    type: string,
    id: string,
    attributes?: Record<string, unknown>
  ): PolicyContextBuilder {
    this.actor = { type, id, attributes };
    return this;
  }

  /**
   * Adds a target entity.
   */
  addTargetEntity(
    type: string,
    id: string,
    attributes?: Record<string, unknown>
  ): PolicyContextBuilder {
    this.targetEntities.push({ type, id, attributes });
    return this;
  }

  /**
   * Sets target entities (replaces existing).
   */
  withTargetEntities(
    entities: ReadonlyArray<{
      type: string;
      id: string;
      attributes?: Record<string, unknown>;
    }>
  ): PolicyContextBuilder {
    this.targetEntities = [...entities];
    return this;
  }

  /**
   * Sets a custom attribute.
   */
  withCustomAttribute(key: string, value: unknown): PolicyContextBuilder {
    this.customAttributes[key] = value;
    return this;
  }

  /**
   * Sets multiple custom attributes.
   */
  withCustomAttributes(
    attributes: Record<string, unknown>
  ): PolicyContextBuilder {
    this.customAttributes = { ...this.customAttributes, ...attributes };
    return this;
  }

  /**
   * Builds the policy evaluation context.
   *
   * @throws Error if required fields are missing
   */
  build(): PolicyEvaluationContext {
    // Validate required fields
    if (!this.actionType) {
      throw new Error('Action type is required');
    }
    if (!this.resourceType) {
      throw new Error('Resource type is required');
    }
    if (!this.simulationId) {
      throw new Error('Simulation ID is required');
    }

    return {
      actionType: this.actionType,
      actionConfig: this.actionConfig,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      resourceAttributes: this.resourceAttributes,
      environment: this.environment,
      simulationId: this.simulationId,
      simulatedTime: this.simulatedTime,
      currentState: this.currentState,
      previousDecisions:
        this.previousDecisions.length > 0 ? this.previousDecisions : undefined,
      actor: this.actor,
      targetEntities:
        this.targetEntities.length > 0 ? this.targetEntities : undefined,
      customAttributes:
        Object.keys(this.customAttributes).length > 0
          ? this.customAttributes
          : undefined,
    };
  }

  /**
   * Resets the builder to initial state.
   */
  reset(): PolicyContextBuilder {
    this.actionType = '';
    this.actionConfig = undefined;
    this.resourceType = '';
    this.resourceId = undefined;
    this.resourceAttributes = undefined;
    this.environment = 'simulation';
    this.simulationId = '';
    this.simulatedTime = new Date().toISOString() as ISOTimestamp;
    this.currentState = undefined;
    this.previousDecisions = [];
    this.actor = undefined;
    this.targetEntities = [];
    this.customAttributes = {};
    return this;
  }
}

// ============================================================================
// CONTEXT UTILITIES
// ============================================================================

/**
 * Creates a minimal policy evaluation context.
 *
 * @param actionType - Type of action
 * @param resourceType - Type of resource
 * @param simulationId - Simulation identifier
 * @param simulatedTime - Current simulated time
 */
export function createMinimalContext(
  actionType: string,
  resourceType: string,
  simulationId: SimulationId,
  simulatedTime: ISOTimestamp
): PolicyEvaluationContext {
  return {
    actionType,
    resourceType,
    environment: 'simulation',
    simulationId,
    simulatedTime,
  };
}

/**
 * Merges additional attributes into an existing context.
 *
 * @param context - Base context
 * @param overrides - Attributes to merge
 * @returns New context with merged attributes
 */
export function mergeContext(
  context: PolicyEvaluationContext,
  overrides: Partial<PolicyEvaluationContext>
): PolicyEvaluationContext {
  return {
    ...context,
    ...overrides,
    customAttributes:
      overrides.customAttributes || context.customAttributes
        ? {
            ...context.customAttributes,
            ...overrides.customAttributes,
          }
        : undefined,
  };
}

/**
 * Extracts a summary of the context for logging.
 *
 * @param context - Context to summarize
 * @returns Summary object
 */
export function summarizeContext(context: PolicyEvaluationContext): {
  action: string;
  resource: string;
  actor: string | undefined;
  environment: string;
} {
  return {
    action: context.actionType,
    resource: context.resourceId
      ? `${context.resourceType}:${context.resourceId}`
      : context.resourceType,
    actor: context.actor
      ? `${context.actor.type}:${context.actor.id}`
      : undefined,
    environment: context.environment,
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a new policy context builder.
 */
export function createPolicyContextBuilder(): PolicyContextBuilder {
  return new PolicyContextBuilder();
}
