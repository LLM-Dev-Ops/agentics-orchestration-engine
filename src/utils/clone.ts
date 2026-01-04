/**
 * Deep cloning utilities for the Agentics Simulation Engine.
 *
 * Provides immutable state management through deep cloning.
 *
 * @module utils/clone
 */

/**
 * Creates a deep clone of a value.
 * This is used for immutable state management.
 *
 * @param value - Value to clone
 * @returns Deep clone of the value
 */
export function deepClone<T>(value: T): T {
  // Handle primitives and null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;
  if (type !== 'object') {
    return value;
  }

  // Handle Date
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  // Handle RegExp
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as unknown as T;
  }

  // Handle Map
  if (value instanceof Map) {
    const clonedMap = new Map();
    for (const [k, v] of value) {
      clonedMap.set(deepClone(k), deepClone(v));
    }
    return clonedMap as unknown as T;
  }

  // Handle Set
  if (value instanceof Set) {
    const clonedSet = new Set();
    for (const item of value) {
      clonedSet.add(deepClone(item));
    }
    return clonedSet as unknown as T;
  }

  // Handle Array
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }

  // Handle plain objects
  const clonedObj: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    clonedObj[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return clonedObj as T;
}

/**
 * Creates a frozen deep clone of a value.
 * The returned value is completely immutable.
 *
 * @param value - Value to clone and freeze
 * @returns Frozen deep clone
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  const cloned = deepClone(value);
  return freezeDeep(cloned);
}

/**
 * Recursively freezes an object in place.
 *
 * @param value - Value to freeze
 * @returns Frozen value
 */
function freezeDeep<T>(value: T): Readonly<T> {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Freeze arrays
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeDeep(item);
    }
    return Object.freeze(value) as Readonly<T>;
  }

  // Freeze objects
  for (const key of Object.keys(value as Record<string, unknown>)) {
    freezeDeep((value as Record<string, unknown>)[key]);
  }

  return Object.freeze(value) as Readonly<T>;
}

/**
 * Checks if two values are deeply equal.
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if deeply equal
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  // Handle identity
  if (a === b) {
    return true;
  }

  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  // Handle different types
  if (typeof a !== typeof b) {
    return false;
  }

  // Handle primitives
  if (typeof a !== 'object') {
    return a === b;
  }

  // Handle Date
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle RegExp
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }

  // Handle Map
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEquals(value, b.get(key))) {
        return false;
      }
    }
    return true;
  }

  // Handle Set
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) {
      return false;
    }
    for (const item of a) {
      // For sets, we need to check if any item in b equals this item
      let found = false;
      for (const bItem of b) {
        if (deepEquals(item, bItem)) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  }

  // Handle Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEquals(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  // Handle plain objects
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!(key in bObj)) {
      return false;
    }
    if (!deepEquals(aObj[key], bObj[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Gets a value at a path in an object.
 * Supports dot notation and array indexing.
 *
 * @param obj - Object to get value from
 * @param path - Path (e.g., "foo.bar[0].baz")
 * @returns Value at path or undefined
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) {
    return obj;
  }

  // Parse path into segments
  const segments = parsePath(path);
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof segment === 'number') {
      if (Array.isArray(current)) {
        current = current[segment];
      } else {
        return undefined;
      }
    } else {
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * Sets a value at a path in an object.
 * Creates intermediate objects/arrays as needed.
 * Returns a new object (does not mutate original).
 *
 * @param obj - Object to set value in
 * @param path - Path (e.g., "foo.bar[0].baz")
 * @param value - Value to set
 * @returns New object with value set
 */
export function setValueAtPath<T>(obj: T, path: string, value: unknown): T {
  if (!path) {
    return value as T;
  }

  const segments = parsePath(path);
  return setValueAtPathRecursive(deepClone(obj), segments, 0, value) as T;
}

/**
 * Recursively sets a value at a path.
 */
