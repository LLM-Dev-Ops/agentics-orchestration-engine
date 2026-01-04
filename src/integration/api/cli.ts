/**
 * CLI Command Interfaces.
 *
 * Defines the interface for CLI command execution.
 * These types are used by CLI implementations to interact
 * with the simulation engine.
 *
 * @module integration/api/cli
 */

import type {
  SimulationId,
  ISOTimestamp,
} from '../../types/common.js';
import type {
  SimulationConfig,
  SimulationStatus,
} from '../../types/simulation.js';
import type { ArtifactType, ArtifactFormat } from '../../types/artifact.js';

// ============================================================================
// CLI COMMAND TYPES
// ============================================================================

/**
 * Available CLI commands.
 */
export type CLICommand =
  | 'run'
  | 'validate'
  | 'status'
  | 'list'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'export'
  | 'inspect'
  | 'version';

/**
 * Output format for CLI responses.
 */
export type CLIOutputFormat = 'json' | 'yaml' | 'table' | 'plain';

/**
 * Common options for all CLI commands.
 */
export interface CLICommonOptions {
  /** Output format */
  readonly format?: CLIOutputFormat;
  /** Verbose output */
  readonly verbose?: boolean;
  /** Quiet mode (minimal output) */
  readonly quiet?: boolean;
  /** Config file path */
  readonly configFile?: string;
  /** Enable color output */
  readonly color?: boolean;
}

// ============================================================================
// RUN COMMAND
// ============================================================================

/**
 * Options for the 'run' command.
 */
export interface CLIRunOptions extends CLICommonOptions {
  /** Scenario file path */
  readonly scenario: string;
  /** Policy files or directories */
  readonly policies?: ReadonlyArray<string>;
  /** Override parameters */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Output directory for artifacts */
  readonly output?: string;
  /** Watch mode (re-run on file changes) */
  readonly watch?: boolean;
  /** Dry run (validate only) */
  readonly dryRun?: boolean;
  /** Maximum execution time in seconds */
  readonly timeout?: number;
  /** Random seed for determinism */
  readonly seed?: number;
}

/**
 * Result of the 'run' command.
 */
export interface CLIRunResult {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Final status */
  readonly status: SimulationStatus;
  /** Execution duration in milliseconds */
  readonly durationMs: number;
  /** Steps executed */
  readonly stepsExecuted: number;
  /** Steps passed */
  readonly stepsPassed: number;
  /** Steps failed */
  readonly stepsFailed: number;
  /** Policy violations */
  readonly policyViolations: number;
  /** Compliance score */
  readonly complianceScore: number;
  /** Output directory */
  readonly outputDir?: string;
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// VALIDATE COMMAND
// ============================================================================

/**
 * Options for the 'validate' command.
 */
export interface CLIValidateOptions extends CLICommonOptions {
  /** Files to validate */
  readonly files: ReadonlyArray<string>;
  /** Validation type */
  readonly type?: 'scenario' | 'policy' | 'config' | 'all';
  /** Strict mode (treat warnings as errors) */
  readonly strict?: boolean;
}

/**
 * Result of the 'validate' command.
 */
export interface CLIValidateResult {
  /** Overall validity */
  readonly valid: boolean;
  /** Validation errors */
  readonly errors: ReadonlyArray<{
    readonly file: string;
    readonly line?: number;
    readonly column?: number;
    readonly message: string;
    readonly severity: 'error' | 'warning';
  }>;
  /** Summary counts */
  readonly summary: {
    readonly filesChecked: number;
    readonly errorsFound: number;
    readonly warningsFound: number;
  };
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// STATUS COMMAND
// ============================================================================

/**
 * Options for the 'status' command.
 */
export interface CLIStatusOptions extends CLICommonOptions {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Follow status updates */
  readonly follow?: boolean;
  /** Include metrics */
  readonly metrics?: boolean;
}

/**
 * Result of the 'status' command.
 */
export interface CLIStatusResult {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Current status */
  readonly status: SimulationStatus;
  /** Progress percentage */
  readonly progress: number;
  /** Current phase */
  readonly phase?: string;
  /** Elapsed time */
  readonly elapsedMs: number;
  /** Metrics if requested */
  readonly metrics?: {
    readonly stepsExecuted: number;
    readonly stepsRemaining: number;
    readonly policiesEvaluated: number;
    readonly memoryUsedMB: number;
  };
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// LIST COMMAND
// ============================================================================

/**
 * Options for the 'list' command.
 */
export interface CLIListOptions extends CLICommonOptions {
  /** Filter by status */
  readonly status?: SimulationStatus;
  /** Show last N simulations */
  readonly last?: number;
  /** Show all (no limit) */
  readonly all?: boolean;
}

/**
 * Result of the 'list' command.
 */
export interface CLIListResult {
  /** Simulations */
  readonly simulations: ReadonlyArray<{
    readonly simulationId: SimulationId;
    readonly status: SimulationStatus;
    readonly createdAt: ISOTimestamp;
    readonly scenarioName?: string;
    readonly durationMs?: number;
  }>;
  /** Total count */
  readonly totalCount: number;
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// EXPORT COMMAND
// ============================================================================

/**
 * Options for the 'export' command.
 */
export interface CLIExportOptions extends CLICommonOptions {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** Artifact types to export */
  readonly types?: ReadonlyArray<ArtifactType>;
  /** Output format */
  readonly artifactFormat?: ArtifactFormat;
  /** Output directory */
  readonly output: string;
  /** Overwrite existing files */
  readonly overwrite?: boolean;
}

/**
 * Result of the 'export' command.
 */
export interface CLIExportResult {
  /** Exported artifacts */
  readonly artifacts: ReadonlyArray<{
    readonly type: ArtifactType;
    readonly path: string;
    readonly sizeBytes: number;
  }>;
  /** Total size */
  readonly totalSizeBytes: number;
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// INSPECT COMMAND
// ============================================================================

/**
 * Options for the 'inspect' command.
 */
export interface CLIInspectOptions extends CLICommonOptions {
  /** Simulation ID */
  readonly simulationId: SimulationId;
  /** What to inspect */
  readonly target: 'result' | 'config' | 'trace' | 'artifacts' | 'policies';
  /** Output as raw JSON */
  readonly raw?: boolean;
}

/**
 * Result of the 'inspect' command.
 */
export interface CLIInspectResult {
  /** Inspected data */
  readonly data: unknown;
  /** Exit code */
  readonly exitCode: number;
}

// ============================================================================
// CLI HANDLER INTERFACE
// ============================================================================

/**
 * CLI command handler interface.
 *
 * Implementations handle specific CLI commands and return
 * structured results.
 */
export interface CLIHandler {
  /**
   * Runs a simulation.
   *
   * @param options - Run options
   * @returns Run result
   */
  run(options: CLIRunOptions): Promise<CLIRunResult>;

