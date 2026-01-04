/**
 * CSV Format Renderer.
 *
 * Renders tabular data to CSV format.
 *
 * @module artifact/formats/csv
 */

import type { ContentHash } from '../../types/common.js';
import { createContentHash } from '../../utils/hash.js';

// ============================================================================
// CSV RENDER OPTIONS
// ============================================================================

/**
 * Options for CSV rendering.
 */
export interface CSVRenderOptions {
  /** Field delimiter (default: ,) */
  readonly delimiter?: string;
  /** Line ending (default: \n) */
  readonly lineEnding?: string;
  /** Quote character (default: ") */
  readonly quote?: string;
  /** Include header row */
  readonly includeHeader?: boolean;
  /** Columns to include (if not specified, all columns are included) */
  readonly columns?: ReadonlyArray<string>;
  /** Column headers to use (maps column name to header) */
  readonly headers?: Readonly<Record<string, string>>;
}

// ============================================================================
// CSV RENDER RESULT
// ============================================================================

/**
 * Result of CSV rendering.
 */
export interface CSVRenderResult {
  readonly content: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly contentHash: ContentHash;
  readonly rowCount: number;
  readonly columnCount: number;
}

// ============================================================================
// CSV RENDERER CLASS
// ============================================================================

/**
 * Renders tabular data to CSV format.
 */
export class CSVRenderer {
  private readonly options: Required<Omit<CSVRenderOptions, 'columns' | 'headers'>> &
    Pick<CSVRenderOptions, 'columns' | 'headers'>;

  constructor(options: CSVRenderOptions = {}) {
    this.options = {
      delimiter: ',',
      lineEnding: '\n',
      quote: '"',
      includeHeader: true,
      ...options,
    };
  }

  /**
   * Renders an array of objects to CSV.
   *
   * @param rows - Array of objects to render
   * @returns Render result
   */
  render(rows: ReadonlyArray<Record<string, unknown>>): CSVRenderResult {
    if (rows.length === 0) {
      return {
        content: '',
        mimeType: 'text/csv',
        sizeBytes: 0,
        contentHash: createContentHash(''),
        rowCount: 0,
        columnCount: 0,
      };
    }

    // Determine columns
    const columns = this.options.columns ?? this.extractColumns(rows);
    const lines: string[] = [];

    // Add header row
    if (this.options.includeHeader) {
      const headerRow = columns.map((col) => {
        const header = this.options.headers?.[col] ?? col;
        return this.escapeField(header);
      });
      lines.push(headerRow.join(this.options.delimiter));
    }

    // Add data rows
    for (const row of rows) {
      const dataRow = columns.map((col) => {
        const value = row[col];
        return this.escapeField(this.formatValue(value));
      });
      lines.push(dataRow.join(this.options.delimiter));
    }

    const content = lines.join(this.options.lineEnding);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const contentHash = createContentHash(content);

    return {
      content,
      mimeType: 'text/csv',
      sizeBytes,
      contentHash,
      rowCount: rows.length,
      columnCount: columns.length,
    };
  }

  /**
   * Extracts unique column names from all rows.
   */
  private extractColumns(rows: ReadonlyArray<Record<string, unknown>>): string[] {
    const columnSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        columnSet.add(key);
      }
    }
    return Array.from(columnSet).sort();
  }

  /**
   * Formats a value for CSV output.
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Escapes a field for CSV output.
   */
  private escapeField(value: string): string {
    const { delimiter, quote } = this.options;

    // Check if quoting is needed
    const needsQuoting =
      value.includes(delimiter) ||
      value.includes(quote) ||
      value.includes('\n') ||
      value.includes('\r');

    if (!needsQuoting) {
      return value;
    }

    // Escape quotes by doubling them
    const escaped = value.replace(new RegExp(quote, 'g'), quote + quote);
    return `${quote}${escaped}${quote}`;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a CSV renderer.
 */
export function createCSVRenderer(options?: CSVRenderOptions): CSVRenderer {
  return new CSVRenderer(options);
}

/**
 * Renders data to CSV format.
 */
export function renderCSV(
  rows: ReadonlyArray<Record<string, unknown>>,
  options?: CSVRenderOptions
): CSVRenderResult {
  const renderer = new CSVRenderer(options);
  return renderer.render(rows);
}
