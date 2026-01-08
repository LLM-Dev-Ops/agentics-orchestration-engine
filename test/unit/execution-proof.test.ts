/**
 * Execution Proof Tests.
 *
 * Tests for the mandatory multi-layer execution proof.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExecutionProof,
  createFailedExecutionProof,
  MANDATORY_LAYERS,
  type ExecutionProof,
  type ExecutionLayer,
  type LayerExecutionRecord,
} from '../../src/types/execution-proof.js';
import { createContentHashFromObject } from '../../src/utils/hash.js';
import type { ISOTimestamp } from '../../src/types/common.js';

describe('Execution Proof', () => {
  const now = new Date().toISOString() as ISOTimestamp;

  function createMockLayerRecord(
    layer: ExecutionLayer,
    success: boolean = true
  ): LayerExecutionRecord {
    return {
      layer,
      startTime: now,
      endTime: now,
      durationMs: 100,
      success,
      inputHash: createContentHashFromObject({ layer, input: true }),
      outputHash: createContentHashFromObject({ layer, output: true }),
      operations: [],
    };
  }

  describe('MANDATORY_LAYERS', () => {
    it('should contain foundational, intelligence, and core', () => {
      expect(MANDATORY_LAYERS).toContain('foundational');
      expect(MANDATORY_LAYERS).toContain('intelligence');
      expect(MANDATORY_LAYERS).toContain('core');
    });

    it('should have exactly 3 mandatory layers', () => {
      expect(MANDATORY_LAYERS.length).toBe(3);
    });
  });

  describe('validateExecutionProof', () => {
    it('should return true for proof with all mandatory layers', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'intelligence', 'core'],
        layerRecords: [
          createMockLayerRecord('foundational'),
          createMockLayerRecord('intelligence'),
          createMockLayerRecord('core'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: true,
        totalExecutionMs: 300,
      };

      expect(validateExecutionProof(proof)).toBe(true);
    });

    it('should return true for proof with mandatory + optional layers', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'intelligence', 'core', 'validation', 'artifact'],
        layerRecords: [
          createMockLayerRecord('foundational'),
          createMockLayerRecord('intelligence'),
          createMockLayerRecord('core'),
          createMockLayerRecord('validation'),
          createMockLayerRecord('artifact'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: true,
        totalExecutionMs: 500,
      };

      expect(validateExecutionProof(proof)).toBe(true);
    });

    it('should return false when missing foundational layer', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['intelligence', 'core'],
        layerRecords: [
          createMockLayerRecord('intelligence'),
          createMockLayerRecord('core'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: false,
        totalExecutionMs: 200,
      };

      expect(validateExecutionProof(proof)).toBe(false);
    });

    it('should return false when missing intelligence layer', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'core'],
        layerRecords: [
          createMockLayerRecord('foundational'),
          createMockLayerRecord('core'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: false,
        totalExecutionMs: 200,
      };

      expect(validateExecutionProof(proof)).toBe(false);
    });

    it('should return false when missing core layer', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'intelligence'],
        layerRecords: [
          createMockLayerRecord('foundational'),
          createMockLayerRecord('intelligence'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: false,
        totalExecutionMs: 200,
      };

      expect(validateExecutionProof(proof)).toBe(false);
    });

    it('should return false when mandatoryLayersComplete is false even with all layers', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'intelligence', 'core'],
        layerRecords: [
          createMockLayerRecord('foundational'),
          createMockLayerRecord('intelligence'),
          createMockLayerRecord('core'),
        ],
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: false, // Inconsistent flag
        totalExecutionMs: 300,
      };

      expect(validateExecutionProof(proof)).toBe(false);
    });

    it('should accept proof with execution graph as alternative', () => {
      const proof: ExecutionProof = {
        layersExecuted: ['foundational', 'intelligence', 'core'],
        layerRecords: [],
        executionGraph: {
          nodes: [
            {
              nodeId: 'node-1',
              layer: 'foundational',
              operationType: 'init',
              timestamp: now,
              durationMs: 10,
              inputRefs: [],
              outputRefs: ['node-2'],
              stateHash: createContentHashFromObject({ node: 1 }),
            },
          ],
          edges: [],
          rootNodeId: 'node-1',
          terminalNodeIds: ['node-1'],
        },
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: true,
        totalExecutionMs: 10,
      };

      expect(validateExecutionProof(proof)).toBe(true);
    });
  });

  describe('createFailedExecutionProof', () => {
    it('should create empty proof for failures', () => {
      const proof = createFailedExecutionProof(
        { code: 'TEST_ERROR', message: 'Test failure' },
        now,
        createContentHashFromObject({ error: true })
      );

      expect(proof.layersExecuted).toHaveLength(0);
      expect(proof.layerRecords).toHaveLength(0);
      expect(proof.mandatoryLayersComplete).toBe(false);
      expect(proof.totalExecutionMs).toBe(0);
    });

    it('should fail validation for failed proof', () => {
      const proof = createFailedExecutionProof(
        { code: 'TEST_ERROR', message: 'Test failure' },
        now,
        createContentHashFromObject({ error: true })
      );

      expect(validateExecutionProof(proof)).toBe(false);
    });
  });

  describe('Layer order', () => {
    it('should track layers in execution order', () => {
      const layers: ExecutionLayer[] = ['foundational', 'intelligence', 'core', 'validation', 'artifact'];
      const proof: ExecutionProof = {
        layersExecuted: layers,
        layerRecords: layers.map((l) => createMockLayerRecord(l)),
        proofGeneratedAt: now,
        proofHash: createContentHashFromObject({ test: true }),
        mandatoryLayersComplete: true,
        totalExecutionMs: 500,
      };

      expect(proof.layersExecuted[0]).toBe('foundational');
      expect(proof.layersExecuted[1]).toBe('intelligence');
      expect(proof.layersExecuted[2]).toBe('core');
    });
  });
});
