/**
 * Execution Report Generator.
 *
 * Generates execution reports from simulation results.
 *
 * @module artifact/report
 */

import type {
  SimulationId,
  ArtifactId,
  ISOTimestamp,
} from '../types/common.js';
import type { SimulationResult, SimulationConfig } from '../types/simulation.js';
import type {
  ExecutionReport,
  ReportHeader,
  ReportSummary,
  ReportDetails,
  ReportRecommendation,
  ExecutiveSummary,
  ReportSection,
  Artifact,
  ArtifactFormat,
} from '../types/artifact.js';
import { createArtifactId } from '../types/common.js';
import { JSONRenderer, createJSONRenderer } from './formats/json.js';
import { YAMLRenderer, createYAMLRenderer } from './formats/yaml.js';

// ============================================================================
// REPORT GENERATOR OPTIONS
// ============================================================================

/**
 * Options for report generation.
 */
export interface ReportGeneratorOptions {
  /** Include detailed step results */
  readonly includeStepDetails?: boolean;
  /** Include policy decision details */
  readonly includePolicyDetails?: boolean;
  /** Include execution metrics */
  readonly includeMetrics?: boolean;
  /** Include recommendations */
  readonly includeRecommendations?: boolean;
  /** Output format */
  readonly format?: ArtifactFormat;
  /** Time provider */
  readonly getTime?: () => ISOTimestamp;
}

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

/**
 * Generates execution reports from simulation results.
 */
export class ReportGenerator {
  private readonly options: Required<ReportGeneratorOptions>;
  private readonly jsonRenderer: JSONRenderer;
  private readonly yamlRenderer: YAMLRenderer;

  constructor(options: ReportGeneratorOptions = {}) {
    this.options = {
      includeStepDetails: true,
      includePolicyDetails: true,
      includeMetrics: true,
      includeRecommendations: true,
      format: 'json',
      getTime: () => new Date().toISOString() as ISOTimestamp,
      ...options,
    };

    this.jsonRenderer = createJSONRenderer({ pretty: true, sortKeys: true });
    this.yamlRenderer = createYAMLRenderer({ sortKeys: true });
  }

  /**
   * Generates an execution report from simulation results.
   *
   * @param result - Simulation result
   * @param config - Simulation configuration
   * @returns Execution report
   */
  generate(
    result: SimulationResult,
    config: SimulationConfig
  ): ExecutionReport {
    const header = this.generateHeader(result, config);
    const executiveSummary = this.generateExecutiveSummary(result);
    const sections = this.generateSections(result);

    return {
      header,
      executiveSummary,
      sections,
    };
  }

  /**
   * Generates internal summary (used for artifact metadata).
   */
  generateSummary(result: SimulationResult): ReportSummary {
    return this._generateSummary(result);
  }

  /**
   * Generates internal details (used for artifact metadata).
   */
  generateDetails(result: SimulationResult): ReportDetails {
    return this._generateDetails(result);
  }

  /**
   * Generates recommendations (used for artifact metadata).
   */
  getRecommendations(result: SimulationResult): ReportRecommendation[] {
    return this.options.includeRecommendations
      ? this.generateRecommendations(result)
      : [];
  }

  /**
   * Generates and renders an execution report as an artifact.
   *
   * @param result - Simulation result
   * @param config - Simulation configuration
   * @returns Artifact containing the report
   */
  generateArtifact(
    result: SimulationResult,
    config: SimulationConfig
  ): Artifact {
    const report = this.generate(result, config);

    // Render to the configured format
    let content: string;
    let mimeType: string;
    let contentHash;

    if (this.options.format === 'yaml') {
      const rendered = this.yamlRenderer.render(report);
      content = rendered.content;
      mimeType = rendered.mimeType;
      contentHash = rendered.contentHash;
    } else {
      const rendered = this.jsonRenderer.render(report);
      content = rendered.content;
      mimeType = rendered.mimeType;
      contentHash = rendered.contentHash;
    }

    return {
      artifactId: createArtifactId(),
      simulationId: result.simulationId,
      type: 'execution_report',
      format: this.options.format,
      createdAt: this.options.getTime(),
      contentHash,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      location: {
        storageType: 'inline',
        uri: `data:${mimeType};base64,${Buffer.from(content).toString('base64')}`,
      },
      metadata: {
        title: `Execution Report - ${result.simulationId}`,
        description: `Execution report for simulation ${result.simulationId}`,
        mimeType,
      },
    };
  }

