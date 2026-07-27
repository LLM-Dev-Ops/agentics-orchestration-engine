/**
 * Layer-3 Core Endpoint Configuration.
 *
 * Resolves the four external Agentics Core base URLs from environment
 * configuration and FAILS CLOSED when any is absent. Per ADR-0001, the
 * service must refuse to boot rather than silently substitute mock cores.
 *
 * @module integration/cores/core-endpoints
 */

// ============================================================================
// ENVIRONMENT VARIABLE MAP
// ============================================================================

/**
 * Environment variable that configures each Core's base URL.
 * Names follow the platform-wide `<CORE>_CORE_URL` convention.
 */
export const CORE_URL_ENV_VARS = {
  security: 'SECURITY_CORE_URL',
  data: 'DATA_CORE_URL',
  governance: 'GOVERNANCE_CORE_URL',
  automation: 'AUTOMATION_CORE_URL',
} as const;

export type CoreSlot = keyof typeof CORE_URL_ENV_VARS;

/**
 * Resolved base URLs for the four external Agentics Cores.
 */
export interface CoreEndpoints {
  readonly security: string;
  readonly data: string;
  readonly governance: string;
  readonly automation: string;
}

// ============================================================================
// CONFIGURATION ERROR
// ============================================================================

/**
 * Thrown when Core endpoint configuration is missing or unusable.
 *
 * Carries the offending variable names so startup failures name exactly
 * which environment variable must be set.
 */
export class CoreConfigurationError extends Error {
  readonly code: string;
  readonly variables: ReadonlyArray<string>;

  constructor(message: string, code: string, variables: ReadonlyArray<string>) {
    super(message);
    this.name = 'CoreConfigurationError';
    this.code = code;
    this.variables = variables;
  }
}

// ============================================================================
// RESOLUTION
// ============================================================================

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/**
 * Resolves all four Core base URLs from environment configuration.
 *
 * FAILS CLOSED: throws CoreConfigurationError naming every variable that is
 * missing or not a usable http(s) URL. There is no mock fallback.
 *
 * @param env - Environment source (defaults to process.env)
 * @throws CoreConfigurationError if any Core URL is absent or malformed
 */
export function resolveCoreEndpoints(
  env: NodeJS.ProcessEnv = process.env
): CoreEndpoints {
  const missing: string[] = [];
  const malformed: string[] = [];
  const resolved: Partial<Record<CoreSlot, string>> = {};

  for (const [slot, varName] of Object.entries(CORE_URL_ENV_VARS) as Array<
    [CoreSlot, string]
  >) {
    const value = env[varName]?.trim();

    if (!value) {
      missing.push(varName);
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      malformed.push(varName);
      continue;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      malformed.push(varName);
      continue;
    }

    resolved[slot] = normalizeBaseUrl(value);
  }

  if (missing.length > 0 || malformed.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`missing: ${missing.join(', ')}`);
    }
    if (malformed.length > 0) {
      parts.push(`not a valid http(s) URL: ${malformed.join(', ')}`);
    }
    throw new CoreConfigurationError(
      `Layer-3 Core service URLs are not configured (${parts.join('; ')}). ` +
        'This service delegates all execution to the real Cores and refuses ' +
        'to start without them.',
      'CORE_URL_NOT_CONFIGURED',
      [...missing, ...malformed]
    );
  }

  return {
    security: resolved.security as string,
    data: resolved.data as string,
    governance: resolved.governance as string,
    automation: resolved.automation as string,
  };
}
