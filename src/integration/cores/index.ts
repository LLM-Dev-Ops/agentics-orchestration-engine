/**
 * Core delegation module exports.
 *
 * @module integration/cores
 */

export * from './core-client.js';
export * from './span-validator.js';
export * from './errors.js';
export * from './core-endpoints.js';
export * from './span-normalizer.js';
export * from './http-cores.js';

// Mock cores are exported for tests only. No server-reachable path may import
// them — enforced by scripts/check-no-mock-cores.mjs.
export * from './mock-cores.js';
