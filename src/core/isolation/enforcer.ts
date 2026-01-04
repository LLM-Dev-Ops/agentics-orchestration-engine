/**
 * Isolation Enforcer.
 *
 * Runtime enforcement of production isolation during simulation.
 * This component is CRITICAL for safety - it ensures simulations
 * never access or modify production systems.
 *
 * @module core/isolation/enforcer
 */

import type { ISOTimestamp, SimulationId } from '../../types/common.js';
import {
  IsolationBreachError,
  FatalError,
  ErrorCodes,
} from '../../error/types.js';
import type {
  IsolationBoundary,
  NetworkEndpoint,
  CredentialPattern,
  FileSystemPath,
  EnvironmentPattern,
} from './boundary.js';

// ============================================================================
// ISOLATION BREACH TYPES
// ============================================================================

/**
 * Type of isolation breach detected.
 */
export type BreachType =
  | 'network_endpoint'
  | 'production_credential'
  | 'file_system'
  | 'environment_variable'
  | 'external_command';

/**
 * Record of an isolation breach attempt.
 */
export interface IsolationBreachRecord {
  readonly id: string;
  readonly timestamp: ISOTimestamp;
  readonly simulationId?: SimulationId;
  readonly breachType: BreachType;
  readonly target: string;
  readonly operation: string;
  readonly blocked: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Result of an isolation check.
 */
export interface IsolationCheckResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly matchedRule?: string;
  readonly breachRecord?: IsolationBreachRecord;
}

// ============================================================================
// ISOLATION ENFORCER
// ============================================================================

/**
 * Enforces production isolation during simulation execution.
 *
 * CRITICAL SAFETY COMPONENT:
 * - All external access must be validated through this enforcer
 * - Any isolation breach triggers immediate failure
 * - All access attempts are logged for audit
 */
export class IsolationEnforcer {
  private readonly boundary: IsolationBoundary;
  private readonly breachLog: IsolationBreachRecord[] = [];
  private readonly simulationId?: SimulationId;
  private breachCount = 0;
  private checkCount = 0;
  private readonly startTime: ISOTimestamp;

  constructor(boundary: IsolationBoundary, simulationId?: SimulationId) {
    this.boundary = boundary;
    this.simulationId = simulationId;
    this.startTime = new Date().toISOString() as ISOTimestamp;
  }

  // ==========================================================================
  // NETWORK ISOLATION
  // ==========================================================================

  /**
   * Checks if a network endpoint is allowed.
   *
   * @param protocol - Protocol (http, https, etc.)
   * @param host - Hostname or IP
   * @param port - Port number
   * @param path - Request path
   * @returns Check result
   */
  checkNetworkEndpoint(
    protocol: string,
    host: string,
    port: number | null,
    path?: string
  ): IsolationCheckResult {
    this.checkCount++;

    // Check blocked endpoints first
    for (const blocked of this.boundary.blockedEndpoints) {
      if (this.matchesEndpoint(blocked, protocol, host, port, path)) {
        return this.createBreachResult(
          'network_endpoint',
          `${protocol}://${host}:${port ?? 'any'}${path ?? ''}`,
          'connect',
          `Blocked by rule: ${blocked.host}`,
          { blocked }
        );
      }
    }

    // Check allowed endpoints
    for (const allowed of this.boundary.allowedEndpoints) {
      if (this.matchesEndpoint(allowed, protocol, host, port, path)) {
        return {
          allowed: true,
          reason: `Allowed by rule: ${allowed.host}`,
          matchedRule: allowed.host,
        };
      }
    }

    // Apply default policy
    if (this.boundary.defaultNetworkPolicy === 'deny') {
      return this.createBreachResult(
        'network_endpoint',
        `${protocol}://${host}:${port ?? 'any'}${path ?? ''}`,
        'connect',
        'Denied by default network policy',
        { defaultPolicy: true }
      );
    }

    return {
      allowed: true,
      reason: 'Allowed by default network policy',
    };
  }

  /**
   * Verifies that no production endpoints are accessible.
   * This should be called at simulation start.
   */
  verifyNoProductionEndpoints(): boolean {
    // The very existence of strict boundary configuration is the verification
    if (this.boundary.defaultNetworkPolicy === 'deny') {
      return true;
    }

    // If allow by default, check that production patterns are blocked
    const hasProductionBlocks = this.boundary.blockedEndpoints.some(
      (ep) => ep.host.includes('prod') || ep.host.includes('production')
    );

    if (!hasProductionBlocks) {
      this.logBreach('network_endpoint', 'production-check', 'verify', {
        reason: 'No production blocking rules configured',
      });
      return false;
    }

    return true;
  }

  // ==========================================================================
  // CREDENTIAL ISOLATION
  // ==========================================================================

