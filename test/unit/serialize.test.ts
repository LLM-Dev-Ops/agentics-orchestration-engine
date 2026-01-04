/**
 * Unit tests for serialization utilities.
 */

import { describe, it, expect } from 'vitest';
import { canonicalSerialize } from '../../src/utils/serialize.js';
import { deepClone } from '../../src/utils/clone.js';

describe('Serialization Utilities', () => {
  describe('canonicalSerialize', () => {
    it('sorts object keys alphabetically', () => {
      const obj = { c: 3, a: 1, b: 2 };
      const result = canonicalSerialize(obj);

      expect(result).toBe('{"a":1,"b":2,"c":3}');
    });

    it('handles nested objects', () => {
      const obj = {
        outer: {
          z: 'last',
          a: 'first',
        },
      };
      const result = canonicalSerialize(obj);

      expect(result).toBe('{"outer":{"a":"first","z":"last"}}');
    });

    it('handles arrays', () => {
      const obj = { items: [3, 1, 2] };
      const result = canonicalSerialize(obj);

      // Arrays maintain order
      expect(result).toBe('{"items":[3,1,2]}');
    });

    it('handles null values', () => {
      const obj = { value: null };
      const result = canonicalSerialize(obj);

      expect(result).toBe('{"value":null}');
    });

    it('handles boolean values', () => {
      const obj = { yes: true, no: false };
      const result = canonicalSerialize(obj);

      expect(result).toBe('{"no":false,"yes":true}');
    });

    it('handles empty objects and arrays', () => {
      const obj = { empty: {}, list: [] };
      const result = canonicalSerialize(obj);

      expect(result).toBe('{"empty":{},"list":[]}');
    });

    it('handles mixed nested structures', () => {
      const obj = {
        z: [
          { b: 2, a: 1 },
          { d: 4, c: 3 },
        ],
        a: {
          nested: {
            deep: true,
          },
        },
      };

      const result = canonicalSerialize(obj);

      // Keys should be sorted at all levels
      expect(result).toContain('"a":');
      expect(result).toContain('"z":');
      expect(result.indexOf('"a":')).toBeLessThan(result.indexOf('"z":'));
    });
  });

  describe('deepClone', () => {
    it('creates independent copy of object', () => {
      const original = { a: 1, b: { c: 2 } };
      const clone = deepClone(original);

      // Values should be equal
      expect(clone).toEqual(original);

      // But not the same reference
      expect(clone).not.toBe(original);
      expect(clone.b).not.toBe(original.b);
    });

    it('clones arrays', () => {
      const original = [1, [2, 3], { a: 4 }];
      const clone = deepClone(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
      expect(clone[1]).not.toBe(original[1]);
      expect(clone[2]).not.toBe(original[2]);
    });

    it('handles null and undefined', () => {
      expect(deepClone(null)).toBe(null);
      expect(deepClone(undefined)).toBe(undefined);
    });

    it('handles primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('string')).toBe('string');
      expect(deepClone(true)).toBe(true);
    });

    it('handles dates', () => {
      const original = new Date('2026-01-04T12:00:00.000Z');
      const clone = deepClone(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
    });

    it('modifications to clone do not affect original', () => {
      const original = { a: 1, b: { c: 2 } };
      const clone = deepClone(original);

      clone.a = 999;
      clone.b.c = 888;

      expect(original.a).toBe(1);
      expect(original.b.c).toBe(2);
    });
  });
});
