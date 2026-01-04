/**
 * Artifact Generator.
 *
 * Main artifact generation pipeline for simulation outputs.
 * Coordinates report generation, manifest creation, and artifact storage.
 *
 * @module artifact/generator
 */

import type {
  SimulationId,
  ArtifactId,
  ISOTimestamp,
  ContentHash,
} from '../types/common.js';
import type {
  SimulationResult,
  SimulationConfig,
} from '../types/simulation.js';
import type {
  Artifact,
  ArtifactManifest,
  ArtifactType,
  ArtifactFormat,
} from '../types/artifact.js';
import type { ArtifactConfig } from '../types/simulation.js';
import { createArtifactId } from '../types/common.js';
import { createContentHashFromObject, sha256 } from '../utils/hash.js';
import { ReportGenerator, createReportGenerator } from './report.js';
import { JSONRenderer, createJSONRenderer } from './formats/json.js';

// ============================================================================
// ARTIFACT GENERATOR CONFIGURATION
// ============================================================================

/**
 * Configuration for the artifact generator.
 */
export interface ArtifactGeneratorConfig {
  /** Simulation ID for the artifacts */
  readonly simulationId: SimulationId;
  /** Artifact configuration from simulation config */
  readonly artifactConfig: ArtifactConfig;
  /** Time provider */
  readonly getTime?: () => ISOTimestamp;
}

// ============================================================================
// ARTIFACT GENERATOR CLASS
// ============================================================================

/**
 * Generates artifacts from simulation results.
 *
 * Key features:
 * - Execution report generation
 * - Policy decision log generation
 * - State snapshot packaging
 * - Manifest creation
 */
export class ArtifactGenerator {
  private readonly simulationId: SimulationId;
  private readonly config: ArtifactConfig;
  private readonly getTime: () => ISOTimestamp;
  private readonly reportGenerator: ReportGenerator;
  private readonly jsonRenderer: JSONRenderer;
  private readonly artifacts: Artifact[] = [];

  constructor(config: ArtifactGeneratorConfig) {
    this.simulationId = config.simulationId;
    this.config = config.artifactConfig;
    this.getTime = config.getTime ?? (() => new Date().toISOString() as ISOTimestamp);

    const format = this.config.formats[0] ?? 'json';
    this.reportGenerator = createReportGenerator({
      format: format as ArtifactFormat,
      getTime: this.getTime,
    });
    this.jsonRenderer = createJSONRenderer({ pretty: true, sortKeys: true });
  }

  /**
   * Generates all configured artifacts from simulation results.
   *
   * @param result - Simulation result
   * @param simulationConfig - Simulation configuration
   * @returns Artifact manifest
   */
  async generate(
    result: SimulationResult,
    simulationConfig: SimulationConfig
  ): Promise<ArtifactManifest> {
    const startTime = performance.now();
    this.artifacts.length = 0;

    // Generate execution report if configured
    if (this.config.generateReport) {
      const reportArtifact = this.reportGenerator.generateArtifact(
        result,
        simulationConfig
      );
      this.artifacts.push(reportArtifact);
    }

    // Generate policy decision log if configured
    if (this.config.generatePolicyLog) {
      const policyLogArtifact = this.generatePolicyLog(result);
      this.artifacts.push(policyLogArtifact);
    }

    // Generate state snapshots if configured
    if (this.config.generateStateSnapshots) {
      // State snapshots would be generated from the state manager
      // This is a placeholder for the integration
    }

    // Generate trace if configured
    if (this.config.generateTrace) {
      const traceArtifact = this.generateTrace(result);
      this.artifacts.push(traceArtifact);
    }

    // Generate configuration archive
    const configArtifact = this.generateConfigArchive(simulationConfig);
    this.artifacts.push(configArtifact);

    // Generate audit trail
    const auditArtifact = this.generateAuditTrail(result);
    this.artifacts.push(auditArtifact);

    // Create manifest
    const manifest = this.createManifest();

    // Record generation time
    const generationTimeMs = performance.now() - startTime;

    return manifest;
  }

  /**
   * Generates policy decision log artifact.
   */
  private generatePolicyLog(result: SimulationResult): Artifact {
    const policyLog = {
      simulationId: result.simulationId,
      generatedAt: this.getTime(),
      policiesEvaluated: result.policyResult.policiesEvaluated,
      decisionCounts: result.policyResult.decisionCounts,
      violations: result.policyResult.violations,
      policyResults: result.policyResult.policyResults,
      complianceScore: result.policyResult.complianceScore,
    };

    const rendered = this.jsonRenderer.render(policyLog);

    return {
      artifactId: createArtifactId(),
      simulationId: this.simulationId,
      type: 'policy_decision_log',
      format: 'json',
      createdAt: this.getTime(),
      contentHash: rendered.contentHash,
      sizeBytes: rendered.sizeBytes,
      location: {
        storageType: 'inline',
        uri: `data:application/json;base64,${Buffer.from(rendered.content).toString('base64')}`,
      },
      metadata: {
        title: 'Policy Decision Log',
        description: `Policy decisions for simulation ${this.simulationId}`,
        mimeType: 'application/json',
      },
    };
  }

