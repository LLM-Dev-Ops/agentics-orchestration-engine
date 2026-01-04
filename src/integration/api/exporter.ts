/**
 * Deployment Exporter API Interface.
 *
 * Defines the interface for exporting simulation results as
 * deployment-ready artifacts and manifests.
 *
 * @module integration/api/exporter
 */

import type {
  SimulationId,
  ISOTimestamp,
} from '../../types/common.js';
import type { SimulationResult } from '../../types/simulation.js';
import type {
  Artifact,
  ArtifactManifest,
  ArtifactType,
  ArtifactFormat,
  DeploymentManifest,
} from '../../types/artifact.js';

// ============================================================================
// EXPORT REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Export format options.
 */
export interface ExportFormatOptions {
  /** Output format */
  readonly format: ArtifactFormat;
  /** Pretty print output */
  readonly prettyPrint?: boolean;
  /** Include comments/annotations */
  readonly includeComments?: boolean;
  /** Custom template path */
  readonly templatePath?: string;
}

/**
 * Request to export simulation results.
 */
export interface ExportResultsRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Artifact types to export */
  readonly artifactTypes: ReadonlyArray<ArtifactType>;
  /** Format options */
  readonly formatOptions?: ExportFormatOptions;
  /** Output destination */
  readonly destination: ExportDestination;
}

/**
 * Destination for exports.
 */
export type ExportDestination =
  | { type: 'local'; path: string }
  | { type: 's3'; bucket: string; prefix: string; region?: string }
  | { type: 'gcs'; bucket: string; prefix: string; project?: string }
  | { type: 'azure_blob'; container: string; prefix: string; account?: string }
  | { type: 'memory' };

/**
 * Response from export operation.
 */
export interface ExportResultsResponse {
  /** Export ID for tracking */
  readonly exportId: string;
  /** Exported artifacts */
  readonly artifacts: ReadonlyArray<ExportedArtifact>;
  /** Total size in bytes */
  readonly totalSizeBytes: number;
  /** Export timestamp */
  readonly exportedAt: ISOTimestamp;
}

/**
 * Information about an exported artifact.
 */
export interface ExportedArtifact {
  /** Artifact type */
  readonly type: ArtifactType;
  /** Format */
  readonly format: ArtifactFormat;
  /** Location URI */
  readonly uri: string;
  /** Size in bytes */
  readonly sizeBytes: number;
  /** Content hash */
  readonly contentHash: string;
}

/**
 * Request to generate deployment manifest.
 */
export interface GenerateManifestRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Target infrastructure */
  readonly targetInfrastructure: InfrastructureTarget;
  /** Manifest options */
  readonly options?: DeploymentManifestOptions;
}

/**
 * Infrastructure target for deployment.
 */
export type InfrastructureTarget =
  | { type: 'kubernetes'; namespace?: string; cluster?: string }
  | { type: 'terraform'; workspace?: string; backend?: string }
  | { type: 'cloudformation'; stackName?: string; region?: string }
  | { type: 'pulumi'; stack?: string; organization?: string };

/**
 * Options for deployment manifest generation.
 */
export interface DeploymentManifestOptions {
  /** Include rollback procedures */
  readonly includeRollback?: boolean;
  /** Include monitoring configuration */
  readonly includeMonitoring?: boolean;
  /** Add custom labels */
  readonly labels?: Readonly<Record<string, string>>;
  /** Add custom annotations */
  readonly annotations?: Readonly<Record<string, string>>;
  /** Feature flags to include */
  readonly featureFlags?: Readonly<Record<string, boolean>>;
}

/**
 * Response from manifest generation.
 */
export interface GenerateManifestResponse {
  /** Generated manifest */
  readonly manifest: DeploymentManifest;
  /** Rendered content */
  readonly renderedContent: string;
  /** Content hash */
  readonly contentHash: string;
  /** Validation result */
  readonly validation: ManifestValidationResult;
}

/**
 * Result of manifest validation.
 */
