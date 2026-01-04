/**
 * Deterministic Random Number Generator.
 *
 * Provides seeded, reproducible random number generation for
 * deterministic simulation execution.
 *
 * Uses Linear Congruential Generator (LCG) algorithm for
 * predictable, reproducible sequences.
 *
 * @module core/determinism/random
 */

import { createContentHash } from '../../utils/hash.js';

// ============================================================================
// RANDOM STATE TYPES
// ============================================================================

/**
 * Internal state of the random number generator.
 * Can be captured and restored for deterministic replay.
 */
export interface RandomState {
  /** Initial seed value */
  readonly seed: number;
  /** Current generator state */
  readonly state: number;
  /** Number of values generated */
  readonly callCount: number;
  /** Fork history for debugging */
  readonly forkPath: ReadonlyArray<string>;
}

/**
 * Configuration for the random number generator.
 */
export interface RandomConfig {
  /** Initial seed (default: current timestamp) */
  readonly seed?: number;
  /** Maximum call count before warning (default: 1,000,000) */
  readonly maxCallCount?: number;
}

// ============================================================================
// LCG CONSTANTS
// ============================================================================

/**
 * LCG multiplier (same as glibc).
 * Formula: state = (state * MULTIPLIER + INCREMENT) mod MODULUS
 */
const MULTIPLIER = 1103515245;

/** LCG increment */
const INCREMENT = 12345;

/** LCG modulus (2^31) */
const MODULUS = 2147483648; // 2^31

// ============================================================================
// DETERMINISTIC RANDOM CLASS
// ============================================================================

/**
 * Deterministic random number generator.
 *
 * This class provides reproducible random number generation using
 * a Linear Congruential Generator (LCG). Given the same seed, it
 * will always produce the same sequence of numbers.
 *
 * Key features:
 * - Deterministic: Same seed produces same sequence
 * - Forkable: Create independent sub-generators
 * - Restorable: Capture and restore state
 * - Auditable: Track call count and fork history
 */
export class DeterministicRandom {
  private seed: number;
  private state: number;
  private callCount: number;
  private forkPath: string[];
  private readonly maxCallCount: number;

  /**
   * Creates a new deterministic random number generator.
   *
   * @param config - Configuration options
   */
  constructor(config?: RandomConfig) {
    this.seed = config?.seed ?? Date.now();
    this.state = this.seed;
    this.callCount = 0;
    this.forkPath = [];
    this.maxCallCount = config?.maxCallCount ?? 1_000_000;
  }

  // ==========================================================================
  // CORE GENERATION METHODS
  // ==========================================================================

  /**
   * Generates the next random integer in the sequence.
   * Range: [0, 2^31 - 1]
   *
   * @returns Random integer
   */
  nextInt(): number {
    this.checkCallCount();
    this.state = (this.state * MULTIPLIER + INCREMENT) % MODULUS;
    this.callCount++;
    return this.state;
  }

  /**
   * Generates a random float in the range [0, 1).
   *
   * @returns Random float
   */
  nextFloat(): number {
    return this.nextInt() / MODULUS;
  }

  /**
   * Generates a random float in the range [0, 1].
   *
   * @returns Random float
   */
  nextFloatInclusive(): number {
    return this.nextInt() / (MODULUS - 1);
  }

