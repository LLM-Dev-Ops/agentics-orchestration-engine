/**
 * Unit tests for hash utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  sha256,
  createContentHash,
  createContentHashFromObject,
  verifyContentHash,
} from '../../src/utils/hash.js';

describe('Hash Utilities', () => {
  describe('sha256', () => {
    it('computes SHA-256 hash of string', () => {
      const hash = sha256('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('computes SHA-256 hash of empty string', () => {
      const hash = sha256('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('computes different hashes for different inputs', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('world');
      expect(hash1).not.toBe(hash2);
    });

    it('computes same hash for same input', () => {
      const hash1 = sha256('test');
      const hash2 = sha256('test');
      expect(hash1).toBe(hash2);
    });
  });

  describe('createContentHash', () => {
    it('creates ContentHash structure', () => {
      const hash = createContentHash('test content');

      expect(hash).toHaveProperty('algorithm', 'sha256');
      expect(hash).toHaveProperty('value');
      expect(typeof hash.value).toBe('string');
      expect(hash.value.length).toBe(64); // SHA-256 produces 64 hex chars
    });

    it('produces consistent hashes', () => {
      const hash1 = createContentHash('test');
      const hash2 = createContentHash('test');

      expect(hash1).toEqual(hash2);
    });
  });

  describe('createContentHashFromObject', () => {
    it('creates hash from object using canonical serialization', () => {
      const obj = { b: 2, a: 1 };
      const hash = createContentHashFromObject(obj);

      expect(hash).toHaveProperty('algorithm', 'sha256');
      expect(hash).toHaveProperty('value');
    });

    it('produces same hash for objects with same content', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      const hash1 = createContentHashFromObject(obj1);
      const hash2 = createContentHashFromObject(obj2);

      expect(hash1.value).toBe(hash2.value);
    });

    it('produces different hash for objects with different content', () => {
      const obj1 = { a: 1 };
      const obj2 = { a: 2 };

      const hash1 = createContentHashFromObject(obj1);
      const hash2 = createContentHashFromObject(obj2);

      expect(hash1.value).not.toBe(hash2.value);
    });
  });

  describe('verifyContentHash', () => {
    it('returns true for matching hash', () => {
      const content = 'test content';
      const hash = createContentHash(content);

      expect(verifyContentHash(hash, content)).toBe(true);
    });

    it('returns false for non-matching hash', () => {
      const hash = createContentHash('original');

      expect(verifyContentHash(hash, 'modified')).toBe(false);
    });
  });
});
