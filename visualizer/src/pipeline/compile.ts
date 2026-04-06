import { Lexer }            from "./lexer";
import { Parser }           from "./parser";
import { SemanticAnalyzer } from "./analyzer";
import { DiagnosticBag }    from "./diagnostics";
import { Token }            from "./tokens";
import type { ProgramNode } from "./ast";

// -- Result type -------------------------------------------------------------
export interface CompilationResult {
  tokens:         Token[];
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
    tokens,
    ast,
    bag,
    sourceLines,
    gateOpen,
    totalFrameSize: analyzer.totalFrameSize,
  };
}
