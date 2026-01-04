/**
 * JSON Format Renderer.
 *
 * Renders artifacts to JSON format with optional pretty printing.
 *
 * @module artifact/formats/json
 */

import type { ContentHash } from '../../types/common.js';
import { createContentHash } from '../../utils/hash.js';
import { canonicalSerialize } from '../../utils/serialize.js';

// ============================================================================
// JSON RENDER OPTIONS
// ============================================================================

/**
 * Options for JSON rendering.
 */
export interface JSONRenderOptions {
  /** Pretty print with indentation */
  readonly pretty?: boolean;
  /** Number of spaces for indentation (default: 2) */
  readonly indent?: number;
  /** Sort keys for deterministic output */
  readonly sortKeys?: boolean;
}

// ============================================================================
// JSON RENDER RESULT
// ============================================================================

/**
 * Result of JSON rendering.
 */
export interface JSONRenderResult {
  readonly content: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
}

// ============================================================================
// JSON RENDERER CLASS
// ============================================================================

/**
 * Renders data to JSON format.
 */
export class JSONRenderer {
  private readonly options: JSONRenderOptions;

  constructor(options: JSONRenderOptions = {}) {
    this.options = {
      pretty: true,
      indent: 2,
      sortKeys: true,
      ...options,
    };
  }

  /**
   * Renders an object to JSON.
   *
   * @param data - Data to render
   * @returns Render result
   */
  render(data: unknown): JSONRenderResult {
    let content: string;

    if (this.options.sortKeys) {
      // Use canonical serialization for deterministic output
      content = canonicalSerialize(data);
      if (this.options.pretty) {
        // Re-parse and re-stringify with pretty printing
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed, null, this.options.indent);
      }
    } else {
      // Standard JSON serialization
      content = this.options.pretty
        ? JSON.stringify(data, null, this.options.indent)
        : JSON.stringify(data);
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const contentHash = createContentHash(content);

    return {
      content,
      mimeType: 'application/json',
      sizeBytes,
      contentHash,
    };
  }

  /**
   * Renders a stream of objects to JSON array.
   *
   * @param items - Items to render
   * @returns Render result
   */
  renderArray<T>(items: ReadonlyArray<T>): JSONRenderResult {
    return this.render(items);
  }

  /**
   * Renders key-value pairs to JSON object.
   *
   * @param entries - Key-value pairs
   * @returns Render result
   */
  renderObject(entries: ReadonlyArray<[string, unknown]>): JSONRenderResult {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      obj[key] = value;
    }
    return this.render(obj);
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a JSON renderer.
 */
export function createJSONRenderer(
  options?: JSONRenderOptions
): JSONRenderer {
  return new JSONRenderer(options);
}

/**
 * Renders data to JSON format.
 */
export function renderJSON(
  data: unknown,
  options?: JSONRenderOptions
): JSONRenderResult {
  const renderer = new JSONRenderer(options);
  return renderer.render(data);
}
