/**
 * Artifact types for the Agentics Simulation Engine.
 *
 * Contract-surface types are re-exported from @agentics/contracts.
 * Local-only types (reports, manifests, etc.) stay here.
 *
 * @module types/artifact
 */

// Contract types (canonical in @agentics/contracts)
export type {
  ArtifactType,
  ArtifactFormat,
  ArtifactStorageType,
  ArtifactLocation,
  ArtifactMetadata,
  Artifact,
  ArtifactSummary,
  ArtifactManifest,
} from '@agentics/contracts';

// ============================================================================
// LOCAL-ONLY TYPES (not part of cross-service contracts)
// ============================================================================

import type {
  SimulationId,
  ArtifactId,
  ISOTimestamp,
  ContentHash,
  ArtifactType,
  ArtifactFormat,
  ArtifactStorageType,
} from '@agentics/contracts';

// ============================================================================
// EXECUTION REPORT
// ============================================================================

/**
 * Header for an execution report.
 */
export interface ReportHeader {
  readonly title: string;
  readonly simulationId: SimulationId;
  readonly generatedAt: ISOTimestamp;
  readonly scenarioName: string;
  readonly scenarioVersion: string;
  readonly engineVersion: string;
}

/**
 * Executive summary for a report.
 */
export interface ExecutiveSummary {
  readonly overallStatus: 'success' | 'partial_success' | 'failure';
  readonly keyFindings: ReadonlyArray<{
    readonly label: string;
    readonly value: string | number;
    readonly trend?: 'up' | 'down' | 'stable';
  }>;
  readonly riskAssessment: 'low' | 'medium' | 'high' | 'critical';
  readonly complianceScore: number;
  readonly primaryRecommendation?: string;
}

/**
 * A section in a report.
 */
export interface ReportSection {
  readonly id: string;
  readonly title: string;
  readonly content: unknown;
  readonly subsections?: ReadonlyArray<ReportSection>;
}

/**
 * Full execution report.
 */
export interface ExecutionReport {
  readonly header: ReportHeader;
  readonly executiveSummary: ExecutiveSummary;
  readonly sections: ReadonlyArray<ReportSection>;
  readonly appendices?: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly content: unknown;
  }>;
}

// ============================================================================
// DEPLOYMENT MANIFEST
// ============================================================================

/**
 * Metadata for a deployment manifest.
 */
export interface DeploymentManifestMetadata {
  readonly name: string;
  readonly simulationSource: SimulationId;
  readonly generatedAt: ISOTimestamp;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

/**
 * Infrastructure configuration in a deployment manifest.
 */
export interface InfrastructureConfig {
  readonly provider: 'kubernetes' | 'terraform' | 'cloudformation' | 'pulumi';
  readonly version: string;
  readonly resources: ReadonlyArray<{
    readonly type: string;
    readonly name: string;
    readonly config: Readonly<Record<string, unknown>>;
  }>;
}

/**
 * Rollback procedure in a deployment manifest.
 */
export interface RollbackProcedure {
  readonly trigger: string;
  readonly steps: ReadonlyArray<{
    readonly order: number;
    readonly action: string;
    readonly config: Readonly<Record<string, unknown>>;
  }>;
  readonly timeout: string;
}

/**
 * Full deployment manifest.
 */
export interface DeploymentManifest {
  readonly apiVersion: string;
  readonly kind: 'SimulationDeploymentManifest';
  readonly metadata: DeploymentManifestMetadata;
  readonly infrastructure?: InfrastructureConfig;
  readonly featureFlags?: Readonly<Record<string, boolean>>;
  readonly rollback?: RollbackProcedure;
  readonly monitoring?: {
    readonly metrics: ReadonlyArray<string>;
    readonly alerts: ReadonlyArray<{
      readonly name: string;
      readonly condition: string;
      readonly severity: string;
    }>;
  };
}

// ============================================================================
// POLICY DECISION LOG
// ============================================================================

/**
 * Entry in the policy decision log.
 */
export interface PolicyDecisionLogEntry {
  readonly timestamp: ISOTimestamp;
  readonly policyId: string;
  readonly policyName: string;
  readonly ruleId?: string;
  readonly outcome: 'allow' | 'deny' | 'warn' | 'require_approval';
  readonly reason: string;
  readonly context: {
    readonly actionType: string;
    readonly resourceType: string;
    readonly stepId?: string;
  };
  readonly evaluationTimeMs: number;
}

/**
 * Full policy decision log.
 */
export interface PolicyDecisionLog {
  readonly simulationId: SimulationId;
  readonly generatedAt: ISOTimestamp;
  readonly totalDecisions: number;
  readonly outcomeBreakdown: Readonly<Record<string, number>>;
  readonly entries: ReadonlyArray<PolicyDecisionLogEntry>;
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

/**
 * Entry in the audit trail.
 */
export interface AuditTrailEntry {
  readonly eventId: string;
  readonly timestamp: ISOTimestamp;
  readonly eventType: string;
  readonly actor: {
    readonly type: string;
    readonly id: string;
  };
  readonly action: string;
  readonly resource?: {
    readonly type: string;
    readonly id: string;
  };
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly details?: Readonly<Record<string, unknown>>;
  readonly previousEntryHash?: string;
  readonly entryHash: string;
}

/**
 * Full audit trail with cryptographic chain.
 */
export interface AuditTrail {
  readonly simulationId: SimulationId;
  readonly startTime: ISOTimestamp;
  readonly endTime: ISOTimestamp;
  readonly entries: ReadonlyArray<AuditTrailEntry>;
  readonly chainIntegrity: {
    readonly verified: boolean;
    readonly firstEntryHash: string;
    readonly lastEntryHash: string;
  };
}

// ============================================================================
// REPORT SUMMARY AND DETAILS
// ============================================================================

/**
 * Summary section of an execution report.
 */
export interface ReportSummary {
  readonly outcome: 'success' | 'partial_success' | 'failure' | 'error' | 'timeout' | 'cancelled';
  readonly durationMs: number;
  readonly stepsExecuted: number;
  readonly stepsPassed: number;
  readonly stepsFailed: number;
  readonly policiesEvaluated: number;
  readonly policyViolations: number;
  readonly complianceScore: number;
}

/**
 * Detailed results section of an execution report.
 */
export interface ReportDetails {
  readonly timing: {
    readonly startTime: ISOTimestamp;
    readonly endTime: ISOTimestamp;
    readonly durationMs: number;
  };
  readonly scenarioResult?: unknown;
  readonly policyResult?: unknown;
  readonly metrics?: unknown;
}

/**
 * Recommendation for improvement.
 */
export interface ReportRecommendation {
  readonly id: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly category: 'reliability' | 'compliance' | 'performance' | 'coverage';
  readonly title: string;
  readonly description: string;
  readonly impact: string;
  readonly action: string;
}

// ============================================================================
// ARTIFACT GENERATION CONFIG
// ============================================================================

/**
 * Configuration for generating a specific artifact.
 */
export interface ArtifactGenerationConfig {
  readonly type: ArtifactType;
  readonly format: ArtifactFormat;
  readonly enabled: boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Request to generate artifacts.
 */
export interface ArtifactGenerationRequest {
  readonly simulationId: SimulationId;
  readonly artifacts: ReadonlyArray<ArtifactGenerationConfig>;
  readonly signArtifacts: boolean;
  readonly storageConfig: {
    readonly type: ArtifactStorageType;
    readonly basePath: string;
  };
}
