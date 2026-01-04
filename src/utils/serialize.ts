/**
 * Canonical serialization utilities for the Agentics Simulation Engine.
 *
 * Provides deterministic serialization that ensures identical objects
 * always produce identical string representations.
 *
 * @module utils/serialize
 */

/**
 * Number formatting precision for consistent serialization.
 */
const NUMBER_PRECISION = 15;

/**
 * Escapes a string for canonical JSON serialization.
 *
 * @param str - String to escape
 * @returns Escaped string with quotes
 */
function escapeString(str: string): string {
  // Use JSON.stringify for standard escaping
  return JSON.stringify(str);
}

/**
 * Formats a number with consistent precision.
 *
 * @param num - Number to format
 * @returns Formatted number string
 */
function formatNumber(num: number): string {
  if (Number.isInteger(num)) {
    return num.toString();
  }

  // Handle special values
  if (Number.isNaN(num)) {
    return '"NaN"';
  }
  if (!Number.isFinite(num)) {
    return num > 0 ? '"Infinity"' : '"-Infinity"';
  }

  // Use toPrecision for consistent decimal representation
  const formatted = num.toPrecision(NUMBER_PRECISION);
  // Remove trailing zeros after decimal point
  return parseFloat(formatted).toString();
}

/**
 * Serializes a value to canonical JSON format.
 * This ensures deterministic output regardless of property insertion order.
 *
 * Rules:
 * - null → "null"
 * - boolean → "true" or "false"
 * - number → formatted with consistent precision
 * - string → escaped with quotes
 * - array → "[item1,item2,...]" (no spaces)
 * - object → "{key1:value1,key2:value2,...}" with sorted keys (no spaces)
 *
 * @param value - Value to serialize
 * @returns Canonical JSON string
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  const type = typeof value;

  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (type === 'number') {
    return formatNumber(value as number);
  }

  if (type === 'string') {
    return escapeString(value as string);
  }

  if (type === 'bigint') {
    return `"${value.toString()}n"`;
  }

  if (type === 'symbol') {
    return `"Symbol(${(value as symbol).description ?? ''})"`;
  }

  if (type === 'function') {
    return '"[Function]"';
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalSerialize(item));
    return `[${items.join(',')}]`;
  }

  if (value instanceof Date) {
    return escapeString(value.toISOString());
  }

  if (value instanceof RegExp) {
    return escapeString(value.toString());
  }

  if (value instanceof Map) {
    // Convert Map to sorted object
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = v;
    }
    return canonicalSerialize(obj);
  }

  if (value instanceof Set) {
    // Convert Set to sorted array
    const arr = Array.from(value).sort((a, b) => {
      const aStr = canonicalSerialize(a);
      const bStr = canonicalSerialize(b);
      return aStr.localeCompare(bStr);
    });
    return canonicalSerialize(arr);
  }

  // Handle plain objects
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
      const serializedKey = escapeString(key);
      const serializedValue = canonicalSerialize(obj[key]);
      return `${serializedKey}:${serializedValue}`;
    });
    return `{${pairs.join(',')}}`;
  }

  // Fallback for unknown types
  return '"[Unknown]"';
}

/**
 * Deserializes a canonical JSON string back to a value.
 * This uses standard JSON.parse since canonical format is valid JSON.
 *
 * @param str - Canonical JSON string
 * @returns Deserialized value
 */
export function canonicalDeserialize<T = unknown>(str: string): T {
  return JSON.parse(str) as T;
}

/**
 * Compares two values for equality using canonical serialization.
 * This ensures consistent comparison regardless of property order.
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are canonically equal
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalSerialize(a) === canonicalSerialize(b);
}

/**
 * Creates a deterministic string representation of an object
 * suitable for use as a cache key or identifier.
 *
 * @param obj - Object to create key from
 * @returns String key
 */
export function createCacheKey(obj: unknown): string {
  return canonicalSerialize(obj);
}

/**
 * Serializes an object to pretty-printed JSON while maintaining
 * sorted keys for consistent output.
 *
 * @param value - Value to serialize
 * @param indent - Indentation (default 2 spaces)
 * @returns Pretty-printed JSON string
 */
export function prettySerialize(value: unknown, indent: number = 2): string {
  return JSON.stringify(sortObjectKeys(value), null, indent);
}

/**
 * Recursively sorts object keys for consistent serialization.
 *
 * @param value - Value to sort
 * @returns Value with sorted object keys
 */
function sortObjectKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sortedObj[key] = sortObjectKeys(obj[key]);
    }
    return sortedObj;
  }

  return value;
}

/**
 * Parses a JSON string with sorted keys.
 *
 * @param str - JSON string to parse
 * @returns Parsed value with sorted keys
 */
export function parseWithSortedKeys<T = unknown>(str: string): T {
  const parsed = JSON.parse(str);
  return sortObjectKeys(parsed) as T;
}

/**
 * Computes a diff between two objects using canonical serialization.
 * Returns the paths that differ.
 *
 * @param a - First object
 * @param b - Second object
 * @param path - Current path (for recursion)
 * @returns Array of differing paths
 */
export function computeDiff(
  a: unknown,
  b: unknown,
  path: string = ''
): string[] {
  const diffs: string[] = [];

  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    if (a !== b) {
      diffs.push(path || '.');
    }
    return diffs;
  }

  // Handle different types
  if (typeof a !== typeof b) {
    diffs.push(path || '.');
    return diffs;
  }

  // Handle primitives
  if (typeof a !== 'object') {
    if (a !== b) {
      diffs.push(path || '.');
    }
    return diffs;
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= a.length) {
        diffs.push(itemPath);
      } else if (i >= b.length) {
        diffs.push(itemPath);
      } else {
        diffs.push(...computeDiff(a[i], b[i], itemPath));
      }
    }
    return diffs;
  }

  // Handle objects
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

  for (const key of allKeys) {
    const keyPath = path ? `${path}.${key}` : key;
    if (!(key in aObj)) {
      diffs.push(keyPath);
    } else if (!(key in bObj)) {
      diffs.push(keyPath);
    } else {
      diffs.push(...computeDiff(aObj[key], bObj[key], keyPath));
    }
  }

  return diffs;
}
