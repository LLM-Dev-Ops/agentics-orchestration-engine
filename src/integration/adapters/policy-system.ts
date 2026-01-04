/**
 * Policy System Adapter Interface.
 *
 * Defines the interface for integrating with external policy systems
 * and loading policy definitions for simulation evaluation.
 *
 * @module integration/adapters/policy-system
 */

import type {
  PolicyId,
  ISOTimestamp,
  ContentHash,
} from '../../types/common.js';
import type {
  Policy,
  PolicySet,
  PolicyValidationResult,
} from '../../types/policy.js';

// ============================================================================
// POLICY QUERY TYPES
// ============================================================================

/**
 * Query parameters for fetching policies.
 */
export interface PolicyQuery {
  /** Specific policy IDs to fetch */
  readonly policyIds?: ReadonlyArray<PolicyId>;
  /** Filter by resource types */
  readonly resourceTypes?: ReadonlyArray<string>;
  /** Filter by action types */
  readonly actionTypes?: ReadonlyArray<string>;
  /** Filter by environments */
  readonly environments?: ReadonlyArray<string>;
  /** Filter by tags */
  readonly tags?: ReadonlyArray<string>;
  /** Include disabled policies */
  readonly includeDisabled?: boolean;
  /** Filter by effective date */
  readonly effectiveAsOf?: ISOTimestamp;
}

// ============================================================================
// POLICY SOURCE TYPES
// ============================================================================

/**
 * A source location for policy definitions.
 */
export type PolicySource =
  | PolicyFileSource
  | PolicyRegistrySource
  | PolicyInlineSource;

/**
 * Policies loaded from file system.
 */
export interface PolicyFileSource {
  readonly type: 'file';
  readonly path: string;
  readonly format: 'json' | 'yaml';
  readonly recursive?: boolean;
}

/**
 * Policies loaded from a registry service.
 */
export interface PolicyRegistrySource {
  readonly type: 'registry';
  readonly endpoint: string;
  readonly namespace?: string;
  readonly version?: string;
}

/**
 * Policies provided inline.
 */
export interface PolicyInlineSource {
  readonly type: 'inline';
  readonly policies: ReadonlyArray<Policy>;
}

// ============================================================================
// POLICY LOAD RESULT
// ============================================================================

/**
 * Result of loading policies from a source.
 */
export interface PolicyLoadResult {
  /** Policies successfully loaded */
  readonly policies: ReadonlyArray<Policy>;
  /** Source the policies were loaded from */
  readonly source: PolicySource;
  /** When the policies were loaded */
  readonly loadedAt: ISOTimestamp;
  /** Content hash for integrity verification */
  readonly contentHash: ContentHash;
  /** Any errors encountered during loading */
  readonly errors: ReadonlyArray<{
    readonly message: string;
    readonly policyId?: PolicyId;
    readonly source?: string;
  }>;
  /** Any warnings during loading */
  readonly warnings: ReadonlyArray<{
    readonly message: string;
    readonly policyId?: PolicyId;
    readonly source?: string;
  }>;
}

// ============================================================================
// POLICY SYSTEM HEALTH
// ============================================================================

/**
 * Health status of the policy system connection.
 */
export interface PolicySystemHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly availablePolicies: number;
  readonly lastSyncAt?: ISOTimestamp;
  readonly errors?: ReadonlyArray<string>;
}

// ============================================================================
// POLICY SYSTEM ADAPTER INTERFACE
// ============================================================================

/**
 * Adapter interface for Policy System integration.
 *
 * Implementations should:
 * - Load policies from configured sources
 * - Validate policy definitions
 * - Cache policies for simulation performance
 * - Support policy versioning and effective dates
 */
export interface PolicySystemAdapter {
  /**
   * Loads policies from a source.
   *
   * @param source - Policy source configuration
   * @returns Promise resolving to load result
   */
  loadPolicies(source: PolicySource): Promise<PolicyLoadResult>;

  /**
   * Fetches policies matching the given query.
   *
   * @param query - Query parameters
   * @returns Promise resolving to matching policies
   */
  fetchPolicies(query: PolicyQuery): Promise<PolicySet>;

  /**
   * Fetches a single policy by ID.
   *
   * @param policyId - Policy identifier
   * @param version - Optional specific version
   * @returns Promise resolving to the policy or null if not found
   */
  fetchPolicy(policyId: PolicyId, version?: string): Promise<Policy | null>;

  /**
   * Validates a policy definition.
   *
   * @param policy - Policy to validate
   * @returns Promise resolving to validation result
   */
  validatePolicy(policy: Policy): Promise<PolicyValidationResult>;

  /**
   * Gets all available policy IDs.
   *
   * @returns Promise resolving to list of policy IDs
   */
  getAvailablePolicyIds(): Promise<ReadonlyArray<PolicyId>>;

  /**
   * Checks the health of the policy system connection.
   *
   * @returns Promise resolving to health status
   */
  checkHealth(): Promise<PolicySystemHealth>;

  /**
   * Creates a snapshot of the current policy state.
   * Used for deterministic simulation replay.
   *
   * @returns Promise resolving to content hash of the snapshot
   */
  createPolicySnapshot(): Promise<ContentHash>;

  /**
   * Registers a callback for policy change notifications.
   *
   * @param callback - Function to call when policies change
   * @returns Unsubscribe function
   */
  onPolicyChange(callback: (change: PolicyChangeEvent) => void): () => void;
}

// ============================================================================
// POLICY CHANGE EVENTS
// ============================================================================

/**
 * Event emitted when policies change.
 */
export interface PolicyChangeEvent {
  readonly type: 'added' | 'updated' | 'removed';
  readonly policyId: PolicyId;
  readonly timestamp: ISOTimestamp;
  readonly previousVersion?: string;
  readonly newVersion?: string;
}

// ============================================================================
// MOCK CONFIGURATION
// ============================================================================

/**
 * Configuration for mock policy system adapter.
 */
export interface MockPolicySystemConfig {
  /** Simulated latency in milliseconds */
  readonly latencyMs?: number;
  /** Pre-loaded policies for testing */
  readonly policies?: ReadonlyArray<Policy>;
  /** Whether to simulate failures */
  readonly simulateFailures?: boolean;
  /** Failure rate (0-1) if simulateFailures is true */
  readonly failureRate?: number;
}