  /**
   * Validates configuration files.
   *
   * @param options - Validate options
   * @returns Validation result
   */
  validate(options: CLIValidateOptions): Promise<CLIValidateResult>;

  /**
   * Gets simulation status.
   *
   * @param options - Status options
   * @returns Status result
   */
  status(options: CLIStatusOptions): Promise<CLIStatusResult>;

  /**
   * Lists simulations.
   *
   * @param options - List options
   * @returns List result
   */
  list(options: CLIListOptions): Promise<CLIListResult>;

  /**
   * Pauses a simulation.
   *
   * @param simulationId - Simulation to pause
   */
  pause(simulationId: SimulationId): Promise<void>;

  /**
   * Resumes a simulation.
   *
   * @param simulationId - Simulation to resume
   */
  resume(simulationId: SimulationId): Promise<void>;

  /**
   * Cancels a simulation.
   *
   * @param simulationId - Simulation to cancel
   * @param reason - Cancellation reason
   */
  cancel(simulationId: SimulationId, reason: string): Promise<void>;

  /**
   * Exports simulation artifacts.
   *
   * @param options - Export options
   * @returns Export result
   */
  export(options: CLIExportOptions): Promise<CLIExportResult>;

  /**
   * Inspects simulation data.
   *
   * @param options - Inspect options
   * @returns Inspect result
   */
  inspect(options: CLIInspectOptions): Promise<CLIInspectResult>;

  /**
   * Gets version information.
   *
   * @returns Version string
   */
  version(): string;
}

// ============================================================================
// CLI OUTPUT HELPERS
// ============================================================================

/**
 * Formats CLI output based on format option.
 */
export interface CLIOutputFormatter {
  /**
   * Formats data for output.
   *
   * @param data - Data to format
   * @param format - Output format
   * @returns Formatted string
   */
  format(data: unknown, format: CLIOutputFormat): string;

  /**
   * Formats an error for output.
   *
   * @param error - Error to format
   * @param format - Output format
   * @returns Formatted error string
   */
  formatError(error: Error, format: CLIOutputFormat): string;

  /**
   * Formats progress updates.
   *
   * @param progress - Progress percentage (0-100)
   * @param message - Progress message
   * @returns Formatted progress string
   */
  formatProgress(progress: number, message: string): string;
}

/**
 * Exit codes used by CLI commands.
 */
export const CLI_EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  VALIDATION_ERROR: 2,
  EXECUTION_ERROR: 3,
  TIMEOUT_ERROR: 4,
  CANCELLED: 5,
  NOT_FOUND: 6,
  PERMISSION_DENIED: 7,
} as const;

export type CLIExitCode = typeof CLI_EXIT_CODES[keyof typeof CLI_EXIT_CODES];