  /**
   * Generates report header.
   */
  private generateHeader(
    result: SimulationResult,
    config: SimulationConfig
  ): ReportHeader {
    return {
      title: `Simulation Execution Report`,
      simulationId: result.simulationId,
      generatedAt: this.options.getTime(),
      scenarioName: config.scenario.scenarioId,
      scenarioVersion: config.scenario.version ?? 'unknown',
      engineVersion: result.metadata.engineVersion,
    };
  }

  /**
   * Generates executive summary for the report.
   */
  private generateExecutiveSummary(result: SimulationResult): ExecutiveSummary {
    const failureRate =
      result.scenarioResult.coverage.stepsFailed /
      Math.max(result.scenarioResult.coverage.stepsExecuted, 1);

    let overallStatus: 'success' | 'partial_success' | 'failure';
    if (result.status === 'success' && failureRate === 0) {
      overallStatus = 'success';
    } else if (result.status === 'success' && failureRate < 0.2) {
      overallStatus = 'partial_success';
    } else {
      overallStatus = 'failure';
    }

    let riskAssessment: 'low' | 'medium' | 'high' | 'critical';
    if (result.policyResult.complianceScore >= 90) {
      riskAssessment = 'low';
    } else if (result.policyResult.complianceScore >= 70) {
      riskAssessment = 'medium';
    } else if (result.policyResult.complianceScore >= 50) {
      riskAssessment = 'high';
    } else {
      riskAssessment = 'critical';
    }

    return {
      overallStatus,
      keyFindings: [
        {
          label: 'Steps Executed',
          value: result.scenarioResult.coverage.stepsExecuted,
        },
        {
          label: 'Success Rate',
          value: `${Math.round((1 - failureRate) * 100)}%`,
          trend: failureRate > 0 ? 'down' : 'stable',
        },
        {
          label: 'Policy Violations',
          value: result.policyResult.violations.length,
          trend: result.policyResult.violations.length > 0 ? 'down' : 'stable',
        },
      ],
      riskAssessment,
      complianceScore: result.policyResult.complianceScore,
      primaryRecommendation:
        result.policyResult.violations.length > 0
          ? 'Address policy violations before deployment'
          : undefined,
    };
  }

  /**
   * Generates report sections.
   */
  private generateSections(result: SimulationResult): ReportSection[] {
    const sections: ReportSection[] = [];

    // Execution summary section
    sections.push({
      id: 'execution-summary',
      title: 'Execution Summary',
      content: this._generateSummary(result),
    });

    // Timing section
    sections.push({
      id: 'timing',
      title: 'Timing Details',
      content: result.timing,
    });

    // Scenario results section
    if (this.options.includeStepDetails) {
      sections.push({
        id: 'scenario-results',
        title: 'Scenario Results',
        content: result.scenarioResult,
      });
    }

    // Policy results section
    if (this.options.includePolicyDetails) {
      sections.push({
        id: 'policy-results',
        title: 'Policy Results',
        content: result.policyResult,
      });
    }

    // Metrics section
    if (this.options.includeMetrics) {
      sections.push({
        id: 'metrics',
        title: 'Execution Metrics',
        content: result.metrics,
      });
    }

    // Recommendations section
    if (this.options.includeRecommendations) {
      const recommendations = this.generateRecommendations(result);
      if (recommendations.length > 0) {
        sections.push({
          id: 'recommendations',
          title: 'Recommendations',
          content: recommendations,
        });
      }
    }

    return sections;
  }

