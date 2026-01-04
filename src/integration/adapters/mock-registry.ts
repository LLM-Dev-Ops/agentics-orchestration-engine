/**
 * Mock Service Registry.
 *
 * Provides mock implementations of external service adapters for
 * simulation isolation and testing.
 *
 * In simulation mode, all external service calls are routed through
 * mock implementations to ensure complete isolation from production.
 *
 * @module integration/adapters/mock-registry
 */

import type {
  EntityReference,
  ISOTimestamp,
  ContentHash,
  PolicyId,
} from '../../types/common.js';
import type { Policy, PolicySet } from '../../types/policy.js';
import type {
  ERPSurfaceAdapter,
  NormalizedEntity,
  NormalizedEntitySet,
  EntityQuery,
  EntitySchema,
  ERPSurfaceHealth,
  MockERPSurfaceConfig,
} from './erp-surface.js';
import type {
  PolicySystemAdapter,
  PolicySource,
  PolicyLoadResult,
  PolicyQuery,
  PolicySystemHealth,
  PolicyChangeEvent,
  MockPolicySystemConfig,
} from './policy-system.js';
import type {
  CostOpsAdapter,
  CostBaseline,
  CostBaselineSet,
  CostBaselineQuery,
  CostOpsHealth,
  CostCategory,
  CurrencyCode,
  MockCostOpsConfig,
} from './costops.js';
import { createContentHash } from '../../utils/hash.js';
import { canonicalSerialize } from '../../utils/serialize.js';

// ============================================================================
// MOCK SERVICE REGISTRY
// ============================================================================

/**
 * Registry for mock service implementations.
 *
 * This registry manages mock adapters that replace real external services
 * during simulation execution. It ensures complete production isolation.
 */
export class MockServiceRegistry {
  private erpSurfaceAdapter: MockERPSurfaceAdapter | null = null;
  private policySystemAdapter: MockPolicySystemAdapter | null = null;
  private costOpsAdapter: MockCostOpsAdapter | null = null;
  private readonly accessLog: MockAccessLogEntry[] = [];

  /**
   * Registers a mock ERP Surface adapter.
   */
  registerERPSurface(config: MockERPSurfaceConfig): void {
    this.erpSurfaceAdapter = new MockERPSurfaceAdapter(config, this.accessLog);
  }

  /**
   * Registers a mock Policy System adapter.
   */
  registerPolicySystem(config: MockPolicySystemConfig): void {
    this.policySystemAdapter = new MockPolicySystemAdapter(config, this.accessLog);
  }

  /**
   * Registers a mock CostOps adapter.
   */
  registerCostOps(config: MockCostOpsConfig): void {
    this.costOpsAdapter = new MockCostOpsAdapter(config, this.accessLog);
  }

  /**
   * Gets the mock ERP Surface adapter.
   *
   * @throws Error if adapter not registered
   */
  getERPSurface(): ERPSurfaceAdapter {
    if (!this.erpSurfaceAdapter) {
      throw new Error('Mock ERP Surface adapter not registered');
    }
    return this.erpSurfaceAdapter;
  }

  /**
   * Gets the mock Policy System adapter.
   *
   * @throws Error if adapter not registered
   */
  getPolicySystem(): PolicySystemAdapter {
    if (!this.policySystemAdapter) {
      throw new Error('Mock Policy System adapter not registered');
    }
    return this.policySystemAdapter;
  }

  /**
   * Gets the mock CostOps adapter.
   *
   * @throws Error if adapter not registered
   */
  getCostOps(): CostOpsAdapter {
    if (!this.costOpsAdapter) {
      throw new Error('Mock CostOps adapter not registered');
    }
    return this.costOpsAdapter;
  }

  /**
   * Gets the access log for audit purposes.
   */
  getAccessLog(): ReadonlyArray<MockAccessLogEntry> {
    return [...this.accessLog];
  }

