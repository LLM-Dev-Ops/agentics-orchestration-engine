/**
 * ERP Surface Adapter Interface.
 *
 * Defines the read-only interface for consuming normalized enterprise
 * data from the erp-surface system.
 *
 * CRITICAL: This adapter is READ-ONLY. The simulation engine must NEVER
 * write to or mutate data in the ERP surface or underlying systems.
 *
 * @module integration/adapters/erp-surface
 */

import type {
  EntityReference,
  ISOTimestamp,
  ContentHash,
  DateRange,
} from '../../types/common.js';

// ============================================================================
// ENTITY QUERY TYPES
// ============================================================================

/**
 * Pagination options for entity queries.
 */
export interface PaginationOptions {
  readonly offset: number;
  readonly limit: number;
}

/**
 * Sorting options for entity queries.
 */
export interface SortOptions {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * Filter operators for entity queries.
 */
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_equal'
  | 'less_equal'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

/**
 * A single filter condition for entity queries.
 */
export interface FilterCondition {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value?: unknown;
}

/**
 * Query parameters for fetching entities from ERP surface.
 */
export interface EntityQuery {
  /** Entity types to fetch */
  readonly entityTypes: ReadonlyArray<string>;
  /** Filter conditions (ANDed together) */
  readonly filters?: ReadonlyArray<FilterCondition>;
  /** Fields to include (null = all fields) */
  readonly fields?: ReadonlyArray<string>;
  /** Sorting options */
  readonly sort?: ReadonlyArray<SortOptions>;
  /** Pagination options */
  readonly pagination?: PaginationOptions;
  /** Date range for temporal queries */
  readonly dateRange?: DateRange;
  /** Include related entities */
  readonly includeRelated?: ReadonlyArray<string>;
  /** Query as of a specific point in time */
  readonly asOfTimestamp?: ISOTimestamp;
}

// ============================================================================
// NORMALIZED ENTITY TYPES
// ============================================================================

/**
 * Attributes of a normalized entity.
 */
export interface NormalizedAttributes {
  readonly [key: string]: unknown;
}

/**
 * A relationship between normalized entities.
 */
export interface NormalizedRelationship {
  readonly relationshipType: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * A normalized entity from the ERP surface.
 */
export interface NormalizedEntity {
  /** Entity type (e.g., 'order', 'customer', 'product') */
  readonly entityType: string;
  /** Unique identifier within the entity type */
  readonly entityId: string;
  /** Source system the entity came from */
  readonly sourceSystem: string;
  /** External identifiers in other systems */
  readonly externalIds: Readonly<Record<string, string>>;
  /** Normalized attributes */
  readonly attributes: NormalizedAttributes;
  /** Relationships to other entities */
  readonly relationships: ReadonlyArray<NormalizedRelationship>;
  /** When this entity was last updated */
  readonly lastUpdated: ISOTimestamp;
  /** Version for optimistic locking */
  readonly version: number;
  /** Content hash for integrity verification */
  readonly contentHash: ContentHash;
}

/**
 * A set of normalized entities returned from a query.
 */
export interface NormalizedEntitySet {
  /** The entities returned */
  readonly entities: ReadonlyArray<NormalizedEntity>;
  /** Total count (may be greater than returned entities if paginated) */
  readonly totalCount: number;
  /** Query that produced these results */
  readonly query: EntityQuery;
  /** When this data was fetched */
  readonly fetchedAt: ISOTimestamp;
  /** Content hash of the entire set for determinism verification */
  readonly contentHash: ContentHash;
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * JSON Schema definition for entity validation.
 */
export interface JSONSchema {
  readonly $schema?: string;
  readonly $id?: string;
  readonly type?: string;
  readonly properties?: Readonly<Record<string, JSONSchema>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean | JSONSchema;
  readonly items?: JSONSchema;
  readonly $ref?: string;
  readonly definitions?: Readonly<Record<string, JSONSchema>>;
  readonly [key: string]: unknown;
}

/**
 * Schema information for an entity type.
 */
export interface EntitySchema {
  /** Entity type this schema describes */
  readonly entityType: string;
  /** JSON Schema for entity validation */
  readonly schema: JSONSchema;
  /** Version of the schema */
  readonly version: string;
  /** Available relationship types */
  readonly relationships: ReadonlyArray<{
    readonly name: string;
    readonly targetEntityType: string;
    readonly cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
  }>;
}

// ============================================================================
// CONNECTION STATUS
// ============================================================================

/**
 * Health status of the ERP surface connection.
 */
export interface ERPSurfaceHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly lastSuccessfulFetch?: ISOTimestamp;
  readonly availableEntityTypes: ReadonlyArray<string>;
  readonly errors?: ReadonlyArray<string>;
}

// ============================================================================
// ERP SURFACE ADAPTER INTERFACE
// ============================================================================

/**
 * Adapter interface for ERP Surface integration.
 *
 * CRITICAL CONSTRAINTS:
 * - This interface is READ-ONLY
 * - No write, update, delete, or mutate methods are allowed
 * - All data access must be through read operations only
 * - The simulation engine must never modify production data
 *
 * Implementations should:
 * - Cache data appropriately for simulation performance
 * - Snapshot data at simulation start for determinism
 * - Log all data access for audit trails
 */
export interface ERPSurfaceAdapter {
  /**
   * Fetches entities matching the given query.
   *
   * @param query - Query parameters
   * @returns Promise resolving to normalized entity set
   */
  fetchEntities(query: EntityQuery): Promise<NormalizedEntitySet>;

