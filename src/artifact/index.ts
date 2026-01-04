/**
 * Artifact generation module.
 *
 * Provides artifact generation, report creation, and format rendering
 * for simulation outputs.
 *
 * @module artifact
 */

// Format renderers
export * from './formats/index.js';

// Report generation
export {
  ReportGenerator,
  createReportGenerator,
  type ReportGeneratorOptions,
} from './report.js';

// Artifact generation
export {
  ArtifactGenerator,
  createArtifactGenerator,
  type ArtifactGeneratorConfig,
} from './generator.js';