function setValueAtPathRecursive(
  obj: unknown,
  segments: (string | number)[],
  index: number,
  value: unknown
): unknown {
  if (index >= segments.length) {
    return value;
  }

  const segment = segments[index]!;
  const isLast = index === segments.length - 1;

  if (typeof segment === 'number') {
    // Array index
    const arr = Array.isArray(obj) ? [...obj] : [];
    // Extend array if needed
    while (arr.length <= segment) {
      arr.push(undefined);
    }
    arr[segment] = isLast
      ? value
      : setValueAtPathRecursive(arr[segment], segments, index + 1, value);
    return arr;
  } else {
    // Object key
    const result: Record<string, unknown> =
      typeof obj === 'object' && obj !== null
        ? { ...(obj as Record<string, unknown>) }
        : {};
    result[segment] = isLast
      ? value
      : setValueAtPathRecursive(result[segment], segments, index + 1, value);
    return result;
  }
}

/**
 * Removes a value at a path in an object.
 * Returns a new object (does not mutate original).
 *
 * @param obj - Object to remove value from
 * @param path - Path to remove
 * @returns New object with value removed
 */
export function removeValueAtPath<T>(obj: T, path: string): T {
  if (!path) {
    return undefined as unknown as T;
  }

  const segments = parsePath(path);
  return removeValueAtPathRecursive(deepClone(obj), segments, 0) as T;
}

/**
 * Recursively removes a value at a path.
 */
function removeValueAtPathRecursive(
  obj: unknown,
  segments: (string | number)[],
  index: number
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  const segment = segments[index]!;
  const isLast = index === segments.length - 1;

  if (typeof segment === 'number') {
    if (!Array.isArray(obj)) {
      return obj;
    }
    const arr = [...obj];
    if (isLast) {
      arr.splice(segment, 1);
    } else {
      arr[segment] = removeValueAtPathRecursive(arr[segment], segments, index + 1);
    }
    return arr;
  } else {
    if (typeof obj !== 'object') {
      return obj;
    }
    const result = { ...(obj as Record<string, unknown>) };
    if (isLast) {
      delete result[segment];
    } else {
      result[segment] = removeValueAtPathRecursive(result[segment], segments, index + 1);
    }
    return result;
  }
}

/**
 * Parses a path string into segments.
 * Supports dot notation and array indexing.
 *
 * @param path - Path string (e.g., "foo.bar[0].baz")
 * @returns Array of path segments
 */
function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i]!;

    if (char === '.') {
      if (current) {
        segments.push(current);
        current = '';
      }
    } else if (char === '[') {
      if (current) {
        segments.push(current);
        current = '';
      }
      // Find matching ]
      const endIndex = path.indexOf(']', i + 1);
      if (endIndex === -1) {
        throw new Error(`Invalid path: unmatched [ at position ${i}`);
      }
      const indexStr = path.substring(i + 1, endIndex);
      const index = parseInt(indexStr, 10);
      if (isNaN(index)) {
        // Treat as string key
        segments.push(indexStr);
      } else {
        segments.push(index);
      }
      i = endIndex;
    } else if (char !== ']') {
      current += char;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

/**
 * Merges multiple objects deeply.
 * Later objects override earlier ones.
 *
 * @param objects - Objects to merge
 * @returns Merged object
 */
export function deepMerge<T extends Record<string, unknown>>(
  ...objects: Partial<T>[]
): T {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    if (!obj) continue;

    for (const key of Object.keys(obj)) {
      const existing = result[key];
      const incoming = obj[key];

      if (
        existing !== null &&
        existing !== undefined &&
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        incoming !== null &&
        incoming !== undefined &&
        typeof incoming === 'object' &&
        !Array.isArray(incoming)
      ) {
        // Deep merge objects
        result[key] = deepMerge(
          existing as Record<string, unknown>,
          incoming as Record<string, unknown>
        );
      } else {
        // Override
        result[key] = deepClone(incoming);
      }
    }
  }

  return result as T;
}
