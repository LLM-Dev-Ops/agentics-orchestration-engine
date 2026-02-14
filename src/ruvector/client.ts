/**
 * Ruvector Client.
 *
 * Client for connecting to Ruvector, subscribing to decision events,
 * and emitting execution lifecycle events.
 *
 * @module ruvector/client
 */

import type { ISOTimestamp } from '../types/common.js';
import type {
  DecisionEvent,
  ExecutionLifecycleEvent,
  ExecutionAcceptanceRequest,
  ExecutionAcceptanceResponse,
  RuvectorClientConfig,
  RuvectorConnectionStatus,
  RuvectorEventId,
} from './types.js';
import { createRuvectorEventId } from './types.js';

// ============================================================================
// SECRET MANAGER INTERFACE
// ============================================================================

/**
 * Interface for retrieving secrets from Google Secret Manager.
 */
export interface SecretManager {
  /**
   * Retrieves a secret value.
   */
  getSecret(secretRef: string): Promise<string>;
}

/**
 * Default implementation that reads from environment variables.
 * In production, this would use Google Secret Manager.
 */
export class EnvironmentSecretManager implements SecretManager {
  async getSecret(secretRef: string): Promise<string> {
    // Extract secret name from reference
    // Format: projects/{project}/secrets/{secret}/versions/{version}
    const parts = secretRef.split('/');
    const secretName = parts[parts.length - 3] ?? secretRef;

    // Convert to environment variable name (e.g., RUVECTOR_API_KEY)
    const envName = secretName.toUpperCase().replace(/-/g, '_');
    const value = process.env[envName];

    if (!value) {
      throw new RuvectorClientError(
        `Secret not found: ${secretRef}`,
        'SECRET_NOT_FOUND',
        `Environment variable ${envName} is not set`
      );
    }

    return value;
  }
}

// ============================================================================
// RUVECTOR CLIENT ERROR
// ============================================================================

/**
 * Error thrown by the Ruvector client.
 */
export class RuvectorClientError extends Error {
  readonly code: string;
  readonly details: string;

