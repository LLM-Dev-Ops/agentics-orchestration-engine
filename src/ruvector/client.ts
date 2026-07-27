/**
 * Ruvector Client.
 *
 * Client for requesting execution acceptance from Ruvector and emitting
 * execution lifecycle events.
 *
 * This client does NOT subscribe to decision events. Per ADR-0001 this service
 * is a synchronous delegation service: agentics-execution-engine is the sole
 * subscriber and ruvector-service the sole publisher.
 *
 * @module ruvector/client
 */

import type { ISOTimestamp } from '../types/common.js';
import type {
  ExecutionLifecycleEvent,
  ExecutionAcceptanceRequest,
  ExecutionAcceptanceResponse,
  RuvectorClientConfig,
  RuvectorConnectionStatus,
} from './types.js';

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
 * - Requesting execution acceptance
 * - Emitting execution lifecycle events
 * - Connection health monitoring
 */
export class RuvectorClient {
  private readonly config: RuvectorClientConfig;
  private readonly secretManager: SecretManager;
  private readonly statusListeners: Set<ConnectionStatusListener> = new Set();

  private credentials?: string;
  private isConnected: boolean = false;

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

    console.log('[RuvectorClient] Connected successfully');
  }

  /**
   * Disconnects from Ruvector.
   */
  async disconnect(): Promise<void> {
    console.log('[RuvectorClient] Disconnecting...');

    this.isConnected = false;
    this.credentials = undefined;
    this.updateStatus({ connected: false });

    console.log('[RuvectorClient] Disconnected');
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
