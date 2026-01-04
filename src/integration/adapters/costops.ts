/**
 * CostOps Adapter Interface.
 *
 * Defines the interface for integrating with cost operations systems.
 *
 * CRITICAL: This adapter is PASSTHROUGH ONLY. The simulation engine
 * does NOT perform cost calculations - it only fetches baseline data
 * and passes it unchanged to the economic-impact system for analysis.
 *
 * Cost calculations are owned by the economic-impact system.
 *
 * @module integration/adapters/costops
 */

import type {
  EntityReference,
  ISOTimestamp,
  ContentHash,
  DateRange,
} from '../../types/common.js';

// ============================================================================
// COST BASELINE TYPES
// ============================================================================

/**
 * Currency code (ISO 4217).
 */
export type CurrencyCode = string;

/**
 * A monetary amount with currency.
 */
export interface MonetaryAmount {
  readonly value: number;
  readonly currency: CurrencyCode;
}

/**
 * Cost category for classification.
 */
export type CostCategory =
  | 'labor'
  | 'materials'
  | 'overhead'
  | 'infrastructure'
  | 'licensing'
  | 'maintenance'
  | 'operations'
  | 'other';

/**
 * A single cost line item.
 */
export interface CostLineItem {
  /** Unique identifier for this line item */
  readonly lineItemId: string;
  /** Description of the cost */
  readonly description: string;
  /** Cost category */
  readonly category: CostCategory;
  /** Amount */
  readonly amount: MonetaryAmount;
  /** Time period this cost applies to */
  readonly period: DateRange;
  /** Associated entity reference */
  readonly entityReference?: EntityReference;
  /** Additional metadata */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Baseline cost data for an entity.
 */
export interface CostBaseline {
  /** Entity this baseline is for */
  readonly entityReference: EntityReference;
  /** Baseline period */
  readonly period: DateRange;
  /** Cost line items */
  readonly lineItems: ReadonlyArray<CostLineItem>;
  /** Total cost for the period */
  readonly totalCost: MonetaryAmount;
  /** When this baseline was computed */
  readonly computedAt: ISOTimestamp;
  /** Data source for the baseline */
  readonly source: string;
  /** Content hash for integrity verification */
  readonly contentHash: ContentHash;
}

/**
 * A set of cost baselines returned from a query.
 */
export interface CostBaselineSet {
  /** The baselines returned */
  readonly baselines: ReadonlyArray<CostBaseline>;
  /** When this data was fetched */
  readonly fetchedAt: ISOTimestamp;
  /** Content hash of the entire set */
  readonly contentHash: ContentHash;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for fetching cost baselines.
 */
export interface CostBaselineQuery {
  /** Entity references to fetch baselines for */
  readonly entityReferences: ReadonlyArray<EntityReference>;
  /** Date range for the baselines */
  readonly dateRange?: DateRange;
  /** Cost categories to include */
  readonly categories?: ReadonlyArray<CostCategory>;
  /** Currency to convert to (if supported) */
  readonly targetCurrency?: CurrencyCode;
}

// ============================================================================
// COSTOPS HEALTH
// ============================================================================

/**
 * Health status of the CostOps connection.
 */
export interface CostOpsHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly lastSuccessfulFetch?: ISOTimestamp;
  readonly availableCategories: ReadonlyArray<CostCategory>;
  readonly supportedCurrencies: ReadonlyArray<CurrencyCode>;
  readonly errors?: ReadonlyArray<string>;
}

// ============================================================================
// COSTOPS ADAPTER INTERFACE
// ============================================================================

/**
 * Adapter interface for CostOps integration.
 *
 * CRITICAL CONSTRAINTS:
 * - This adapter is PASSTHROUGH ONLY
 * - No cost calculations are performed by this adapter
 * - Data is fetched and passed unchanged to economic-impact system
 * - The simulation engine does NOT compute costs, savings, or ROI
 *
 * Implementations should:
 * - Fetch cost baseline data from source systems
 * - Cache data appropriately for simulation performance
 * - Snapshot data at simulation start for determinism
 * - Log all data access for audit trails
 */
export interface CostOpsAdapter {
  /**
   * Fetches cost baselines for the given entities.
   *
   * NOTE: This method only fetches raw baseline data.
   * It does NOT perform any cost calculations.
   * Cost analysis is performed by the economic-impact system.
   *
   * @param query - Query parameters
   * @returns Promise resolving to cost baseline set
   */
  fetchBaselines(query: CostBaselineQuery): Promise<CostBaselineSet>;

  /**
   * Fetches a single cost baseline by entity reference.
   *
   * @param entityReference - Entity reference
   * @param dateRange - Optional date range
   * @returns Promise resolving to the baseline or null if not found
   */
  fetchBaseline(
    entityReference: EntityReference,
    dateRange?: DateRange
  ): Promise<CostBaseline | null>;

  /**
   * Gets available cost categories.
   *
   * @returns Promise resolving to list of cost categories
   */
  getAvailableCategories(): Promise<ReadonlyArray<CostCategory>>;

  /**
   * Gets supported currencies.
   *
   * @returns Promise resolving to list of currency codes
   */
  getSupportedCurrencies(): Promise<ReadonlyArray<CurrencyCode>>;

  /**
   * Checks the health of the CostOps connection.
   *
   * @returns Promise resolving to health status
   */
  checkHealth(): Promise<CostOpsHealth>;

  /**
   * Creates a snapshot of the current cost data.
   * Used for deterministic simulation replay.
   *
   * @param query - Query defining what data to snapshot
   * @returns Promise resolving to content hash of the snapshot
   */
  createCostSnapshot(query: CostBaselineQuery): Promise<ContentHash>;

  // =========================================================================
  // EXPLICITLY FORBIDDEN METHODS - NOT DEFINED
  // The following methods are NOT part of this interface and must
  // NEVER be implemented or called:
  //
  // - calculateCost()     - FORBIDDEN: Cost calculations owned by economic-impact
  // - computeSavings()    - FORBIDDEN: Savings calculations owned by economic-impact
  // - computeROI()        - FORBIDDEN: ROI calculations owned by economic-impact
  // - projectCosts()      - FORBIDDEN: Cost projections owned by economic-impact
  // - compareCosts()      - FORBIDDEN: Cost comparisons owned by economic-impact
  // - analyzeCosts()      - FORBIDDEN: Cost analysis owned by economic-impact
  // =========================================================================
}

// ============================================================================
// MOCK CONFIGURATION
// ============================================================================

/**
 * Configuration for mock CostOps adapter.
 */
export interface MockCostOpsConfig {
  /** Simulated latency in milliseconds */
  readonly latencyMs?: number;
  /** Pre-loaded baselines for testing */
  readonly baselines?: ReadonlyArray<CostBaseline>;
  /** Available categories */
  readonly categories?: ReadonlyArray<CostCategory>;
  /** Supported currencies */
  readonly currencies?: ReadonlyArray<CurrencyCode>;
  /** Whether to simulate failures */
  readonly simulateFailures?: boolean;
  /** Failure rate (0-1) if simulateFailures is true */
  readonly failureRate?: number;
}
