/**
 * Isolation Boundary Configuration.
 *
 * Defines the boundaries that separate simulated execution from
 * production systems. All external communication must be validated
 * against these boundaries.
 *
 * @module core/isolation/boundary
 */

import type { ISOTimestamp } from '../../types/common.js';

// ============================================================================
// BOUNDARY TYPES
// ============================================================================

/**
 * A network endpoint that is explicitly allowed or blocked.
 */
export interface NetworkEndpoint {
  /** Protocol (http, https, etc.) */
  readonly protocol: string;
  /** Hostname or IP address */
  readonly host: string;
  /** Port number (null = any) */
  readonly port: number | null;
  /** Path prefix (null = any) */
  readonly pathPrefix: string | null;
}

/**
 * A credential pattern that is blocked in simulation.
 */
export interface CredentialPattern {
  /** Type of credential */
  readonly type: 'api_key' | 'bearer_token' | 'basic_auth' | 'certificate' | 'oauth' | 'custom';
  /** Pattern to match (regex or literal) */
  readonly pattern: string;
  /** Whether pattern is a regex */
  readonly isRegex: boolean;
  /** Description of what this pattern matches */
  readonly description: string;
}

/**
 * A file system path that is allowed or blocked.
 */
export interface FileSystemPath {
  /** Path pattern (glob or literal) */
  readonly path: string;
  /** Whether path is a glob pattern */
  readonly isGlob: boolean;
  /** Allowed operations */
  readonly operations: ReadonlyArray<'read' | 'write' | 'delete' | 'create'>;
}

/**
 * An environment variable pattern.
 */
export interface EnvironmentPattern {
  /** Variable name pattern (regex or literal) */
  readonly namePattern: string;
  /** Whether pattern is a regex */
  readonly isRegex: boolean;
  /** What to do: 'block', 'mask', or 'allow' */
  readonly action: 'block' | 'mask' | 'allow';
}

// ============================================================================
// ISOLATION BOUNDARY CONFIGURATION
// ============================================================================

/**
 * Complete isolation boundary configuration.
 *
 * This configuration defines what external resources the simulation
 * is allowed to access. Any access outside these boundaries triggers
 * an isolation breach.
 */
export interface IsolationBoundary {
  /** Unique identifier for this boundary configuration */
  readonly boundaryId: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of the boundary */
  readonly description: string;
  /** When this configuration was created */
  readonly createdAt: ISOTimestamp;
  /** Version of this configuration */
  readonly version: string;

  // Network isolation
  /** Explicitly allowed network endpoints */
  readonly allowedEndpoints: ReadonlyArray<NetworkEndpoint>;
  /** Explicitly blocked network endpoints (checked first) */
  readonly blockedEndpoints: ReadonlyArray<NetworkEndpoint>;
  /** Default network policy */
  readonly defaultNetworkPolicy: 'allow' | 'deny';

  // Credential isolation
  /** Patterns for production credentials that must be blocked */
  readonly blockedCredentials: ReadonlyArray<CredentialPattern>;

  // File system isolation
  /** Allowed file system paths */
  readonly allowedPaths: ReadonlyArray<FileSystemPath>;
  /** Blocked file system paths (checked first) */
  readonly blockedPaths: ReadonlyArray<FileSystemPath>;
  /** Default file system policy */
  readonly defaultFileSystemPolicy: 'allow' | 'deny';

  // Environment variable isolation
  /** Environment variable handling rules */
  readonly environmentPatterns: ReadonlyArray<EnvironmentPattern>;

  // Additional settings
  /** Whether to allow any outbound network calls */
  readonly allowOutboundNetwork: boolean;
  /** Whether to log all boundary checks */
  readonly logAllChecks: boolean;
  /** Whether to fail fast on any violation */
  readonly failFast: boolean;
}

// ============================================================================
// DEFAULT BOUNDARY CONFIGURATIONS
// ============================================================================

/**
 * Default blocked production credential patterns.
 * These are common patterns that indicate production credentials.
 */
export const DEFAULT_BLOCKED_CREDENTIALS: ReadonlyArray<CredentialPattern> = [
  {
    type: 'api_key',
    pattern: 'prod[_-]?api[_-]?key',
    isRegex: true,
    description: 'Production API keys',
  },
  {
    type: 'api_key',
    pattern: 'live[_-]?api[_-]?key',
    isRegex: true,
    description: 'Live API keys',
  },
  {
    type: 'bearer_token',
    pattern: 'prod[_-]?token',
    isRegex: true,
    description: 'Production bearer tokens',
  },
  {
    type: 'basic_auth',
    pattern: 'prod[_-]?password',
    isRegex: true,
    description: 'Production passwords',
  },
  {
    type: 'certificate',
    pattern: '\\.prod\\.pem$',
    isRegex: true,
    description: 'Production certificates',
  },
  {
    type: 'oauth',
    pattern: 'prod[_-]?client[_-]?secret',
    isRegex: true,
    description: 'Production OAuth secrets',
  },
];

/**
 * Default blocked production endpoints.
 * These are patterns that typically indicate production systems.
 */
export const DEFAULT_BLOCKED_ENDPOINTS: ReadonlyArray<NetworkEndpoint> = [
  {
    protocol: 'https',
    host: '*.prod.*',
    port: null,
    pathPrefix: null,
  },
  {
    protocol: 'https',
    host: '*.production.*',
    port: null,
    pathPrefix: null,
  },
  {
    protocol: 'https',
    host: 'api.*.com',
    port: null,
    pathPrefix: '/v*/production',
  },
];