  /**
   * Generates execution trace artifact.
   */
  private generateTrace(result: SimulationResult): Artifact {
    const trace = {
      simulationId: result.simulationId,
      traceId: result.traceRef.traceId,
      format: result.traceRef.format,
      timing: result.timing,
      metrics: result.metrics,
    };

    const rendered = this.jsonRenderer.render(trace);

    return {
      artifactId: createArtifactId(),
      simulationId: this.simulationId,
      type: 'execution_trace',
      format: 'json',
      createdAt: this.getTime(),
      contentHash: rendered.contentHash,
      sizeBytes: rendered.sizeBytes,
      location: {
        storageType: 'inline',
        uri: `data:application/json;base64,${Buffer.from(rendered.content).toString('base64')}`,
      },
      metadata: {
        title: 'Execution Trace',
        description: `Execution trace for simulation ${this.simulationId}`,
        mimeType: 'application/json',
      },
    };
  }

  /**
   * Generates configuration archive artifact.
   */
  private generateConfigArchive(config: SimulationConfig): Artifact {
    // Sanitize config (remove any sensitive data)
    const sanitizedConfig = {
      simulationId: config.simulationId,
      scenario: config.scenario,
      policies: config.policies,
      resourceLimits: config.resourceLimits,
      timing: config.timing,
      dataSources: config.dataSources.map((ds) => ({
        type: ds.type,
        id: ds.id,
        refreshPolicy: ds.refreshPolicy,
        // Omit config which may contain credentials
      })),
      artifactConfig: config.artifactConfig,
      observability: config.observability,
      metadata: config.metadata,
    };

    const rendered = this.jsonRenderer.render(sanitizedConfig);

    return {
      artifactId: createArtifactId(),
      simulationId: this.simulationId,
      type: 'configuration_bundle',
      format: 'json',
      createdAt: this.getTime(),
      contentHash: rendered.contentHash,
      sizeBytes: rendered.sizeBytes,
      location: {
        storageType: 'inline',
        uri: `data:application/json;base64,${Buffer.from(rendered.content).toString('base64')}`,
      },
      metadata: {
        title: 'Configuration Archive',
        description: `Configuration for simulation ${this.simulationId}`,
        mimeType: 'application/json',
      },
    };
  }

  /**
   * Generates audit trail artifact.
   */
  private generateAuditTrail(result: SimulationResult): Artifact {
    const auditTrail = {
      simulationId: result.simulationId,
      generatedAt: this.getTime(),
      startTime: result.timing.startTime,
      endTime: result.timing.endTime,
      status: result.status,
      engineVersion: result.metadata.engineVersion,
      resultHash: result.metadata.resultHash,
      stepCount: result.scenarioResult.coverage.stepsExecuted,
      policyEvaluations: result.policyResult.policiesEvaluated,
      violations: result.policyResult.violations.length,
      determinismVerified: result.metrics.determinismVerified,
    };

    const rendered = this.jsonRenderer.render(auditTrail);

    return {
      artifactId: createArtifactId(),
      simulationId: this.simulationId,
      type: 'audit_trail',
      format: 'json',
      createdAt: this.getTime(),
      contentHash: rendered.contentHash,
      sizeBytes: rendered.sizeBytes,
      location: {
        storageType: 'inline',
        uri: `data:application/json;base64,${Buffer.from(rendered.content).toString('base64')}`,
      },
      metadata: {
        title: 'Audit Trail',
        description: `Audit trail for simulation ${this.simulationId}`,
        mimeType: 'application/json',
      },
    };
  }

  /**
   * Creates the artifact manifest.
   */
  private createManifest(): ArtifactManifest {
    const totalSizeBytes = this.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

    const checksums: Record<string, string> = {};
    for (const artifact of this.artifacts) {
      checksums[artifact.artifactId] = artifact.contentHash.value;
    }

    const manifestData = {
      simulationId: this.simulationId,
      generatedAt: this.getTime(),
      artifactCount: this.artifacts.length,
      totalSizeBytes,
      checksums,
    };

    const manifestHash = createContentHashFromObject(manifestData);

    return {
      simulationId: this.simulationId,
      generatedAt: this.getTime(),
      artifacts: [...this.artifacts],
      totalSizeBytes,
      checksums,
      manifestHash,
    };
  }

  /**
   * Gets the generated artifacts.
   */
  getArtifacts(): ReadonlyArray<Artifact> {
    return this.artifacts;
  }

  /**
   * Gets an artifact by ID.
   */
  getArtifact(artifactId: ArtifactId): Artifact | undefined {
    return this.artifacts.find((a) => a.artifactId === artifactId);
  }

  /**
   * Gets an artifact by type.
   */
  getArtifactByType(type: ArtifactType): Artifact | undefined {
    return this.artifacts.find((a) => a.type === type);
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an artifact generator.
 */
export function createArtifactGenerator(
  config: ArtifactGeneratorConfig
): ArtifactGenerator {
  return new ArtifactGenerator(config);
}
