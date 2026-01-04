/**
 * Determinism Verification Tests.
 *
 * These tests verify that the simulation engine produces deterministic
 * results when given the same inputs and seed. This is a critical
 * requirement for the simulation engine.
 *
 * CRITICAL: These tests must pass in every CI/CD build.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeterministicRandom,
  createSeededRandom,
} from '../../src/core/determinism/random.js';
import {
  SimulatedClock,
  createControlledClock,
} from '../../src/core/determinism/clock.js';
import { canonicalSerialize } from '../../src/utils/serialize.js';
import { sha256, createContentHash } from '../../src/utils/hash.js';
import type { ISOTimestamp } from '../../src/types/common.js';

describe('Determinism Verification', () => {
  describe('DeterministicRandom', () => {
    it('produces identical sequences with same seed', () => {
      const seed = 12345;
      const random1 = createSeededRandom(seed);
      const random2 = createSeededRandom(seed);

      const sequence1 = Array.from({ length: 100 }, () => random1.nextFloat());
      const sequence2 = Array.from({ length: 100 }, () => random2.nextFloat());

      expect(sequence1).toEqual(sequence2);
    });

    it('produces different sequences with different seeds', () => {
      const random1 = createSeededRandom(12345);
      const random2 = createSeededRandom(54321);

      const sequence1 = Array.from({ length: 10 }, () => random1.nextFloat());
      const sequence2 = Array.from({ length: 10 }, () => random2.nextFloat());

      expect(sequence1).not.toEqual(sequence2);
    });

    it('state save/restore produces identical results', () => {
      const random = createSeededRandom(12345);

      // Generate some values
      Array.from({ length: 50 }, () => random.nextFloat());

      // Save state
      const state = random.getState();

      // Generate more values
      const expected = Array.from({ length: 50 }, () => random.nextFloat());

      // Restore state and regenerate
      random.restoreState(state);
      const actual = Array.from({ length: 50 }, () => random.nextFloat());

      expect(actual).toEqual(expected);
    });

    it('fork produces predictable child sequences', () => {
      const random1 = createSeededRandom(12345);
      const random2 = createSeededRandom(12345);

      // Fork at the same point
      const child1 = random1.fork('test-fork');
      const child2 = random2.fork('test-fork');

      const sequence1 = Array.from({ length: 50 }, () => child1.nextFloat());
      const sequence2 = Array.from({ length: 50 }, () => child2.nextFloat());

      expect(sequence1).toEqual(sequence2);
    });

    it('shuffle produces identical results with same seed', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const random1 = createSeededRandom(12345);
      const random2 = createSeededRandom(12345);

      const shuffled1 = random1.shuffle([...items]);
      const shuffled2 = random2.shuffle([...items]);

      expect(shuffled1).toEqual(shuffled2);
    });

    it('nextInRange produces values within bounds', () => {
      const random = createSeededRandom(12345);

      for (let i = 0; i < 1000; i++) {
        const value = random.nextInRange(10, 20);
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('SimulatedClock', () => {
    it('controlled mode produces deterministic time', () => {
      const startTime = '2026-01-04T12:00:00.000Z' as ISOTimestamp;

      const clock1 = createControlledClock(startTime);
      const clock2 = createControlledClock(startTime);

      // Advance both clocks the same amount
      const times1: ISOTimestamp[] = [];
      const times2: ISOTimestamp[] = [];

      for (let i = 0; i < 10; i++) {
        times1.push(clock1.getTime());
        times2.push(clock2.getTime());
        clock1.advance('PT1S');
        clock2.advance('PT1S');
      }

      expect(times1).toEqual(times2);
    });

    it('state save/restore produces identical times', () => {
      const startTime = '2026-01-04T12:00:00.000Z' as ISOTimestamp;

      const clock = createControlledClock(startTime);

      // Advance some
      for (let i = 0; i < 5; i++) {
        clock.advance('PT1S');
      }

      // Save state
      const state = clock.getState();

      // Advance more and record times
      const expected: ISOTimestamp[] = [];
      for (let i = 0; i < 5; i++) {
        expected.push(clock.getTime());
        clock.advance('PT1S');
      }

      // Restore and verify
      clock.restoreState(state);
      const actual: ISOTimestamp[] = [];
      for (let i = 0; i < 5; i++) {
        actual.push(clock.getTime());
        clock.advance('PT1S');
      }

      expect(actual).toEqual(expected);
    });
  });

  describe('Canonical Serialization', () => {
    it('produces identical output for equivalent objects', () => {
      const obj1 = { b: 2, a: 1, c: { z: 26, y: 25 } };
      const obj2 = { a: 1, c: { y: 25, z: 26 }, b: 2 };

      const serialized1 = canonicalSerialize(obj1);
      const serialized2 = canonicalSerialize(obj2);

      expect(serialized1).toBe(serialized2);
    });

    it('produces different output for different objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3 };

      const serialized1 = canonicalSerialize(obj1);
      const serialized2 = canonicalSerialize(obj2);

      expect(serialized1).not.toBe(serialized2);
    });

    it('handles nested arrays consistently', () => {
      const obj1 = { items: [{ id: 1 }, { id: 2 }] };
      const obj2 = { items: [{ id: 1 }, { id: 2 }] };

      const serialized1 = canonicalSerialize(obj1);
      const serialized2 = canonicalSerialize(obj2);

      expect(serialized1).toBe(serialized2);
    });

    it('handles special values consistently', () => {
      const obj = {
        nullValue: null,
        boolTrue: true,
        boolFalse: false,
        zero: 0,
        emptyString: '',
        emptyArray: [],
        emptyObject: {},
      };

      const serialized1 = canonicalSerialize(obj);
      const serialized2 = canonicalSerialize(obj);

      expect(serialized1).toBe(serialized2);
    });
  });

  describe('Content Hashing', () => {
    it('produces identical hashes for identical content', () => {
      const content = 'Hello, World!';

      const hash1 = sha256(content);
      const hash2 = sha256(content);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const hash1 = sha256('Hello, World!');
      const hash2 = sha256('Hello, World?');

      expect(hash1).not.toBe(hash2);
    });

    it('ContentHash structure is consistent', () => {
      const content = 'Test content';

      const hash1 = createContentHash(content);
      const hash2 = createContentHash(content);

      expect(hash1).toEqual(hash2);
      expect(hash1.algorithm).toBe('sha256');
      expect(hash1.value).toBe(hash2.value);
    });
  });

  describe('End-to-End Determinism', () => {
    it('complex object serialization + hashing is deterministic', () => {
      const complexObject = {
        id: 'test-123',
        timestamp: '2026-01-04T12:00:00.000Z',
        data: {
          values: [1, 2, 3, 4, 5],
          nested: {
            deep: {
              value: 42,
            },
          },
        },
        metadata: {
          tags: ['a', 'b', 'c'],
          properties: {
            foo: 'bar',
            baz: 123,
          },
        },
      };

      // Serialize and hash multiple times
      const results = Array.from({ length: 10 }, () => {
        const serialized = canonicalSerialize(complexObject);
        return sha256(serialized);
      });

      // All results should be identical
      const firstHash = results[0];
      expect(results.every((hash) => hash === firstHash)).toBe(true);
    });

    it('random + clock + serialization produces deterministic results', () => {
      function runSimulation(seed: number): string {
        const random = createSeededRandom(seed);
        const clock = createControlledClock('2026-01-04T12:00:00.000Z' as ISOTimestamp);

        const events: Array<{ time: string; value: number }> = [];

        for (let i = 0; i < 10; i++) {
          events.push({
            time: clock.getTime(),
            value: random.nextInt(),
          });
          clock.advance('PT1S');
        }

        return sha256(canonicalSerialize(events));
      }

      // Same seed should produce same hash
      const hash1 = runSimulation(12345);
      const hash2 = runSimulation(12345);
      expect(hash1).toBe(hash2);

      // Different seed should produce different hash
      const hash3 = runSimulation(54321);
      expect(hash1).not.toBe(hash3);
    });
  });
});