  /**
   * Generates a random integer in the specified range.
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns Random integer in range
   */
  nextInRange(min: number, max: number): number {
    if (min > max) {
      throw new Error(`Invalid range: min (${min}) > max (${max})`);
    }
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error('nextInRange requires integer arguments');
    }
    const range = max - min + 1;
    return min + (this.nextInt() % range);
  }

  /**
   * Generates a random float in the specified range.
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   * @returns Random float in range
   */
  nextFloatInRange(min: number, max: number): number {
    if (min > max) {
      throw new Error(`Invalid range: min (${min}) > max (${max})`);
    }
    return min + this.nextFloat() * (max - min);
  }

  /**
   * Generates a random boolean.
   *
   * @param probability - Probability of true (default: 0.5)
   * @returns Random boolean
   */
  nextBoolean(probability = 0.5): boolean {
    return this.nextFloat() < probability;
  }

  // ==========================================================================
  // ARRAY METHODS
  // ==========================================================================

  /**
   * Shuffles an array in place using Fisher-Yates algorithm.
   * Returns a new array, does not modify the original.
   *
   * @param array - Array to shuffle
   * @returns New shuffled array
   */
  shuffle<T>(array: ReadonlyArray<T>): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInRange(0, i);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }

  /**
   * Picks a random element from an array.
   *
   * @param array - Array to pick from
   * @returns Random element
   * @throws Error if array is empty
   */
  pick<T>(array: ReadonlyArray<T>): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInRange(0, array.length - 1)]!;
  }

  /**
   * Picks multiple random elements from an array without replacement.
   *
   * @param array - Array to pick from
   * @param count - Number of elements to pick
   * @returns Array of picked elements
   */
  pickMultiple<T>(array: ReadonlyArray<T>, count: number): T[] {
    if (count > array.length) {
      throw new Error(`Cannot pick ${count} elements from array of length ${array.length}`);
    }
    if (count <= 0) {
      return [];
    }
    const shuffled = this.shuffle(array);
    return shuffled.slice(0, count);
  }

  /**
   * Picks a random element using weighted probabilities.
   *
   * @param items - Array of items with weights
   * @returns Picked item
   */
  pickWeighted<T>(items: ReadonlyArray<{ item: T; weight: number }>): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }

    const totalWeight = items.reduce((sum, { weight }) => sum + weight, 0);
    if (totalWeight <= 0) {
      throw new Error('Total weight must be positive');
    }

    let random = this.nextFloat() * totalWeight;
    for (const { item, weight } of items) {
      random -= weight;
      if (random <= 0) {
        return item;
      }
    }

    // Fallback to last item (shouldn't happen with valid weights)
    return items[items.length - 1]!.item;
  }

  // ==========================================================================
  // DISTRIBUTION METHODS
  // ==========================================================================

  /**
   * Generates a normally distributed random number using Box-Muller transform.
   *
   * @param mean - Mean of the distribution (default: 0)
   * @param stdDev - Standard deviation (default: 1)
   * @returns Random number from normal distribution
   */
  nextGaussian(mean = 0, stdDev = 1): number {
    // Box-Muller transform
    const u1 = this.nextFloat();
    const u2 = this.nextFloat();

    const z0 = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  /**
   * Generates an exponentially distributed random number.
   *
   * @param lambda - Rate parameter (1/mean)
   * @returns Random number from exponential distribution
   */
  nextExponential(lambda = 1): number {
    const u = this.nextFloat();
    return -Math.log(u || 0.0001) / lambda;
  }

  // ==========================================================================
  // IDENTIFIER GENERATION
  // ==========================================================================

  /**
   * Generates a random UUID v4-like identifier.
   * Note: This is deterministic, not cryptographically secure.
   *
   * @returns UUID-like string
   */
  nextUUID(): string {
    const hex = () => this.nextInRange(0, 15).toString(16);
    const hexN = (n: number) => Array.from({ length: n }, hex).join('');

    return [
      hexN(8),
      hexN(4),
      '4' + hexN(3), // Version 4
      ((this.nextInRange(0, 3) + 8).toString(16)) + hexN(3), // Variant
      hexN(12),
    ].join('-');
  }

  /**
   * Generates a random alphanumeric string.
   *
   * @param length - Length of the string
   * @param charset - Character set to use (default: alphanumeric)
   * @returns Random string
   */
  nextString(
    length: number,
    charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  ): string {
    return Array.from({ length }, () => charset[this.nextInRange(0, charset.length - 1)]).join('');
  }

  // ==========================================================================
  // FORKING AND STATE MANAGEMENT
  // ==========================================================================

  /**
   * Creates a forked random generator with independent state.
   * The fork is seeded based on the current state and label.
   *
   * @param label - Label for the fork (used for debugging and deterministic seeding)
   * @returns New independent random generator
   */
  fork(label: string): DeterministicRandom {
    // Generate seed from current state and label
    const forkSeed = this.generateForkSeed(label);

    const forked = new DeterministicRandom({ seed: forkSeed });
    forked.forkPath = [...this.forkPath, label];

    return forked;
  }

  /**
   * Gets the current state of the generator.
   * Can be used to checkpoint and restore.
   *
   * @returns Current state
   */
  getState(): RandomState {
    return {
      seed: this.seed,
      state: this.state,
      callCount: this.callCount,
      forkPath: [...this.forkPath],
    };
  }

  /**
   * Restores the generator to a previous state.
   *
   * @param state - State to restore
   */
  restoreState(state: RandomState): void {
    this.seed = state.seed;
    this.state = state.state;
    this.callCount = state.callCount;
    this.forkPath = [...state.forkPath];
  }

  /**
   * Resets the generator to its initial state.
   */
  reset(): void {
    this.state = this.seed;
    this.callCount = 0;
  }

  /**
   * Creates a new generator with a different seed.
   *
   * @param newSeed - New seed value
   * @returns New generator with the specified seed
   */
  reseed(newSeed: number): DeterministicRandom {
    return new DeterministicRandom({ seed: newSeed, maxCallCount: this.maxCallCount });
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Gets the initial seed.
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Gets the number of random values generated.
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Gets the fork path (for debugging).
   */
  getForkPath(): ReadonlyArray<string> {
    return [...this.forkPath];
  }

  /**
   * Generates a deterministic hash of the generator's identity.
   * Useful for verification and debugging.
   */
  getIdentityHash(): string {
    const identity = {
      seed: this.seed,
      forkPath: this.forkPath,
    };
    return createContentHash(JSON.stringify(identity)).value.substring(0, 16);
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private checkCallCount(): void {
    if (this.callCount >= this.maxCallCount) {
      console.warn(
        `DeterministicRandom: High call count (${this.callCount}). ` +
        `Consider forking or resetting.`
      );
    }
  }

  private generateForkSeed(label: string): number {
    // Use current state and label to generate a deterministic seed
    const combined = `${this.state}:${label}`;
    const hash = createContentHash(combined);

    // Convert first 8 hex characters to a number
    const seedHex = hash.value.substring(0, 8);
    return parseInt(seedHex, 16) % MODULUS;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a deterministic random generator with a specific seed.
 *
 * @param seed - Seed value
 * @returns New random generator
 */
export function createSeededRandom(seed: number): DeterministicRandom {
  return new DeterministicRandom({ seed });
}

/**
 * Creates a deterministic random generator from a string seed.
 *
 * @param seedString - String to use as seed
 * @returns New random generator
 */
export function createRandomFromString(seedString: string): DeterministicRandom {
  const hash = createContentHash(seedString);
  const seed = parseInt(hash.value.substring(0, 8), 16);
  return new DeterministicRandom({ seed });
}