  /**
   * Checks if a credential is allowed (i.e., not a production credential).
   *
   * @param credentialType - Type of credential
   * @param credentialValue - Credential value or identifier
   * @returns Check result
   */
  checkCredential(
    credentialType: string,
    credentialValue: string
  ): IsolationCheckResult {
    this.checkCount++;

    for (const pattern of this.boundary.blockedCredentials) {
      if (this.matchesCredential(pattern, credentialType, credentialValue)) {
        return this.createBreachResult(
          'production_credential',
          `[MASKED:${credentialType}]`,
          'access',
          `Blocked by pattern: ${pattern.description}`,
          { pattern: pattern.description }
        );
      }
    }

    return {
      allowed: true,
      reason: 'Credential does not match any blocked patterns',
    };
  }

  /**
   * Checks a credential name/key (not the value) against production patterns.
   *
   * @param credentialName - Name of the credential (e.g., env var name)
   * @returns Check result
   */
  checkCredentialName(credentialName: string): IsolationCheckResult {
    this.checkCount++;

    for (const pattern of this.boundary.blockedCredentials) {
      const regex = pattern.isRegex
        ? new RegExp(pattern.pattern, 'i')
        : new RegExp(pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      if (regex.test(credentialName)) {
        return this.createBreachResult(
          'production_credential',
          credentialName,
          'access',
          `Blocked by pattern: ${pattern.description}`,
          { pattern: pattern.description }
        );
      }
    }

    return {
      allowed: true,
      reason: 'Credential name does not match any blocked patterns',
    };
  }

  /**
   * Verifies that no production credentials are accessible.
   * This should be called at simulation start.
   */
  verifyNoProductionCredentials(): boolean {
    // Check that we have blocked credential patterns configured
    if (this.boundary.blockedCredentials.length === 0) {
      this.logBreach('production_credential', 'production-check', 'verify', {
        reason: 'No credential blocking patterns configured',
      });
      return false;
    }

    return true;
  }

  // ==========================================================================
  // FILE SYSTEM ISOLATION
  // ==========================================================================

  /**
   * Checks if a file system operation is allowed.
   *
   * @param path - File system path
   * @param operation - Operation type
   * @returns Check result
   */
  checkFileSystemAccess(
    path: string,
    operation: 'read' | 'write' | 'delete' | 'create'
  ): IsolationCheckResult {
    this.checkCount++;

    // Check blocked paths first
    for (const blocked of this.boundary.blockedPaths) {
      if (
        this.matchesPath(blocked, path) &&
        blocked.operations.includes(operation)
      ) {
        return this.createBreachResult(
          'file_system',
          path,
          operation,
          `Blocked by rule: ${blocked.path}`,
          { blocked }
        );
      }
    }

    // Check allowed paths
    for (const allowed of this.boundary.allowedPaths) {
      if (
        this.matchesPath(allowed, path) &&
        allowed.operations.includes(operation)
      ) {
        return {
          allowed: true,
          reason: `Allowed by rule: ${allowed.path}`,
          matchedRule: allowed.path,
        };
      }
    }

    // Apply default policy
    if (this.boundary.defaultFileSystemPolicy === 'deny') {
      return this.createBreachResult(
        'file_system',
        path,
        operation,
        'Denied by default file system policy',
        { defaultPolicy: true }
      );
    }

    return {
      allowed: true,
      reason: 'Allowed by default file system policy',
    };
  }

  // ==========================================================================
  // ENVIRONMENT VARIABLE ISOLATION
  // ==========================================================================

  /**
   * Checks if an environment variable is allowed.
   *
   * @param variableName - Environment variable name
   * @returns Check result with action
   */
  checkEnvironmentVariable(variableName: string): IsolationCheckResult & {
    action: 'allow' | 'mask' | 'block';
  } {
    this.checkCount++;

    for (const pattern of this.boundary.environmentPatterns) {
      const regex = pattern.isRegex
        ? new RegExp(pattern.namePattern)
        : new RegExp(
            pattern.namePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          );

      if (regex.test(variableName)) {
        if (pattern.action === 'block') {
          return {
            ...this.createBreachResult(
              'environment_variable',
              variableName,
              'access',
              `Blocked by pattern: ${pattern.namePattern}`,
              { pattern }
            ),
            action: 'block',
          };
        }

        return {
          allowed: true,
          reason: `${pattern.action} by pattern: ${pattern.namePattern}`,
          matchedRule: pattern.namePattern,
          action: pattern.action,
        };
      }
    }

    return {
      allowed: true,
      reason: 'No matching environment pattern',
      action: 'allow',
    };
  }

  // ==========================================================================
  // EXTERNAL COMMUNICATION LOGGING
  // ==========================================================================

  /**
   * Logs an attempt to communicate with an external system.
   * All external communication should be logged for audit purposes.
   *
   * @param target - Target system identifier
   * @param details - Additional details
   */
  logExternalCommunicationAttempt(
    target: string,
    details?: Record<string, unknown>
  ): void {
    if (this.boundary.logAllChecks) {
      this.logBreach('network_endpoint', target, 'attempt', details ?? {}, false);
    }
  }

  // ==========================================================================
  // BREACH HANDLING
  // ==========================================================================

  /**
   * Fails execution due to an isolation breach.
   * This method never returns - it always throws.
   */
  failOnIsolationBreach(
    breachType: BreachType,
    target: string,
    operation: string,
    details?: Record<string, unknown>
  ): never {
    const record = this.logBreach(breachType, target, operation, details ?? {});

    throw new IsolationBreachError(target, operation, {
      component: 'IsolationEnforcer',
      operation,
      simulationId: this.simulationId,
      details: {
        breachRecord: record,
        breachType,
        ...details,
      },
    });
  }

  // ==========================================================================
  // STATUS AND REPORTING
  // ==========================================================================

  /**
   * Gets all recorded breach attempts.
   */
  getBreachLog(): ReadonlyArray<IsolationBreachRecord> {
    return [...this.breachLog];
  }

  /**
   * Gets isolation statistics.
   */
  getStatistics(): IsolationStatistics {
    return {
      startTime: this.startTime,
      checkCount: this.checkCount,
      breachCount: this.breachCount,
      boundaryId: this.boundary.boundaryId,
      boundaryVersion: this.boundary.version,
      simulationId: this.simulationId,
    };
  }

  /**
   * Resets breach log and statistics.
   */
  reset(): void {
    this.breachLog.length = 0;
    this.breachCount = 0;
    this.checkCount = 0;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private matchesEndpoint(
    rule: NetworkEndpoint,
    protocol: string,
    host: string,
    port: number | null,
    path?: string
  ): boolean {
    // Check protocol
    if (rule.protocol !== protocol) {
      return false;
    }

    // Check host (supports wildcards)
    const hostPattern = rule.host.replace(/\./g, '\\.').replace(/\*/g, '.*');
    const hostRegex = new RegExp(`^${hostPattern}$`, 'i');
    if (!hostRegex.test(host)) {
      return false;
    }

    // Check port
    if (rule.port !== null && rule.port !== port) {
      return false;
    }

    // Check path prefix
    if (rule.pathPrefix !== null && path) {
      if (!path.startsWith(rule.pathPrefix)) {
        return false;
      }
    }

    return true;
  }

  private matchesCredential(
    pattern: CredentialPattern,
    credentialType: string,
    credentialValue: string
  ): boolean {
    // Type must match or pattern type is 'custom'
    if (pattern.type !== 'custom' && pattern.type !== credentialType) {
      return false;
    }

    const regex = pattern.isRegex
      ? new RegExp(pattern.pattern, 'i')
      : new RegExp(pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    return regex.test(credentialValue);
  }

  private matchesPath(rule: FileSystemPath, path: string): boolean {
    if (rule.isGlob) {
      // Simple glob matching
      const pattern = rule.path
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(path);
    }
    return path === rule.path || path.startsWith(rule.path + '/');
  }

  private createBreachResult(
    breachType: BreachType,
    target: string,
    operation: string,
    reason: string,
    details: Record<string, unknown>
  ): IsolationCheckResult {
    const record = this.logBreach(breachType, target, operation, details);

    // If fail-fast is enabled, throw immediately
    if (this.boundary.failFast) {
      throw new IsolationBreachError(target, operation, {
        component: 'IsolationEnforcer',
        operation,
        simulationId: this.simulationId,
        details: {
          breachRecord: record,
          breachType,
          ...details,
        },
      });
    }

    return {
      allowed: false,
      reason,
      breachRecord: record,
    };
  }

  private logBreach(
    breachType: BreachType,
    target: string,
    operation: string,
    details: Record<string, unknown>,
    blocked = true
  ): IsolationBreachRecord {
    this.breachCount++;
    const record: IsolationBreachRecord = {
      id: `breach-${this.breachCount}-${Date.now()}`,
      timestamp: new Date().toISOString() as ISOTimestamp,
      simulationId: this.simulationId,
      breachType,
      target,
      operation,
      blocked,
      details,
    };
    this.breachLog.push(record);
    return record;
  }
}

// ============================================================================
// STATISTICS TYPES
// ============================================================================

/**
 * Isolation enforcement statistics.
 */
export interface IsolationStatistics {
  readonly startTime: ISOTimestamp;
  readonly checkCount: number;
  readonly breachCount: number;
  readonly boundaryId: string;
  readonly boundaryVersion: string;
  readonly simulationId?: SimulationId;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an isolation enforcer with strict production boundary.
 */
export function createStrictEnforcer(simulationId?: SimulationId): IsolationEnforcer {
  // Import dynamically to avoid circular dependency
  const { createStrictIsolationBoundary } = require('./boundary.js');
  const boundary = createStrictIsolationBoundary(`strict-${Date.now()}`);
  return new IsolationEnforcer(boundary, simulationId);
}

/**
 * Creates an isolation enforcer with development boundary.
 * WARNING: Not for production use.
 */
export function createDevelopmentEnforcer(simulationId?: SimulationId): IsolationEnforcer {
  // Import dynamically to avoid circular dependency
  const { createDevelopmentIsolationBoundary } = require('./boundary.js');
  const boundary = createDevelopmentIsolationBoundary(`dev-${Date.now()}`);
  return new IsolationEnforcer(boundary, simulationId);
}
