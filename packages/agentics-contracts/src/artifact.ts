/**
 * Artifact contract types.
 *
 * Minimal artifact types required by SimulationResult and core delegation.
 * Full artifact types (reports, manifests, etc.) stay in the engine.
 */

import type {
  SimulationId,
  ArtifactId,
  ISOTimestamp,
  ContentHash,
  Signature,
} from './ids.js';

export type ArtifactType =
  | 'execution_report'
  | 'compliance_report'
  | 'deployment_manifest'
  | 'configuration_bundle'
  | 'execution_trace'
  | 'policy_decision_log'
  | 'timeline_visualization'
  | 'dependency_graph'
  | 'state_snapshot'
  | 'audit_trail'
  | 'custom';

export type ArtifactFormat =
  | 'json'
  | 'yaml'
  | 'html'
  | 'pdf'
  | 'csv'
  | 'parquet'
  | 'zip'
  | 'tar.gz'
  | 'svg'
  | 'dot'
  | 'msgpack';

export type ArtifactStorageType = 'local' | 's3' | 'gcs' | 'azure_blob' | 'inline';

export interface ArtifactLocation {
  readonly storageType: ArtifactStorageType;
  readonly uri: string;
  readonly credentialsRef?: string;
}

export interface ArtifactMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly mimeType?: string;
  readonly encoding?: string;
  readonly language?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface Artifact {
  readonly artifactId: ArtifactId;
  readonly simulationId: SimulationId;
  readonly type: ArtifactType;
  readonly format: ArtifactFormat;
  readonly createdAt: ISOTimestamp;
  readonly contentHash: ContentHash;
  readonly sizeBytes: number;
  readonly location: ArtifactLocation;
  readonly metadata: ArtifactMetadata;
  readonly signature?: Signature;
  readonly expiresAt?: ISOTimestamp;
}

export interface ArtifactSummary {
  readonly artifactId: ArtifactId;
  readonly type: ArtifactType;
  readonly format: ArtifactFormat;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
}

export interface ArtifactManifest {
  readonly simulationId: SimulationId;
  readonly generatedAt: ISOTimestamp;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly totalSizeBytes: number;
  readonly checksums: Readonly<Record<string, string>>;
  readonly manifestHash: ContentHash;
}