  /**
   * Clears the access log.
   */
  clearAccessLog(): void {
    this.accessLog.length = 0;
  }

  /**
   * Resets all registered mocks.
   */
  reset(): void {
    this.erpSurfaceAdapter = null;
    this.policySystemAdapter = null;
    this.costOpsAdapter = null;
    this.accessLog.length = 0;
  }
}

// ============================================================================
// MOCK ACCESS LOG
// ============================================================================

/**
 * Log entry for mock service access.
 */
export interface MockAccessLogEntry {
  readonly timestamp: ISOTimestamp;
  readonly service: 'erp-surface' | 'policy-system' | 'costops';
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly resultHash?: ContentHash;
  readonly durationMs: number;
}

// ============================================================================
// MOCK ERP SURFACE ADAPTER
// ============================================================================

/**
 * Mock implementation of ERPSurfaceAdapter.
 */
class MockERPSurfaceAdapter implements ERPSurfaceAdapter {
  private readonly entities: Map<string, NormalizedEntity> = new Map();
  private readonly schemas: Map<string, EntitySchema> = new Map();
  private readonly config: MockERPSurfaceConfig;
  private readonly accessLog: MockAccessLogEntry[];

  constructor(config: MockERPSurfaceConfig, accessLog: MockAccessLogEntry[]) {
    this.config = config;
    this.accessLog = accessLog;

    // Initialize with pre-loaded entities
    if (config.entities) {
      for (const entity of config.entities) {
        const key = `${entity.entityType}:${entity.entityId}`;
        this.entities.set(key, entity);
      }
    }

    // Initialize with schemas
    if (config.schemas) {
      for (const schema of config.schemas) {
        this.schemas.set(schema.entityType, schema);
      }
    }
  }

  async fetchEntities(query: EntityQuery): Promise<NormalizedEntitySet> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    // Filter entities by query
    const matchingEntities = Array.from(this.entities.values()).filter((entity) => {
      if (!query.entityTypes.includes(entity.entityType)) {
        return false;
      }
      return this.matchesFilters(entity, query.filters);
    });

    // Apply pagination
    const offset = query.pagination?.offset ?? 0;
    const limit = query.pagination?.limit ?? matchingEntities.length;
    const paginatedEntities = matchingEntities.slice(offset, offset + limit);

    const result: NormalizedEntitySet = {
      entities: paginatedEntities,
      totalCount: matchingEntities.length,
      query,
      fetchedAt: new Date().toISOString() as ISOTimestamp,
      contentHash: createContentHash(canonicalSerialize(paginatedEntities)),
    };

