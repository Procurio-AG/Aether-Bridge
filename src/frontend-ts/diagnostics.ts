// ============================================================================
// Aether-Lang - Diagnostics Module
// ============================================================================
// Unified diagnostic collector for all frontend stages (Lexer, Parser,
// Semantic Analyzer).  Generates `listing.txt` - an interleaved source
// code / error report for human inspection.
//
// Usage:
//   const bag = new DiagnosticBag(sourceLines);
//   bag.addError(line, column, "Type mismatch ...");
//   bag.importLexerDiagnostics(lexer.diagnostics);
//   bag.importParserDiagnostics(parser.diagnostics);
//   const listing = bag.generateListing();
// ============================================================================

import type { LexDiagnostic }   from "./lexer";
import type { ParseDiagnostic } from "./parser";

// -- Severity ----------------------------------------------------------------
export type Severity = "error" | "warning" | "info";

// -- Diagnostic Entry --------------------------------------------------------
export interface Diagnostic {
  /** Source stage that produced the diagnostic. */
  stage:    "lexer" | "parser" | "analyzer";
  severity: Severity;
  line:     number;
  column:   number;
  message:  string;
}

// ============================================================================
//  DiagnosticBag
// ============================================================================

export class DiagnosticBag {
  /** Original source lines (0-indexed internally, displayed 1-indexed). */
  private readonly sourceLines: string[];
  /** All collected diagnostics, insertion-ordered. */
  public readonly diagnostics: Diagnostic[] = [];

  constructor(sourceLines: string[]) {
    this.sourceLines = sourceLines;
  }

  // -- Adding diagnostics --------------------------------------------------

  /** Add a semantic analysis error. */
  public addError(line: number, column: number, message: string): void {
    this.diagnostics.push({
      stage: "analyzer", severity: "error", line, column, message,
    });
  }

  /** Add a semantic warning. */
  public addWarning(line: number, column: number, message: string): void {
    this.diagnostics.push({
      stage: "analyzer", severity: "warning", line, column, message,
    });
  }

  /** Import all lexer diagnostics. */
  public importLexerDiagnostics(diags: LexDiagnostic[]): void {
    for (const d of diags) {
      this.diagnostics.push({
        stage: "lexer", severity: "error", line: d.line, column: d.column, message: d.message,
      });
    }
  }

  /** Import all parser diagnostics. */
  public importParserDiagnostics(diags: ParseDiagnostic[]): void {
    for (const d of diags) {
      this.diagnostics.push({
        stage: "parser", severity: "error", line: d.line, column: d.column, message: d.message,
      });
    }
  }

  // -- Queries -------------------------------------------------------------

  /** True if no errors (warnings are allowed). */
  public get hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === "error");
  }

  /** Count of errors only. */
  public get errorCount(): number {
    return this.diagnostics.filter(d => d.severity === "error").length;
  }

  /** Count of warnings only. */
  public get warningCount(): number {
    return this.diagnostics.filter(d => d.severity === "warning").length;
  }

  /** Total diagnostic count. */
  public get length(): number {
    return this.diagnostics.length;
  }

  /** Group diagnostics by line number for listing generation. */
  private diagnosticsByLine(): Map<number, Diagnostic[]> {
    const map = new Map<number, Diagnostic[]>();
    for (const d of this.diagnostics) {
      if (!map.has(d.line)) map.set(d.line, []);
      map.get(d.line)!.push(d);
    }
    return map;
  }

  // -- Listing Generation --------------------------------------------------

  /**
   * Generate `listing.txt` content.
   *
   * Interleaves source code lines with error messages:
   * ```
   *   4 | let x: int = 42;
   *   5 | let pi: float = "hello";
   *     |                  ^^^^^^ ERROR [analyzer]: Type mismatch. Cannot assign string to float.
   *   6 | let weights: tensor<f32, [784, 256]>;
   * ```
   */
  public generateListing(): string {
    const byLine   = this.diagnosticsByLine();
    const lines: string[] = [];
    const lineNumWidth = String(this.sourceLines.length).length;

    // Header
    lines.push("+----------------------------------------------------------------------+");
    lines.push("|                AETHER-LANG DIAGNOSTIC LISTING                       |");
    lines.push("+----------------------------------------------------------------------+");
    lines.push("");

    for (let i = 0; i < this.sourceLines.length; i++) {
      const lineNum  = i + 1; // 1-based
      const srcLine  = this.sourceLines[i];
      const padded   = String(lineNum).padStart(lineNumWidth, " ");

      // Source line
      lines.push(`  ${padded} | ${srcLine}`);

      // Any diagnostics on this line?
      const diags = byLine.get(lineNum);
      if (diags) {
        for (const d of diags) {
          const prefix = " ".repeat(lineNumWidth) + " | ";
          const pointer = " ".repeat(Math.max(0, d.column - 1)) + "^^^^^";
          const label = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
          lines.push(`  ${prefix}${pointer} ${label} [${d.stage}]: ${d.message}`);
        }
      }
    }

    // Footer summary
    lines.push("");
    lines.push("----------------------------------------------------------------------");
    lines.push(`  ${this.errorCount} error(s), ${this.warningCount} warning(s)`);

    if (this.hasErrors) {
      lines.push("  [FAIL] Compilation BLOCKED - Conditional Execution Gate is CLOSED.");
    } else {
      lines.push("  [PASS] No errors - Conditional Execution Gate is OPEN.");
    }

    lines.push("----------------------------------------------------------------------");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate a compact error summary (for console output).
   */
  public formatSummary(): string {
    const lines: string[] = [];
    for (const d of this.diagnostics) {
      const label = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
      lines.push(`  [${d.line}:${d.column}] ${label} [${d.stage}]: ${d.message}`);
    }
    return lines.join("\n");
  }
}