  constructor(message: string, code: string, details: string) {
    super(message);
    this.name = 'RuvectorClientError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// EVENT LISTENER TYPES
// ============================================================================

/**
 * Listener for decision events.
 */
export type DecisionEventListener = (event: DecisionEvent) => void | Promise<void>;

/**
 * Listener for connection status changes.
 */
export type ConnectionStatusListener = (status: RuvectorConnectionStatus) => void;

// ============================================================================
// RUVECTOR CLIENT
// ============================================================================

/**
 * Client for interacting with Ruvector.
 *
 * Handles:
 * - Connection management with authentication
 * - Subscribing to decision events (polling or streaming)
 * - Emitting execution lifecycle events
 * - Connection health monitoring
 */
export class RuvectorClient {
  private readonly config: RuvectorClientConfig;
  private readonly secretManager: SecretManager;
  private readonly eventListeners: Set<DecisionEventListener> = new Set();
  private readonly statusListeners: Set<ConnectionStatusListener> = new Set();

  private credentials?: string;
  private pollIntervalHandle?: ReturnType<typeof setInterval>;
  private isConnected: boolean = false;
  private lastEventId?: RuvectorEventId;

  private status: RuvectorConnectionStatus = {
    connected: false,
    eventsReceived: 0,
    eventsProcessed: 0,
    errors: 0,
  };

  constructor(config: RuvectorClientConfig, secretManager?: SecretManager) {
    this.config = config;
    this.secretManager = secretManager ?? new EnvironmentSecretManager();
  }

  /**
   * Connects to Ruvector.
   *
   * @throws RuvectorClientError if connection fails
   */
  async connect(): Promise<void> {
    console.log(`[RuvectorClient] Connecting to ${this.config.endpoint}...`);

    // Load credentials from secret manager
    try {
      this.credentials = await this.secretManager.getSecret(this.config.credentialsRef);
    } catch (error) {
      throw new RuvectorClientError(
        'Failed to load Ruvector credentials',
        'CREDENTIALS_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    }

    // Validate connection
    try {
      await this.validateConnection();
    } catch (error) {
      throw new RuvectorClientError(
        'Failed to connect to Ruvector',
        'CONNECTION_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    }

    this.isConnected = true;
    this.updateStatus({
      connected: true,
      lastConnectedAt: new Date().toISOString() as ISOTimestamp,
    });

    // Start subscription based on mode
    if (this.config.mode === 'polling') {
      this.startPolling();
    } else {
      await this.startStreaming();
    }

    console.log('[RuvectorClient] Connected successfully');
  }

  /**
   * Disconnects from Ruvector.
   */
  async disconnect(): Promise<void> {
    console.log('[RuvectorClient] Disconnecting...');

    if (this.pollIntervalHandle) {
      clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = undefined;
    }

    this.isConnected = false;
    this.credentials = undefined;
    this.updateStatus({ connected: false });

    console.log('[RuvectorClient] Disconnected');
  }

  /**
   * Subscribes to decision events.
   *
   * @param listener - Event listener function
   * @returns Unsubscribe function
   */
  onDecisionEvent(listener: DecisionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Subscribes to connection status changes.
   *
   * @param listener - Status listener function
   * @returns Unsubscribe function
   */
  onConnectionStatus(listener: ConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately notify of current status
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Emits an execution lifecycle event to Ruvector.
   *
   * @param event - Lifecycle event to emit
   */
  async emitLifecycleEvent(event: ExecutionLifecycleEvent): Promise<void> {
    if (!this.isConnected) {
      throw new RuvectorClientError(
        'Cannot emit event: not connected',
        'NOT_CONNECTED',
        'Call connect() before emitting events'
      );
    }

    console.log(`[RuvectorClient] Emitting lifecycle event: ${event.type}`, {
      plan_id: event.plan_id,
      simulation_id: event.simulation_id,
    });

    try {
      await this.postEvent(event);
    } catch (error) {
      this.updateStatus({ errors: this.status.errors + 1 });
      throw new RuvectorClientError(
        'Failed to emit lifecycle event',
        'EMIT_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Requests execution acceptance from ruvector-service.
   *
   * BLOCKING: This call blocks until ruvector responds with acceptance or rejection.
   * The ruvector-minted execution_id becomes the canonical ID for the entire execution.
   *
   * @param request - Execution acceptance request
   * @returns Acceptance response with ruvector-minted execution_id
   * @throws RuvectorClientError if not connected, request fails, or times out
   */
  async requestExecutionAcceptance(
    request: ExecutionAcceptanceRequest
  ): Promise<ExecutionAcceptanceResponse> {
    if (!this.isConnected) {
      throw new RuvectorClientError(
        'Cannot request execution acceptance: not connected',
        'NOT_CONNECTED',
        'Call connect() before requesting execution acceptance'
      );
    }

    console.log('[RuvectorClient] Requesting execution acceptance', {
      simulation_id: request.simulation_id,
      source: request.source,
    });

    const timeout = this.config.connectionTimeoutMs ?? 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(
        `${this.config.endpoint}/v1/accept`,
        {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new RuvectorClientError(
          `Execution acceptance request failed: ${response.status} ${response.statusText}`,
          'ACCEPTANCE_REQUEST_FAILED',
          `HTTP ${response.status}`
        );
      }

      const data = (await response.json()) as ExecutionAcceptanceResponse;
      return data;
    } catch (error) {
      if (error instanceof RuvectorClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RuvectorClientError(
          'Execution acceptance request timed out',
          'ACCEPTANCE_TIMEOUT',
          `Timed out after ${timeout}ms waiting for ruvector acceptance`
        );
      }
      this.updateStatus({ errors: this.status.errors + 1 });
      throw new RuvectorClientError(
        'Failed to request execution acceptance',
        'ACCEPTANCE_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Gets the current connection status.
   */
  getStatus(): RuvectorConnectionStatus {
    return { ...this.status };
  }

  /**
   * Checks if the client is connected.
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Validates the connection to Ruvector.
   */
  private async validateConnection(): Promise<void> {
    const timeout = this.config.connectionTimeoutMs ?? 10000;

    // Make a health check request to Ruvector
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Starts polling for events.
   */
  private startPolling(): void {
    const intervalMs = this.config.pollIntervalMs ?? 5000;

    console.log(`[RuvectorClient] Starting polling (interval: ${intervalMs}ms)`);

    // Initial poll
    this.pollForEvents();

    // Schedule recurring polls
    this.pollIntervalHandle = setInterval(() => {
      this.pollForEvents();
    }, intervalMs);
  }

  /**
   * Polls for new events from Ruvector.
   */
  private async pollForEvents(): Promise<void> {
    if (!this.isConnected) return;

    try {
      const events = await this.fetchEvents();

      for (const event of events) {
        await this.handleEvent(event);
      }
    } catch (error) {
      console.error('[RuvectorClient] Error polling for events:', error);
      this.updateStatus({ errors: this.status.errors + 1 });
    }
  }

  /**
   * Fetches events from Ruvector.
   */
  private async fetchEvents(): Promise<DecisionEvent[]> {
    const url = new URL(`${this.config.endpoint}/events/decisions`);

    // Add cursor for pagination
    if (this.lastEventId) {
      url.searchParams.set('after', this.lastEventId);
    }

    // Filter for plan_approved events
    url.searchParams.set('types', 'plan_approved');
    url.searchParams.set('client_id', this.config.clientId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { events: DecisionEvent[] };
    return data.events ?? [];
  }

  /**
   * Starts streaming events (SSE or WebSocket).
   */
  private async startStreaming(): Promise<void> {
    console.log('[RuvectorClient] Starting event stream');

    // Note: Full streaming implementation would use EventSource or WebSocket
    // For now, fall back to polling with shorter interval
    this.config.pollIntervalMs ?? 1000;
    this.startPolling();
  }

  /**
   * Normalizes a raw API event into a proper DecisionEvent.
   *
   * The Ruvector API may return events with identifiers nested inside
   * a `payload` sub-object. This method extracts them to top-level
   * fields and generates `event_id` if missing.
   */
  private normalizeRawEvent(raw: Record<string, unknown>): DecisionEvent {
    console.log('[RuvectorClient] Raw event before parsing:', JSON.stringify(raw));

    // Unwrap envelope: ruvector may nest the real event under payload, data, or send flat
    const event = (raw['payload'] ?? raw['data'] ?? raw) as Record<string, unknown>;

    const event_id = (event['event_id'] ?? raw['event_id'] ?? createRuvectorEventId(`evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`)) as RuvectorEventId;
    const plan_id = event['plan_id'] ?? raw['plan_id'];
    const simulation_id = event['simulation_id'] ?? raw['simulation_id'];
    const type = (event['type'] ?? raw['type']) as string;
    const timestamp = (event['timestamp'] ?? raw['timestamp'] ?? new Date().toISOString()) as ISOTimestamp;
    const source = event['source'] ?? raw['source'];
    const correlation_id = event['correlation_id'] ?? raw['correlation_id'];
    const execution_profile = event['execution_profile'] ?? raw['execution_profile'];
    const advisory = event['advisory'] ?? raw['advisory'];

    return {
      event_id,
      type,
      plan_id,
      simulation_id,
      timestamp,
      ...(source !== undefined && { source }),
      ...(correlation_id !== undefined && { correlation_id }),
      ...(execution_profile !== undefined && { execution_profile }),
      ...(advisory !== undefined && { advisory }),
    } as DecisionEvent;
  }

  /**
   * Handles an incoming decision event.
   */
  private async handleEvent(rawEvent: DecisionEvent): Promise<void> {
    // Normalize: extract identifiers from payload if nested, generate event_id if missing
    const event = this.normalizeRawEvent(rawEvent as unknown as Record<string, unknown>);

    this.lastEventId = event.event_id;
    this.updateStatus({
      eventsReceived: this.status.eventsReceived + 1,
      lastEventAt: new Date().toISOString() as ISOTimestamp,
    });

    console.log(`[RuvectorClient] Received event: ${event.type}`, {
      event_id: event.event_id,
      plan_id: event.plan_id,
      simulation_id: event.simulation_id,
    });

    // Guard: reject events with missing identifiers before dispatching
    if (!event.plan_id || !event.simulation_id) {
      console.error('[RuvectorAcceptance] invalid event envelope', rawEvent);
      this.updateStatus({ errors: this.status.errors + 1 });
      return;
    }

    // Notify all listeners
    for (const listener of this.eventListeners) {
      try {
        await listener(event);
      } catch (error) {
        console.error('[RuvectorClient] Error in event listener:', error);
      }
    }

    this.updateStatus({
      eventsProcessed: this.status.eventsProcessed + 1,
    });
  }

  /**
   * Posts an event to Ruvector.
   */
  private async postEvent(event: ExecutionLifecycleEvent): Promise<void> {
    const response = await fetch(`${this.config.endpoint}/events/lifecycle`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`Failed to post event: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Gets authentication headers.
   */
  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credentials}`,
      'X-Client-Id': this.config.clientId,
    };
  }

  /**
   * Updates the connection status and notifies listeners.
   */
  private updateStatus(update: Partial<RuvectorConnectionStatus>): void {
    this.status = { ...this.status, ...update };

    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch (error) {
        console.error('[RuvectorClient] Error in status listener:', error);
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a Ruvector client with the given configuration.
 */
export function createRuvectorClient(
  config: RuvectorClientConfig,
  secretManager?: SecretManager
): RuvectorClient {
  return new RuvectorClient(config, secretManager);
}

/**
 * Creates a Ruvector client configuration from environment variables.
 */
export function createConfigFromEnvironment(): RuvectorClientConfig {
  const endpoint = process.env['RUVECTOR_ENDPOINT'];
  if (!endpoint) {
    throw new RuvectorClientError(
      'RUVECTOR_ENDPOINT environment variable is required',
      'CONFIG_ERROR',
      'Set RUVECTOR_ENDPOINT to the Ruvector API endpoint'
    );
  }

  return {
    endpoint,
    credentialsRef: process.env['RUVECTOR_CREDENTIALS_REF'] ?? 'ruvector-api-key',
    clientId: process.env['RUVECTOR_CLIENT_ID'] ?? `simulation-engine-${Date.now()}`,
    mode: (process.env['RUVECTOR_MODE'] as 'polling' | 'streaming') ?? 'polling',
    pollIntervalMs: parseInt(process.env['RUVECTOR_POLL_INTERVAL_MS'] ?? '5000', 10),
    connectionTimeoutMs: parseInt(process.env['RUVECTOR_CONNECTION_TIMEOUT_MS'] ?? '10000', 10),
    retry: {
      maxAttempts: parseInt(process.env['RUVECTOR_RETRY_MAX_ATTEMPTS'] ?? '3', 10),
      backoffMs: parseInt(process.env['RUVECTOR_RETRY_BACKOFF_MS'] ?? '1000', 10),
      maxBackoffMs: parseInt(process.env['RUVECTOR_RETRY_MAX_BACKOFF_MS'] ?? '30000', 10),
    },
  };
}