    this.logAccess('fetchEntities', { query }, result.contentHash, Date.now() - start);
    return result;
  }

  async fetchEntity(reference: EntityReference): Promise<NormalizedEntity | null> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const key = `${reference.entityType}:${reference.entityId}`;
    const entity = this.entities.get(key) ?? null;

    this.logAccess(
      'fetchEntity',
      { reference },
      entity ? createContentHash(canonicalSerialize(entity)) : undefined,
      Date.now() - start
    );
    return entity;
  }

  async getSchema(entityType: string): Promise<EntitySchema> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const schema = this.schemas.get(entityType);
    if (!schema) {
      throw new Error(`Schema not found for entity type: ${entityType}`);
    }

    this.logAccess('getSchema', { entityType }, undefined, Date.now() - start);
    return schema;
  }

  async getAvailableEntityTypes(): Promise<ReadonlyArray<string>> {
    const start = Date.now();
    await this.simulateLatency();

    const types = new Set<string>();
    for (const entity of this.entities.values()) {
      types.add(entity.entityType);
    }

    this.logAccess('getAvailableEntityTypes', {}, undefined, Date.now() - start);
    return Array.from(types);
  }

  async checkHealth(): Promise<ERPSurfaceHealth> {
    const start = Date.now();
    await this.simulateLatency();

    return {
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
      lastSuccessfulFetch: new Date().toISOString() as ISOTimestamp,
      availableEntityTypes: await this.getAvailableEntityTypes(),
    };
  }

  async createDataSnapshot(query: EntityQuery): Promise<ContentHash> {
    const start = Date.now();
    const entitySet = await this.fetchEntities(query);
    this.logAccess('createDataSnapshot', { query }, entitySet.contentHash, Date.now() - start);
    return entitySet.contentHash;
  }

  async validateSnapshot(snapshotHash: ContentHash, query: EntityQuery): Promise<boolean> {
    const start = Date.now();
    const currentSet = await this.fetchEntities(query);
    const isValid = currentSet.contentHash.value === snapshotHash.value;
    this.logAccess('validateSnapshot', { snapshotHash, query }, undefined, Date.now() - start);
    return isValid;
  }

  /**
   * Adds an entity to the mock store.
   */
  addEntity(entity: NormalizedEntity): void {
    const key = `${entity.entityType}:${entity.entityId}`;
    this.entities.set(key, entity);
  }

  /**
   * Adds a schema to the mock store.
   */
  addSchema(schema: EntitySchema): void {
    this.schemas.set(schema.entityType, schema);
  }

  private matchesFilters(
    entity: NormalizedEntity,
    filters?: ReadonlyArray<{ field: string; operator: string; value?: unknown }>
  ): boolean {
    if (!filters || filters.length === 0) {
      return true;
    }

    for (const filter of filters) {
      const fieldValue = entity.attributes[filter.field];

      switch (filter.operator) {
        case 'equals':
          if (fieldValue !== filter.value) return false;
          break;
        case 'not_equals':
          if (fieldValue === filter.value) return false;
          break;
        case 'contains':
          if (typeof fieldValue !== 'string' || !fieldValue.includes(String(filter.value)))
            return false;
          break;
        case 'is_null':
          if (fieldValue != null) return false;
          break;
        case 'is_not_null':
          if (fieldValue == null) return false;
          break;
        // Add more operators as needed
      }
    }

    return true;
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (this.config.simulateFailures && Math.random() < (this.config.failureRate ?? 0.1)) {
      throw new Error('Simulated ERP Surface failure');
    }
  }

  private logAccess(
    operation: string,
    parameters: Record<string, unknown>,
    resultHash: ContentHash | undefined,
    durationMs: number
  ): void {
    this.accessLog.push({
      timestamp: new Date().toISOString() as ISOTimestamp,
      service: 'erp-surface',
      operation,
      parameters,
      resultHash,
      durationMs,
    });
  }
}

// ============================================================================
// MOCK POLICY SYSTEM ADAPTER
// ============================================================================

/**
 * Mock implementation of PolicySystemAdapter.
 */
class MockPolicySystemAdapter implements PolicySystemAdapter {
  private readonly policies: Map<string, Policy> = new Map();
  private readonly config: MockPolicySystemConfig;
  private readonly accessLog: MockAccessLogEntry[];
  private readonly changeListeners: Set<(change: PolicyChangeEvent) => void> = new Set();

  constructor(config: MockPolicySystemConfig, accessLog: MockAccessLogEntry[]) {
    this.config = config;
    this.accessLog = accessLog;

    // Initialize with pre-loaded policies
    if (config.policies) {
      for (const policy of config.policies) {
        this.policies.set(policy.policyId, policy);
      }
    }
  }

  async loadPolicies(source: PolicySource): Promise<PolicyLoadResult> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    let loadedPolicies: Policy[] = [];

    if (source.type === 'inline') {
      loadedPolicies = [...source.policies];
      for (const policy of loadedPolicies) {
        this.policies.set(policy.policyId, policy);
      }
    }

    const result: PolicyLoadResult = {
      policies: loadedPolicies,
      source,
      loadedAt: new Date().toISOString() as ISOTimestamp,
      contentHash: createContentHash(canonicalSerialize(loadedPolicies)),
      errors: [],
      warnings: [],
    };

