// ============================================================================
// Aether-Lang - End-to-End Integration Test & JSON Bridge Generator
// ============================================================================
// Run:  npx ts-node src/frontend-ts/test_e2e.ts
// Or:   npm run test:e2e
//
// This tests the complete frontend pipeline:
//   Source (.aeth) -> Lexer (tokens) -> Parser (AST) -> JSON Bridge
//
// It also validates the JSON Bridge contract - the schema that the
// C++ Backend (Stage 4-6) will consume.
// ============================================================================

import * as fs   from "fs";
import * as path from "path";
import { Lexer }               from "./lexer";
import { Parser }              from "./parser";
import { TokenType }           from "./tokens";
import type { Token }          from "./tokens";
import type {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  VarDeclNode,
  AiCallNode,
  CloudBlockNode,
  IfStatementNode,
  TensorTypeNode,
} from "./ast";

// -- Globals -----------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const bridgeOnly = process.argv.includes("--bridge-only");

function assert(condition: boolean, label: string): void {
  if (condition) {
    passCount++;
    if (!bridgeOnly) console.log(`  [PASS]  ${label}`);
  } else {
    failCount++;
    console.error(`  [FAIL]  FAILED: ${label}`);
    process.exitCode = 1;
  }
}

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}`);
}

// -- Pipeline helper ---------------------------------------------------------

interface PipelineResult {
  source:      string;
  tokens:      Token[];
  ast:         ProgramNode;
  lexErrors:   number;
  parseErrors: number;
  totalErrors: number;
  json:        string;
}

function compileFrontend(source: string): PipelineResult {
  const lexer      = new Lexer(source);
  const tokens     = lexer.tokenize();
  const parser     = new Parser(tokens);
  const ast        = parser.parseProgram();
  const json       = JSON.stringify(ast, null, 2);
  const lexErrors  = lexer.diagnostics.length;
  const parseErrors = parser.diagnostics.length;

  return {
    source,
    tokens,
    ast,
    lexErrors,
    parseErrors,
    totalErrors: lexErrors + parseErrors,
    json,
  };
}

// ============================================================================
//  TEST 1: Full Pipeline - Valid Program
// ============================================================================
section("E2E TEST 1 - Full pipeline on test_valid.aeth");

{
  const sourcePath = path.resolve(__dirname, "../../samples/test_valid.aeth");
  const source     = fs.readFileSync(sourcePath, "utf-8");
  const result     = compileFrontend(source);

  console.log(`\n  Source lines : ${source.split("\n").length}`);
  console.log(`  Tokens      : ${result.tokens.length}`);
  console.log(`  AST stmts   : ${result.ast.body.length}`);
  console.log(`  Lex errors  : ${result.lexErrors}`);
  console.log(`  Parse errors: ${result.parseErrors}`);
  console.log(`  JSON size   : ${result.json.length} bytes\n`);

  // -- Conditional Execution Gate ----------------------------------
  assert(result.totalErrors === 0,
    "GATE: Zero total errors -> C++ Backend would proceed");

  // -- Token count sanity -----------------------------------------
  assert(result.tokens.length > 50,
    `Token stream has ${result.tokens.length} tokens (expected >50)`);
  assert(result.tokens[result.tokens.length - 1].type === TokenType.EOF,
    "Token stream terminates with EOF");

  // -- AST structure ----------------------------------------------
  assert(result.ast.type === "Program", "Root node is Program");
  assert(result.ast.body.length === 8, "8 top-level statements");

  // -- Statement type inventory -----------------------------------
  const typeCounts = new Map<string, number>();
  function countTypes(stmts: StatementNode[]): void {
    for (const s of stmts) {
      typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
      if (s.type === "CloudBlock") countTypes(s.body);
      if (s.type === "IfStatement") {
        countTypes(s.consequent);
        if (s.alternate) countTypes(s.alternate);
      }
    }
  }
  countTypes(result.ast.body);

  assert(typeCounts.get("VarDecl") === 5,     "5 VarDecl nodes (3 global + 1 remote + 1 if)");
  assert(typeCounts.get("Assignment") === 5,   "5 Assignment nodes (2 global + 1 remote + 1 if-then + 1 if-else)");
  assert(typeCounts.get("AiCall") === 1,       "1 AiCall node");
  assert(typeCounts.get("CloudBlock") === 1,   "1 CloudBlock node");
  assert(typeCounts.get("IfStatement") === 1,  "1 IfStatement node");

  // -- JSON round-trip fidelity -----------------------------------
  const parsed = JSON.parse(result.json) as ProgramNode;
  assert(parsed.type === "Program", "JSON round-trip: root is Program");
  assert(parsed.body.length === result.ast.body.length,
    "JSON round-trip: same statement count");

  // Verify deep structural integrity
  const s0 = parsed.body[0] as VarDeclNode;
  assert(s0.type === "VarDecl" && s0.name === "x", "JSON[0]: VarDecl 'x'");
  assert(s0.meta._offset === null, "JSON[0]: meta._offset is null (Stage-3 stub)");
  assert(s0.meta._byteSize === null, "JSON[0]: meta._byteSize is null");
  assert(s0.meta._scope === null, "JSON[0]: meta._scope is null");

  const s5 = parsed.body[5] as AiCallNode;
  assert(s5.type === "AiCall" && s5.modelRef === "gpt-4-vision",
    "JSON[5]: AiCall with correct modelRef");

  const s6 = parsed.body[6] as CloudBlockNode;
  assert(s6.type === "CloudBlock" && s6.ipAddress === "192.168.1.100",
    "JSON[6]: CloudBlock with correct IP");

  const s7 = parsed.body[7] as IfStatementNode;
  assert(s7.type === "IfStatement" && s7.alternate !== null,
    "JSON[7]: IfStatement with else block");
}

// ============================================================================
//  TEST 2: Full Pipeline - Invalid Program (Panic Mode)
// ============================================================================
section("E2E TEST 2 - Pipeline with errors (Panic Mode)");

{
  const sourcePath = path.resolve(__dirname, "../../samples/test_invalid.aeth");
  const source     = fs.readFileSync(sourcePath, "utf-8");
  const result     = compileFrontend(source);

  console.log(`\n  Source lines : ${source.split("\n").length}`);
  console.log(`  Tokens      : ${result.tokens.length}`);
  console.log(`  AST stmts   : ${result.ast.body.length}`);
  console.log(`  Lex errors  : ${result.lexErrors}`);
  console.log(`  Parse errors: ${result.parseErrors}`);
  console.log(`  Total errors: ${result.totalErrors}\n`);

  // -- Conditional Execution Gate ----------------------------------
  assert(result.totalErrors > 0,
    "GATE: Errors present -> C++ Backend would NOT proceed");

  // -- Recovery proof ---------------------------------------------
  assert(result.ast.body.length > 1,
    `Parser recovered: produced ${result.ast.body.length} statements (not just 1)`);

  const errorStmts = result.ast.body.filter(s => s.type === "ErrorStatement");
  const validStmts = result.ast.body.filter(s => s.type !== "ErrorStatement");
  assert(errorStmts.length > 0, `${errorStmts.length} ErrorStatement nodes produced`);
  assert(validStmts.length > 0, `${validStmts.length} valid statements survived recovery`);

  console.log(`\n  Error statements: ${errorStmts.length}`);
  console.log(`  Valid statements: ${validStmts.length}`);
}

// ============================================================================
//  TEST 3: Operator Precedence Deep Check
// ============================================================================
section("E2E TEST 3 - Operator precedence and expression trees");

{
  // 1 + 2 * 3 - 4 / 2  should parse as: ((1 + (2 * 3)) - (4 / 2))
  const result = compileFrontend("let v: int = 1 + 2 * 3 - 4 / 2;");
  assert(result.totalErrors === 0, "No errors");
  const decl = result.ast.body[0];
  if (decl.type === "VarDecl" && decl.init) {
    // Top: BinaryExpr (-)
    assert(decl.init.type === "BinaryExpr", "Top is BinaryExpr");
    if (decl.init.type === "BinaryExpr") {
      assert(decl.init.operator === "-", "Top op = '-'");
      // Left of -: BinaryExpr (+)
      assert(decl.init.left.type === "BinaryExpr", "Left of '-' is BinaryExpr");
      if (decl.init.left.type === "BinaryExpr") {
        assert(decl.init.left.operator === "+", "Left op = '+'");
        // Right of +: BinaryExpr (*)
        assert(decl.init.left.right.type === "BinaryExpr", "Right of '+' is BinaryExpr");
        if (decl.init.left.right.type === "BinaryExpr")
          assert(decl.init.left.right.operator === "*", "...with op '*'");
      }
      // Right of -: BinaryExpr (/)
      assert(decl.init.right.type === "BinaryExpr", "Right of '-' is BinaryExpr");
      if (decl.init.right.type === "BinaryExpr")
        assert(decl.init.right.operator === "/", "Right op = '/'");
    }
  }
}

// ============================================================================
//  TEST 4: Tensor Shape Variations
// ============================================================================
section("E2E TEST 4 - Tensor shapes");

{
  const tests = [
    { src: "let a: tensor<f32, [10]>;",                dims: [10],              label: "1D" },
    { src: "let b: tensor<i32, [28, 28]>;",            dims: [28, 28],          label: "2D" },
    { src: "let c: tensor<f32, [3, 224, 224]>;",       dims: [3, 224, 224],     label: "3D" },
    { src: "let d: tensor<f32, [2, 3, 64, 64]>;",      dims: [2, 3, 64, 64],   label: "4D" },
  ];

  for (const t of tests) {
    const result = compileFrontend(t.src);
    assert(result.totalErrors === 0, `${t.label}: No errors`);
    const decl = result.ast.body[0] as VarDeclNode;
    if (decl.varType.type === "TensorType") {
      assert(JSON.stringify(decl.varType.dimensions) === JSON.stringify(t.dims),
        `${t.label}: dims = [${t.dims}]`);
    }
  }
}

// ============================================================================
//  TEST 5: Conditional Execution Gate Contract
// ============================================================================
section("E2E TEST 5 - Conditional Execution Gate");

{
  // Valid program -> gate OPEN
  const valid = compileFrontend("let x: int = 1;");
  assert(valid.totalErrors === 0, "Valid -> gate OPEN (0 errors)");

  // Invalid program -> gate CLOSED
  const invalid = compileFrontend("let x: int = ;");
  assert(invalid.totalErrors > 0, "Invalid -> gate CLOSED (>0 errors)");

  // Simulate gate logic
  function executeGate(result: PipelineResult): boolean {
    if (result.totalErrors > 0) {
      return false; // BLOCKED
    }
    return true; // PROCEED to C++ backend
  }

  assert(executeGate(valid) === true, "Gate allows valid program");
  assert(executeGate(invalid) === false, "Gate blocks invalid program");
}

// ============================================================================
//  TEST 6: Edge Cases
// ============================================================================
section("E2E TEST 6 - Edge cases");

{
  // Empty program
  const empty = compileFrontend("");
  assert(empty.totalErrors === 0 && empty.ast.body.length === 0, "Empty program OK");

  // Only semicolons
  const semis = compileFrontend(";;;");
  assert(semis.totalErrors === 0 && semis.ast.body.length === 0, "Bare semicolons OK");

  // Only comments
  const comments = compileFrontend("// this is a comment\n// another one\n");
  assert(comments.totalErrors === 0 && comments.ast.body.length === 0, "Only comments OK");

  // Deeply nested parentheses
  const nested = compileFrontend("let x: int = ((((1 + 2))));");
  assert(nested.totalErrors === 0, "Deep parens OK");
  const decl = nested.ast.body[0];
  if (decl.type === "VarDecl" && decl.init) {
    // Unwrap 3 ParenExpr layers
    let expr: ExpressionNode = decl.init;
    let parenDepth = 0;
    while (expr.type === "ParenExpr") { expr = expr.expr; parenDepth++; }
    assert(parenDepth === 4, `4 ParenExpr layers (got ${parenDepth})`);
    assert(expr.type === "BinaryExpr", "Inner is BinaryExpr");
  }

  // Remote block with statements inside
  const remote = compileFrontend(`
    remote("10.0.0.1") {
      let a: int = 1;
      let b: int = 2;
      a = a + b;
    }
  `);
  assert(remote.totalErrors === 0, "Remote block with 3 statements OK");
  const cb = remote.ast.body[0] as CloudBlockNode;
  assert(cb.body.length === 3, "Remote body has 3 statements");
}

// ============================================================================
//  JSON Bridge Output Generation
// ============================================================================
section("JSON BRIDGE - Annotated output generation");

{
  const sourcePath = path.resolve(__dirname, "../../samples/test_valid.aeth");
  const source     = fs.readFileSync(sourcePath, "utf-8");
  const result     = compileFrontend(source);
  const outDir     = path.resolve(__dirname, "../../output");

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // -- 1. Raw AST JSON (for C++ backend consumption) ------------
  const astPath = path.join(outDir, "ast.json");
  fs.writeFileSync(astPath, result.json, "utf-8");

  // -- 2. Bridge Schema Documentation ---------------------------
  const schema = {
    _comment: "Aether-Lang JSON Bridge Schema - consumed by C++ Backend (Stage 4-6)",
    _version: "0.1.0",
    _gate: {
      lexErrors:   result.lexErrors,
      parseErrors: result.parseErrors,
      totalErrors: result.totalErrors,
      proceed:     result.totalErrors === 0,
    },
    _stats: {
      sourceLines:  source.split("\n").length,
      tokenCount:   result.tokens.length,
      statementCount: result.ast.body.length,
      jsonBytes:    result.json.length,
    },
    _nodeTypes: {
      statements:  ["VarDecl", "Assignment", "AiCall", "CloudBlock", "IfStatement", "ErrorStatement"],
      types:       ["SimpleType", "TensorType"],
      expressions: ["BinaryExpr", "ComparisonExpr", "Identifier", "IntLiteral", "FloatLiteral", "ParenExpr"],
    },
    _metaContract: {
      description: "Stage 3 (Semantic Analyzer) populates these fields on VarDeclNode.meta before serialisation",
      fields: {
        _offset:   "Stack offset in bytes from frame base pointer (int)",
        _byteSize: "Total byte size: 4 for int/f32, product(dims)*sizeof(baseType) for tensors (int)",
        _scope:    "Lexical scope depth: 0 = global (int)",
      },
    },
    ast: JSON.parse(result.json),
  };

  const bridgePath = path.join(outDir, "bridge.json");
  fs.writeFileSync(bridgePath, JSON.stringify(schema, null, 2), "utf-8");

  // -- 3. Token stream dump -------------------------------------
  const tokenDump = result.tokens.map(t => ({
    type:   t.type,
    lexeme: t.lexeme,
    line:   t.loc.line,
    column: t.loc.column,
  }));
  const tokensPath = path.join(outDir, "tokens.json");
  fs.writeFileSync(tokensPath, JSON.stringify(tokenDump, null, 2), "utf-8");

  console.log(`\n  Generated artifacts:`);
  console.log(`    |-- ${astPath}     (${result.json.length} bytes) - Raw AST`);
  console.log(`    |-- ${bridgePath}  (${JSON.stringify(schema).length} bytes) - Annotated Bridge`);
  console.log(`    \\-- ${tokensPath}  (${JSON.stringify(tokenDump).length} bytes) - Token stream`);

  assert(fs.existsSync(astPath), "ast.json written");
  assert(fs.existsSync(bridgePath), "bridge.json written");
  assert(fs.existsSync(tokensPath), "tokens.json written");

  // Validate bridge schema
  const bridgeData = JSON.parse(fs.readFileSync(bridgePath, "utf-8"));
  assert(bridgeData._gate.proceed === true, "Bridge gate reports: PROCEED");
  assert(bridgeData._gate.totalErrors === 0, "Bridge gate: 0 total errors");
  assert(bridgeData.ast.type === "Program", "Bridge contains valid AST");
  assert(bridgeData._metaContract.fields._offset !== undefined, "Bridge documents _offset contract");
}

// ============================================================================
//  Summary
// ============================================================================
section("FINAL SUMMARY");

console.log(`\n  Total assertions: ${passCount + failCount}`);
console.log(`  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);

if (failCount === 0) {
  console.log(`\n  [PASS]  ALL E2E TESTS PASSED - Frontend pipeline is solid.`);
  console.log(`  [PASS]  JSON Bridge artifacts generated in output/`);
  console.log(`  [PASS]  Conditional Execution Gate verified.\n`);
} else {
  console.log(`\n  [FAIL]  ${failCount} TEST(S) FAILED\n`);
}

console.log(`${"=".repeat(70)}\n`);