  /**
   * Fetches a single entity by reference.
   *
   * @param reference - Entity reference
   * @returns Promise resolving to the entity or null if not found
   */
  fetchEntity(reference: EntityReference): Promise<NormalizedEntity | null>;

  /**
   * Fetches the schema for an entity type.
   *
   * @param entityType - Entity type to get schema for
   * @returns Promise resolving to the entity schema
   */
  getSchema(entityType: string): Promise<EntitySchema>;

  /**
   * Gets all available entity types.
   *
   * @returns Promise resolving to list of entity type names
   */
  getAvailableEntityTypes(): Promise<ReadonlyArray<string>>;

  /**
   * Checks the health of the ERP surface connection.
   *
   * @returns Promise resolving to health status
   */
  checkHealth(): Promise<ERPSurfaceHealth>;

  /**
   * Creates a snapshot of the current data state.
   * Used for deterministic simulation replay.
   *
   * @param query - Query defining what data to snapshot
   * @returns Promise resolving to content hash of the snapshot
   */
  createDataSnapshot(query: EntityQuery): Promise<ContentHash>;

  /**
   * Validates that data has not changed since a snapshot.
   *
   * @param snapshotHash - Content hash from createDataSnapshot
   * @param query - Query that was used for the snapshot
   * @returns Promise resolving to true if data matches snapshot
   */
  validateSnapshot(snapshotHash: ContentHash, query: EntityQuery): Promise<boolean>;

  // =========================================================================
  // EXPLICITLY FORBIDDEN METHODS - NOT DEFINED
  // The following methods are NOT part of this interface and must
  // NEVER be implemented or called:
  //
  // - create()       - FORBIDDEN: No creation of entities
  // - update()       - FORBIDDEN: No updating of entities
  // - delete()       - FORBIDDEN: No deletion of entities
  // - write()        - FORBIDDEN: No write operations
  // - mutate()       - FORBIDDEN: No mutations
  // - execute()      - FORBIDDEN: No execution of operations
  // - trigger()      - FORBIDDEN: No triggering of workflows
  // - send()         - FORBIDDEN: No sending of messages
  // =========================================================================
}

// ============================================================================
// MOCK IMPLEMENTATION FOR TESTING
// ============================================================================

/**
 * Configuration for mock ERP surface adapter.
 */
export interface MockERPSurfaceConfig {
  /** Simulated latency in milliseconds */
  readonly latencyMs?: number;
  /** Pre-loaded entities for testing */
  readonly entities?: ReadonlyArray<NormalizedEntity>;
  /** Entity schemas */
  readonly schemas?: ReadonlyArray<EntitySchema>;
  /** Whether to simulate failures */
  readonly simulateFailures?: boolean;
  /** Failure rate (0-1) if simulateFailures is true */
  readonly failureRate?: number;
}