    this.logAccess('loadPolicies', { source }, result.contentHash, Date.now() - start);
    return result;
  }

  async fetchPolicies(query: PolicyQuery): Promise<PolicySet> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const matchingPolicies = Array.from(this.policies.values()).filter((policy) => {
      if (query.policyIds && !query.policyIds.includes(policy.policyId)) {
        return false;
      }
      if (query.resourceTypes) {
        const policyResources = policy.applicability.resourceTypes ?? [];
        if (!query.resourceTypes.some((r) => policyResources.includes(r))) {
          return false;
        }
      }
      return true;
    });

    const result: PolicySet = {
      policies: matchingPolicies,
      version: '1.0.0',
      effectiveDate: new Date().toISOString() as ISOTimestamp,
      source: 'mock',
    };

    this.logAccess('fetchPolicies', { query }, createContentHash(canonicalSerialize(result)), Date.now() - start);
    return result;
  }

  async fetchPolicy(policyId: PolicyId, _version?: string): Promise<Policy | null> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const policy = this.policies.get(policyId) ?? null;

    this.logAccess(
      'fetchPolicy',
      { policyId },
      policy ? createContentHash(canonicalSerialize(policy)) : undefined,
      Date.now() - start
    );
    return policy;
  }

  async validatePolicy(policy: Policy): Promise<{ valid: boolean; errors: never[]; warnings: never[] }> {
    const start = Date.now();
    await this.simulateLatency();

    // Basic validation
    const result = {
      valid: true,
      errors: [] as never[],
      warnings: [] as never[],
    };

    this.logAccess('validatePolicy', { policyId: policy.policyId }, undefined, Date.now() - start);
    return result;
  }

  async getAvailablePolicyIds(): Promise<ReadonlyArray<PolicyId>> {
    const start = Date.now();
    await this.simulateLatency();

    const ids = Array.from(this.policies.keys()) as PolicyId[];

    this.logAccess('getAvailablePolicyIds', {}, undefined, Date.now() - start);
    return ids;
  }

  async checkHealth(): Promise<PolicySystemHealth> {
    await this.simulateLatency();

    return {
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
      availablePolicies: this.policies.size,
      lastSyncAt: new Date().toISOString() as ISOTimestamp,
    };
  }

  async createPolicySnapshot(): Promise<ContentHash> {
    const start = Date.now();
    const policies = Array.from(this.policies.values());
    const hash = createContentHash(canonicalSerialize(policies));

    this.logAccess('createPolicySnapshot', {}, hash, Date.now() - start);
    return hash;
  }

  onPolicyChange(callback: (change: PolicyChangeEvent) => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  /**
   * Adds a policy to the mock store.
   */
  addPolicy(policy: Policy): void {
    const isUpdate = this.policies.has(policy.policyId);
    this.policies.set(policy.policyId, policy);

    // Notify listeners
    const event: PolicyChangeEvent = {
      type: isUpdate ? 'updated' : 'added',
      policyId: policy.policyId,
      timestamp: new Date().toISOString() as ISOTimestamp,
    };
    for (const listener of this.changeListeners) {
      listener(event);
    }
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (this.config.simulateFailures && Math.random() < (this.config.failureRate ?? 0.1)) {
      throw new Error('Simulated Policy System failure');
    }
  }

  private logAccess(
    operation: string,
    parameters: Record<string, unknown>,
    resultHash: ContentHash | undefined,
    durationMs: number
  ): void {
    this.accessLog.push({
      timestamp: new Date().toISOString() as ISOTimestamp,
      service: 'policy-system',
      operation,
      parameters,
      resultHash,
      durationMs,
    });
  }
}

// ============================================================================
// MOCK COSTOPS ADAPTER
// ============================================================================

/**
 * Mock implementation of CostOpsAdapter.
 */