/**
 * Default blocked environment variable patterns.
 */
export const DEFAULT_BLOCKED_ENVIRONMENT: ReadonlyArray<EnvironmentPattern> = [
  {
    namePattern: '^PROD_',
    isRegex: true,
    action: 'block',
  },
  {
    namePattern: '^PRODUCTION_',
    isRegex: true,
    action: 'block',
  },
  {
    namePattern: '_PROD$',
    isRegex: true,
    action: 'block',
  },
  {
    namePattern: '^AWS_.*_KEY',
    isRegex: true,
    action: 'mask',
  },
  {
    namePattern: '^DATABASE_.*_PASSWORD',
    isRegex: true,
    action: 'mask',
  },
];

/**
 * Creates a strict isolation boundary for production-safe simulation.
 * This is the recommended configuration for enterprise use.
 */
export function createStrictIsolationBoundary(
  boundaryId: string,
  name?: string
): IsolationBoundary {
  return {
    boundaryId,
    name: name ?? 'Strict Production Isolation',
    description: 'Strict isolation boundary that blocks all production access',
    createdAt: new Date().toISOString() as ISOTimestamp,
    version: '1.0.0',

    // Network: deny by default, explicit allowlist only
    allowedEndpoints: [],
    blockedEndpoints: DEFAULT_BLOCKED_ENDPOINTS,
    defaultNetworkPolicy: 'deny',

    // Block all known production credential patterns
    blockedCredentials: DEFAULT_BLOCKED_CREDENTIALS,

    // File system: deny by default
    allowedPaths: [
      {
        path: '/tmp/simulation-*',
        isGlob: true,
        operations: ['read', 'write', 'create', 'delete'],
      },
    ],
    blockedPaths: [
      {
        path: '/etc/*',
        isGlob: true,
        operations: ['write', 'delete'],
      },
      {
        path: '~/.ssh/*',
        isGlob: true,
        operations: ['read', 'write', 'delete'],
      },
    ],
    defaultFileSystemPolicy: 'deny',

    // Block production environment variables
    environmentPatterns: DEFAULT_BLOCKED_ENVIRONMENT,

    // Additional strict settings
    allowOutboundNetwork: false,
    logAllChecks: true,
    failFast: true,
  };
}

/**
 * Creates a permissive isolation boundary for development/testing.
 * WARNING: Not recommended for production use.
 */
export function createDevelopmentIsolationBoundary(
  boundaryId: string,
  name?: string
): IsolationBoundary {
  return {
    boundaryId,
    name: name ?? 'Development Isolation',
    description: 'Permissive isolation boundary for development - NOT for production',
    createdAt: new Date().toISOString() as ISOTimestamp,
    version: '1.0.0',

    // Network: allow by default, block known production
    allowedEndpoints: [],
    blockedEndpoints: DEFAULT_BLOCKED_ENDPOINTS,
    defaultNetworkPolicy: 'allow',

    // Still block production credentials
    blockedCredentials: DEFAULT_BLOCKED_CREDENTIALS,

    // File system: allow by default
    allowedPaths: [],
    blockedPaths: [
      {
        path: '~/.ssh/*',
        isGlob: true,
        operations: ['read', 'write', 'delete'],
      },
    ],
    defaultFileSystemPolicy: 'allow',

    // Mask sensitive environment variables
    environmentPatterns: [
      ...DEFAULT_BLOCKED_ENVIRONMENT.map((p) => ({
        ...p,
        action: 'mask' as const,
      })),
    ],

    // Development settings
    allowOutboundNetwork: true,
    logAllChecks: false,
    failFast: false,
  };
}

// ============================================================================
// BOUNDARY VALIDATION
// ============================================================================

/**
 * Result of validating an isolation boundary configuration.
 */
export interface BoundaryValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  }>;
}

/**
 * Validates an isolation boundary configuration.
 */
export function validateIsolationBoundary(boundary: IsolationBoundary): BoundaryValidationResult {
  const errors: { code: string; message: string; field?: string }[] = [];
  const warnings: { code: string; message: string; field?: string }[] = [];

  // Required fields
  if (!boundary.boundaryId) {
    errors.push({
      code: 'MISSING_BOUNDARY_ID',
      message: 'Boundary ID is required',
      field: 'boundaryId',
    });
  }

  // Security warnings
  if (boundary.defaultNetworkPolicy === 'allow') {
    warnings.push({
      code: 'PERMISSIVE_NETWORK',
      message: 'Default network policy is "allow" - this may expose production systems',
      field: 'defaultNetworkPolicy',
    });
  }

  if (boundary.allowOutboundNetwork) {
    warnings.push({
      code: 'OUTBOUND_ALLOWED',
      message: 'Outbound network is allowed - ensure production endpoints are blocked',
      field: 'allowOutboundNetwork',
    });
  }

  if (!boundary.failFast) {
    warnings.push({
      code: 'NO_FAIL_FAST',
      message: 'Fail fast is disabled - isolation breaches may not halt execution immediately',
      field: 'failFast',
    });
  }

  if (boundary.blockedCredentials.length === 0) {
    warnings.push({
      code: 'NO_BLOCKED_CREDENTIALS',
      message: 'No credential patterns blocked - production credentials may be accessible',
      field: 'blockedCredentials',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
