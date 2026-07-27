/**
 * ADR-0001 verification 2: fail closed on missing Core configuration.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveCoreEndpoints,
  CoreConfigurationError,
  CORE_URL_ENV_VARS,
} from '../../../src/integration/cores/core-endpoints.js';

const COMPLETE_ENV = {
  SECURITY_CORE_URL: 'https://security-core.example',
  DATA_CORE_URL: 'https://data-core.example',
  GOVERNANCE_CORE_URL: 'https://governance-core.example',
  AUTOMATION_CORE_URL: 'https://automation-core.example',
} as const;

describe('resolveCoreEndpoints', () => {
  it('resolves all four Core URLs when every variable is set', () => {
    const endpoints = resolveCoreEndpoints({ ...COMPLETE_ENV });

    expect(endpoints).toEqual({
      security: 'https://security-core.example',
      data: 'https://data-core.example',
      governance: 'https://governance-core.example',
      automation: 'https://automation-core.example',
    });
  });

  it('strips trailing slashes so path joining never doubles up', () => {
    const endpoints = resolveCoreEndpoints({
      ...COMPLETE_ENV,
      SECURITY_CORE_URL: 'https://security-core.example///',
    });

    expect(endpoints.security).toBe('https://security-core.example');
  });

  it('fails closed naming SECURITY_CORE_URL when it is unset', () => {
    const env: Record<string, string> = { ...COMPLETE_ENV };
    delete env['SECURITY_CORE_URL'];

    let thrown: unknown;
    try {
      resolveCoreEndpoints(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CoreConfigurationError);
    const error = thrown as CoreConfigurationError;
    expect(error.code).toBe('CORE_URL_NOT_CONFIGURED');
    expect(error.variables).toContain('SECURITY_CORE_URL');
    expect(error.message).toContain('SECURITY_CORE_URL');
  });

  it('names every missing variable, not just the first', () => {
    let thrown: unknown;
    try {
      resolveCoreEndpoints({});
    } catch (error) {
      thrown = error;
    }

    const error = thrown as CoreConfigurationError;
    expect([...error.variables].sort()).toEqual([
      'AUTOMATION_CORE_URL',
      'DATA_CORE_URL',
      'GOVERNANCE_CORE_URL',
      'SECURITY_CORE_URL',
    ]);
  });

  it('rejects a URL that is not http(s)', () => {
    expect(() =>
      resolveCoreEndpoints({ ...COMPLETE_ENV, DATA_CORE_URL: 'file:///etc/passwd' })
    ).toThrow(CoreConfigurationError);
  });

  it('rejects a value that is not a URL at all', () => {
    expect(() =>
      resolveCoreEndpoints({ ...COMPLETE_ENV, GOVERNANCE_CORE_URL: 'governance-core' })
    ).toThrow(CoreConfigurationError);
  });

  it('never silently substitutes a default for any single missing variable', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(CORE_URL_ENV_VARS)),
        (omitted) => {
          const env: Record<string, string> = { ...COMPLETE_ENV };
          delete env[omitted];

          let thrown: unknown;
          try {
            resolveCoreEndpoints(env);
          } catch (error) {
            thrown = error;
          }

          return (
            thrown instanceof CoreConfigurationError &&
            thrown.variables.includes(omitted)
          );
        }
      )
    );
  });

  it('treats a whitespace-only value as missing', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ \t]{1,8}$/), (blank) => {
        let thrown: unknown;
        try {
          resolveCoreEndpoints({ ...COMPLETE_ENV, DATA_CORE_URL: blank });
        } catch (error) {
          thrown = error;
        }
        return (
          thrown instanceof CoreConfigurationError &&
          thrown.variables.includes('DATA_CORE_URL')
        );
      })
    );
  });
});