  /**
   * Generates internal report summary.
   */
  private _generateSummary(result: SimulationResult): ReportSummary {
    return {
      outcome: result.status,
      durationMs: result.timing.durationMs,
      stepsExecuted: result.scenarioResult.coverage.stepsExecuted,
      stepsPassed: result.scenarioResult.coverage.stepsPassed,
      stepsFailed: result.scenarioResult.coverage.stepsFailed,
      policiesEvaluated: result.policyResult.policiesEvaluated,
      policyViolations: result.policyResult.violations.length,
      complianceScore: result.policyResult.complianceScore,
    };
  }

  /**
   * Generates internal report details.
   */
  private _generateDetails(result: SimulationResult): ReportDetails {
    return {
      timing: result.timing,
      scenarioResult: this.options.includeStepDetails
        ? result.scenarioResult
        : undefined,
      policyResult: this.options.includePolicyDetails
        ? result.policyResult
        : undefined,
      metrics: this.options.includeMetrics ? result.metrics : undefined,
    };
  }

  /**
   * Generates recommendations based on results.
   */
  private generateRecommendations(
    result: SimulationResult
  ): ReportRecommendation[] {
    const recommendations: ReportRecommendation[] = [];

    // Check for high failure rate
    const failureRate =
      result.scenarioResult.coverage.stepsFailed /
      Math.max(result.scenarioResult.coverage.stepsExecuted, 1);

    if (failureRate > 0.2) {
      recommendations.push({
        id: 'high-failure-rate',
        priority: 'high',
        category: 'reliability',
        title: 'High Step Failure Rate',
        description: `${Math.round(failureRate * 100)}% of steps failed during execution.`,
        impact: 'Simulation results may be unreliable.',
        action: 'Review failed steps and fix underlying issues before re-running.',
      });
    }

    // Check for policy violations
    if (result.policyResult.violations.length > 0) {
      const criticalViolations = result.policyResult.violations.filter(
        (v) => v.severity === 'critical'
      );

      if (criticalViolations.length > 0) {
        recommendations.push({
          id: 'critical-policy-violations',
          priority: 'high',
          category: 'compliance',
          title: 'Critical Policy Violations Detected',
          description: `${criticalViolations.length} critical policy violation(s) occurred.`,
          impact: 'Deployment may violate compliance requirements.',
          action: 'Address all critical policy violations before proceeding.',
        });
      }
    }

    // Check for low compliance score
    if (result.policyResult.complianceScore < 80) {
      recommendations.push({
        id: 'low-compliance-score',
        priority: 'medium',
        category: 'compliance',
        title: 'Low Compliance Score',
        description: `Compliance score is ${result.policyResult.complianceScore}% (below 80% threshold).`,
        impact: 'May indicate gaps in policy adherence.',
        action: 'Review policy results and address any compliance gaps.',
      });
    }

    // Check for execution timeout
    if (result.status === 'timeout') {
      recommendations.push({
        id: 'execution-timeout',
        priority: 'medium',
        category: 'performance',
        title: 'Simulation Timeout',
        description: 'The simulation exceeded its time limit.',
        impact: 'Not all steps were executed.',
        action:
          'Consider increasing timeout limits or optimizing scenario steps.',
      });
    }

    // Check for skipped steps
    if (result.scenarioResult.coverage.stepsSkipped > 0) {
      recommendations.push({
        id: 'skipped-steps',
        priority: 'low',
        category: 'coverage',
        title: 'Steps Skipped',
        description: `${result.scenarioResult.coverage.stepsSkipped} step(s) were skipped.`,
        impact: 'Some scenario paths were not tested.',
        action: 'Review skipped steps to ensure coverage is acceptable.',
      });
    }

    return recommendations;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a report generator.
 */
export function createReportGenerator(
  options?: ReportGeneratorOptions
): ReportGenerator {
  return new ReportGenerator(options);
}
