// ============================================================================
// Aether-Lang - Frontend Pipeline Driver (main.ts)
// ============================================================================
// Orchestrates the full frontend compilation:
//   Stage 1: Lexer    -> Token[]
//   Stage 2: Parser   -> ProgramNode (AST)
//   Stage 3: Analyzer -> MemoryMeta populated, types validated
//   Gate:    DiagnosticBag.hasErrors -> proceed or block
//   Output:  bridge.json, listing.txt
// ============================================================================

import * as fs   from "fs";
import * as path from "path";
import { Lexer }            from "./lexer";
import { Parser }           from "./parser";
import { SemanticAnalyzer } from "./analyzer";
import { DiagnosticBag }    from "./diagnostics";
import type { ProgramNode } from "./ast";

// -- Result type -------------------------------------------------------------
export interface CompilationResult {
  ast:            ProgramNode;
  bag:            DiagnosticBag;
  sourceLines:    string[];
  gateOpen:       boolean;
  totalFrameSize: number;
}

// -- Compile function --------------------------------------------------------

export function compile(source: string): CompilationResult {
  const sourceLines = source.split("\n");

  // -- Stage 1: Lexical Analysis -----------------------------------
  const lexer  = new Lexer(source);
  const tokens = lexer.tokenize();

  // -- Stage 2: Syntax Analysis ------------------------------------
  const parser = new Parser(tokens);
  const ast    = parser.parseProgram();

  // -- Unified Diagnostic Bag --------------------------------------
  const bag = new DiagnosticBag(sourceLines);
  bag.importLexerDiagnostics(lexer.diagnostics);
  bag.importParserDiagnostics(parser.diagnostics);

  // -- Stage 3: Semantic Analysis ----------------------------------
  // (runs even if Stage 1-2 had errors, to catch more issues)
  const analyzer = new SemanticAnalyzer(bag);
  analyzer.analyze(ast);

  // -- Conditional Execution Gate ----------------------------------
  const gateOpen = !bag.hasErrors;

  return {
    ast,
    bag,
    sourceLines,
    gateOpen,
    totalFrameSize: analyzer.totalFrameSize,
  };
}

// -- CLI entrypoint ----------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: aether-lang <source.aeth>");
    process.exit(1);
  }

  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const result = compile(source);

  const outDir = path.resolve(path.dirname(filePath), "../output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // -- Always generate listing.txt ----------------------------------
  const listing = result.bag.generateListing();
  const listingPath = path.join(outDir, "listing.txt");
  fs.writeFileSync(listingPath, listing, "utf-8");

  console.log(`\n  [DOC]  listing.txt written to ${listingPath}`);

  if (result.bag.hasErrors) {
    // -- Gate CLOSED -------------------------------------------------
    console.log(`\n  [FAIL]  ${result.bag.errorCount} error(s), ${result.bag.warningCount} warning(s)`);
    console.log("  [FAIL]  Conditional Execution Gate: CLOSED");
    console.log("  [FAIL]  Backend will NOT proceed.\n");
    console.log(result.bag.formatSummary());
    process.exit(1);
  }

  // -- Gate OPEN - serialize annotated AST ---------------------------
  const bridge = {
    _comment: "Aether-Lang JSON Bridge - consumed by C++ Backend (Stage 4-6)",
    _version: "0.2.0",
    _gate: {
      lexErrors:   result.bag.diagnostics.filter(d => d.stage === "lexer").length,
      parseErrors: result.bag.diagnostics.filter(d => d.stage === "parser").length,
      analyzerErrors: result.bag.diagnostics.filter(d => d.stage === "analyzer").length,
      totalErrors: result.bag.errorCount,
      proceed:     true,
    },
    _stats: {
      sourceLines:    result.sourceLines.length,
      totalFrameSize: result.totalFrameSize,
    },
    ast: result.ast,
  };

  const bridgePath = path.join(outDir, "bridge.json");
  fs.writeFileSync(bridgePath, JSON.stringify(bridge, null, 2), "utf-8");

  console.log(`  [PKG]  bridge.json written to ${bridgePath} (${JSON.stringify(bridge).length} bytes)`);
  console.log(`\n  [PASS]  ${result.bag.errorCount} error(s), ${result.bag.warningCount} warning(s)`);
  console.log(`  [PASS]  Total stack frame: ${result.totalFrameSize} bytes`);
  console.log("  [PASS]  Conditional Execution Gate: OPEN");
  console.log("  [PASS]  Backend may proceed.\n");
}

// Run when executed directly
if (require.main === module) {
  main();
}