class MockCostOpsAdapter implements CostOpsAdapter {
  private readonly baselines: Map<string, CostBaseline> = new Map();
  private readonly config: MockCostOpsConfig;
  private readonly accessLog: MockAccessLogEntry[];

  constructor(config: MockCostOpsConfig, accessLog: MockAccessLogEntry[]) {
    this.config = config;
    this.accessLog = accessLog;

    // Initialize with pre-loaded baselines
    if (config.baselines) {
      for (const baseline of config.baselines) {
        const key = `${baseline.entityReference.entityType}:${baseline.entityReference.entityId}`;
        this.baselines.set(key, baseline);
      }
    }
  }

  async fetchBaselines(query: CostBaselineQuery): Promise<CostBaselineSet> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const matchingBaselines: CostBaseline[] = [];

    for (const ref of query.entityReferences) {
      const key = `${ref.entityType}:${ref.entityId}`;
      const baseline = this.baselines.get(key);
      if (baseline) {
        matchingBaselines.push(baseline);
      }
    }

    const result: CostBaselineSet = {
      baselines: matchingBaselines,
      fetchedAt: new Date().toISOString() as ISOTimestamp,
      contentHash: createContentHash(canonicalSerialize(matchingBaselines)),
    };

    this.logAccess('fetchBaselines', { query }, result.contentHash, Date.now() - start);
    return result;
  }

  async fetchBaseline(
    entityReference: EntityReference,
    _dateRange?: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<CostBaseline | null> {
    const start = Date.now();
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const key = `${entityReference.entityType}:${entityReference.entityId}`;
    const baseline = this.baselines.get(key) ?? null;

    this.logAccess(
      'fetchBaseline',
      { entityReference },
      baseline ? createContentHash(canonicalSerialize(baseline)) : undefined,
      Date.now() - start
    );
    return baseline;
  }

  async getAvailableCategories(): Promise<ReadonlyArray<CostCategory>> {
    const start = Date.now();
    await this.simulateLatency();

    const categories = this.config.categories ?? [
      'labor',
      'materials',
      'overhead',
      'infrastructure',
      'licensing',
      'maintenance',
      'operations',
      'other',
    ];

    this.logAccess('getAvailableCategories', {}, undefined, Date.now() - start);
    return categories;
  }

  async getSupportedCurrencies(): Promise<ReadonlyArray<CurrencyCode>> {
    const start = Date.now();
    await this.simulateLatency();

    const currencies = this.config.currencies ?? ['USD', 'EUR', 'GBP'];

    this.logAccess('getSupportedCurrencies', {}, undefined, Date.now() - start);
    return currencies;
  }

  async checkHealth(): Promise<CostOpsHealth> {
    await this.simulateLatency();

    return {
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
      lastSuccessfulFetch: new Date().toISOString() as ISOTimestamp,
      availableCategories: await this.getAvailableCategories(),
      supportedCurrencies: await this.getSupportedCurrencies(),
    };
  }

  async createCostSnapshot(query: CostBaselineQuery): Promise<ContentHash> {
    const start = Date.now();
    const baselineSet = await this.fetchBaselines(query);

    this.logAccess('createCostSnapshot', { query }, baselineSet.contentHash, Date.now() - start);
    return baselineSet.contentHash;
  }

  /**
   * Adds a baseline to the mock store.
   */
  addBaseline(baseline: CostBaseline): void {
    const key = `${baseline.entityReference.entityType}:${baseline.entityReference.entityId}`;
    this.baselines.set(key, baseline);
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (this.config.simulateFailures && Math.random() < (this.config.failureRate ?? 0.1)) {
      throw new Error('Simulated CostOps failure');
    }
  }

  private logAccess(
    operation: string,
    parameters: Record<string, unknown>,
    resultHash: ContentHash | undefined,
    durationMs: number
  ): void {
    this.accessLog.push({
      timestamp: new Date().toISOString() as ISOTimestamp,
      service: 'costops',
      operation,
      parameters,
      resultHash,
      durationMs,
    });
  }
}