export interface ManifestValidationResult {
  /** Whether manifest is valid */
  readonly isValid: boolean;
  /** Validation errors */
  readonly errors: ReadonlyArray<{
    readonly path: string;
    readonly message: string;
    readonly severity: 'error' | 'warning';
  }>;
  /** Validation warnings */
  readonly warnings: ReadonlyArray<{
    readonly path: string;
    readonly message: string;
  }>;
}

/**
 * Request to download an artifact.
 */
export interface DownloadArtifactRequest {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Artifact type to download */
  readonly artifactType: ArtifactType;
  /** Preferred format */
  readonly format?: ArtifactFormat;
}

/**
 * Response with artifact content.
 */
export interface DownloadArtifactResponse {
  /** Artifact metadata */
  readonly artifact: Artifact;
  /** Content as buffer */
  readonly content: Buffer;
  /** MIME type */
  readonly mimeType: string;
}

/**
 * Request to validate export configuration.
 */
export interface ValidateExportRequest {
  /** Destination to validate */
  readonly destination: ExportDestination;
  /** Check write permissions */
  readonly checkPermissions?: boolean;
}

/**
 * Response from export validation.
 */
export interface ValidateExportResponse {
  /** Whether destination is valid */
  readonly isValid: boolean;
  /** Can write to destination */
  readonly canWrite: boolean;
  /** Available space in bytes (if applicable) */
  readonly availableSpaceBytes?: number;
  /** Validation messages */
  readonly messages: ReadonlyArray<string>;
}

// ============================================================================
// EXPORTER INTERFACE
// ============================================================================

/**
 * Deployment Exporter API for exporting simulation results.
 *
 * This interface defines operations for exporting simulation results
 * as deployment-ready artifacts, manifests, and configurations.
 */
export interface DeploymentExporterAPI {
  /**
   * Exports simulation results.
   *
   * @param request - Export request
   * @returns Export response
   */
  exportResults(request: ExportResultsRequest): Promise<ExportResultsResponse>;

  /**
   * Generates a deployment manifest.
   *
   * @param request - Manifest generation request
   * @returns Generated manifest
   */
  generateManifest(request: GenerateManifestRequest): Promise<GenerateManifestResponse>;

  /**
   * Downloads a specific artifact.
   *
   * @param request - Download request
   * @returns Artifact content
   */
  downloadArtifact(request: DownloadArtifactRequest): Promise<DownloadArtifactResponse>;

  /**
   * Gets available artifacts for a simulation.
   *
   * @param simulationId - Simulation ID
   * @returns Artifact manifest
   */
  getAvailableArtifacts(simulationId: SimulationId): Promise<ArtifactManifest>;

  /**
   * Validates an export destination.
   *
   * @param request - Validation request
   * @returns Validation result
   */
  validateDestination(request: ValidateExportRequest): Promise<ValidateExportResponse>;

  /**
   * Cleans up exported artifacts.
   *
   * @param simulationId - Simulation ID
   * @param destination - Destination to clean
   */
  cleanup(simulationId: SimulationId, destination?: ExportDestination): Promise<void>;
}

// ============================================================================
// EXPORT EVENTS
// ============================================================================

/**
 * Events emitted during export operations.
 */
export type ExportEvent =
  | { type: 'export_started'; exportId: string; simulationId: SimulationId; timestamp: ISOTimestamp }
  | { type: 'artifact_exported'; exportId: string; artifactType: ArtifactType; sizeBytes: number; timestamp: ISOTimestamp }
  | { type: 'export_progress'; exportId: string; progress: number; timestamp: ISOTimestamp }
  | { type: 'export_completed'; exportId: string; totalArtifacts: number; totalSizeBytes: number; timestamp: ISOTimestamp }
  | { type: 'export_failed'; exportId: string; error: string; timestamp: ISOTimestamp };

/**
 * Listener for export events.
 */
export type ExportEventListener = (event: ExportEvent) => void;

/**
 * Extended exporter with event subscription.
 */
export interface DeploymentExporterAPIWithEvents extends DeploymentExporterAPI {
  /**
   * Subscribes to export events.
   *
   * @param listener - Event listener
   * @returns Unsubscribe function
   */
  subscribe(listener: ExportEventListener): () => void;
}
