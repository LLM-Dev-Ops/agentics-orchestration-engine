/**
 * YAML Format Renderer.
 *
 * Renders artifacts to YAML format.
 *
 * @module artifact/formats/yaml
 */

import type { ContentHash } from '../../types/common.js';
import { createContentHash } from '../../utils/hash.js';

// ============================================================================
// YAML RENDER OPTIONS
// ============================================================================

/**
 * Options for YAML rendering.
 */
export interface YAMLRenderOptions {
  /** Number of spaces for indentation (default: 2) */
  readonly indent?: number;
  /** Sort keys for deterministic output */
  readonly sortKeys?: boolean;
  /** Maximum line width */
  readonly lineWidth?: number;
}

// ============================================================================
// YAML RENDER RESULT
// ============================================================================

/**
 * Result of YAML rendering.
 */
export interface YAMLRenderResult {
  readonly content: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
}

// ============================================================================
// YAML RENDERER CLASS
// ============================================================================

/**
 * Renders data to YAML format.
 *
 * Note: This is a simple YAML serializer. For production use,
 * consider using a library like js-yaml.
 */
export class YAMLRenderer {
  private readonly options: Required<YAMLRenderOptions>;

  constructor(options: YAMLRenderOptions = {}) {
    this.options = {
      indent: 2,
      sortKeys: true,
      lineWidth: 80,
      ...options,
    };
  }

  /**
   * Renders an object to YAML.
   *
   * @param data - Data to render
   * @returns Render result
   */
  render(data: unknown): YAMLRenderResult {
    const content = this.serializeValue(data, 0);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const contentHash = createContentHash(content);

    return {
      content,
      mimeType: 'application/yaml',
      sizeBytes,
      contentHash,
    };
  }

  /**
   * Serializes a value to YAML string.
   */
  private serializeValue(value: unknown, depth: number): string {
    if (value === null) {
      return 'null';
    }

    if (value === undefined) {
      return '~';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      if (isNaN(value)) return '.nan';
      if (!isFinite(value)) return value > 0 ? '.inf' : '-.inf';
      return String(value);
    }

    if (typeof value === 'string') {
      return this.serializeString(value);
    }

    if (Array.isArray(value)) {
      return this.serializeArray(value, depth);
    }

    if (typeof value === 'object') {
      return this.serializeObject(value as Record<string, unknown>, depth);
    }

    return String(value);
  }

  /**
   * Serializes a string, adding quotes if necessary.
   */
  private serializeString(value: string): string {
    // Check if string needs quoting
    const needsQuotes =
      value === '' ||
      value.includes(':') ||
      value.includes('#') ||
      value.includes('\n') ||
      value.includes('"') ||
      value.startsWith(' ') ||
      value.endsWith(' ') ||
      /^[0-9]/.test(value) ||
      ['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(
        value.toLowerCase()
      );

    if (needsQuotes) {
      // Escape special characters and wrap in quotes
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }

    return value;
  }

  /**
   * Serializes an array to YAML.
   */
  private serializeArray(arr: unknown[], depth: number): string {
    if (arr.length === 0) {
      return '[]';
    }

    const indent = ' '.repeat(this.options.indent * depth);
    const lines: string[] = [];

    for (const item of arr) {
      const serialized = this.serializeValue(item, depth + 1);
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Multi-line object - put on next line
        lines.push(`${indent}- ${serialized.trim()}`);
      } else {
        lines.push(`${indent}- ${serialized}`);
      }
    }

    return '\n' + lines.join('\n');
  }

  /**
   * Serializes an object to YAML.
   */
  private serializeObject(
    obj: Record<string, unknown>,
    depth: number
  ): string {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return '{}';
    }

    // Sort keys if configured
    if (this.options.sortKeys) {
      keys.sort();
    }

    const indent = ' '.repeat(this.options.indent * depth);
    const lines: string[] = [];

    for (const key of keys) {
      const value = obj[key];
      const serializedKey = this.serializeString(key);
      const serializedValue = this.serializeValue(value, depth + 1);

      if (
        (typeof value === 'object' && value !== null) ||
        (typeof serializedValue === 'string' && serializedValue.startsWith('\n'))
      ) {
        // Multi-line value
        lines.push(`${indent}${serializedKey}:${serializedValue}`);
      } else {
        lines.push(`${indent}${serializedKey}: ${serializedValue}`);
      }
    }

    return (depth > 0 ? '\n' : '') + lines.join('\n');
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a YAML renderer.
 */
export function createYAMLRenderer(options?: YAMLRenderOptions): YAMLRenderer {
  return new YAMLRenderer(options);
}

/**
 * Renders data to YAML format.
 */
export function renderYAML(
  data: unknown,
  options?: YAMLRenderOptions
): YAMLRenderResult {
  const renderer = new YAMLRenderer(options);
  return renderer.render(data);
}
