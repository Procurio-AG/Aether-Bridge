// ============================================================================
// Aether-Lang - Parser Test Harness
// ============================================================================
// Run: npx ts-node src/frontend-ts/test_parser.ts
// ============================================================================

import * as fs   from "fs";
import * as path from "path";
import { Lexer }           from "./lexer";
import { Parser }          from "./parser";
import { TokenType }       from "./tokens";
import type { ProgramNode, StatementNode, ExpressionNode } from "./ast";

// -- Helpers -----------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passCount++;
    console.log(`  [PASS]  ${label}`);
  } else {
    failCount++;
    console.error(`  [FAIL]  FAILED: ${label}`);
    process.exitCode = 1;
  }
}

function parseSource(source: string): { ast: ProgramNode; errors: number } {
  const lexer  = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast    = parser.parseProgram();
  return { ast, errors: parser.diagnostics.length + lexer.diagnostics.length };
}

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}`);
}

// ============================================================================
//  TEST 1: Valid Full Program
// ============================================================================
section("TEST 1 - Full valid program (test_valid.aeth)");

{
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../samples/test_valid.aeth"), "utf-8"
  );
  const lexer  = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast    = parser.parseProgram();

  console.log(`\n  Parsed ${ast.body.length} top-level statements, ${parser.diagnostics.length} errors.\n`);

  assert(ast.type === "Program",          "Root is ProgramNode");
  assert(ast.body.length === 8,           "8 top-level statements");
  assert(parser.diagnostics.length === 0, "Zero parse errors");

  // Statement types
  assert(ast.body[0].type === "VarDecl",     "[0] let x: int = 42");
  assert(ast.body[1].type === "VarDecl",     "[1] let pi: float = 3.14");
  assert(ast.body[2].type === "VarDecl",     "[2] let weights: tensor<f32, [784,256]>");
  assert(ast.body[3].type === "Assignment",  "[3] x = x + 1");
  assert(ast.body[4].type === "Assignment",  "[4] pi = pi * 2.0");
  assert(ast.body[5].type === "AiCall",      "[5] result := infer(...)");
  assert(ast.body[6].type === "CloudBlock",  "[6] remote(...) { ... }");
  assert(ast.body[7].type === "IfStatement", "[7] if (...) { ... } else { ... }");

  // -- Deep checks on specific nodes ----------------------------------

  // VarDecl: let x: int = 42
  const s0 = ast.body[0];
  if (s0.type === "VarDecl") {
    assert(s0.name === "x",                       "VarDecl[0] name = 'x'");
    assert(s0.varType.type === "SimpleType",       "VarDecl[0] type = SimpleType");
    if (s0.varType.type === "SimpleType")
      assert(s0.varType.name === "int",            "VarDecl[0] type.name = 'int'");
    assert(s0.init !== null,                       "VarDecl[0] has initialiser");
    if (s0.init && s0.init.type === "IntLiteral")
      assert(s0.init.value === 42,                 "VarDecl[0] init = 42");
    assert(s0.meta._offset === null,               "VarDecl[0] meta._offset = null (Stage 3)");
  }

  // VarDecl: let weights: tensor<f32, [784, 256]>
  const s2 = ast.body[2];
  if (s2.type === "VarDecl" && s2.varType.type === "TensorType") {
    assert(s2.varType.baseType === "f32",          "Tensor baseType = 'f32'");
    assert(s2.varType.dimensions.length === 2,     "Tensor has 2 dimensions");
    assert(s2.varType.dimensions[0] === 784,       "Tensor dim[0] = 784");
    assert(s2.varType.dimensions[1] === 256,       "Tensor dim[1] = 256");
    assert(s2.init === null,                       "Tensor has no initialiser");
  }

  // Assignment: x = x + 1
  const s3 = ast.body[3];
  if (s3.type === "Assignment") {
    assert(s3.name === "x",                        "Assignment target = 'x'");
    assert(s3.value.type === "BinaryExpr",         "Assignment value is BinaryExpr");
    if (s3.value.type === "BinaryExpr") {
      assert(s3.value.operator === "+",            "BinaryExpr op = '+'");
      assert(s3.value.left.type === "Identifier",  "BinaryExpr left = Identifier");
      assert(s3.value.right.type === "IntLiteral", "BinaryExpr right = IntLiteral");
    }
  }

  // AiCall: result := infer(weights, "gpt-4-vision")
  const s5 = ast.body[5];
  if (s5.type === "AiCall") {
    assert(s5.target === "result",                 "AiCall target = 'result'");
    assert(s5.source === "weights",                "AiCall source = 'weights'");
    assert(s5.modelRef === "gpt-4-vision",         "AiCall modelRef = 'gpt-4-vision'");
  }

  // CloudBlock: remote("192.168.1.100") { ... }
  const s6 = ast.body[6];
  if (s6.type === "CloudBlock") {
    assert(s6.ipAddress === "192.168.1.100",       "CloudBlock ip = '192.168.1.100'");
    assert(s6.body.length === 2,                   "CloudBlock has 2 inner statements");
    if (s6.body.length >= 1)
      assert(s6.body[0].type === "VarDecl",        "CloudBlock[0] = VarDecl");
    if (s6.body.length >= 2)
      assert(s6.body[1].type === "Assignment",     "CloudBlock[1] = Assignment");
  }

  // IfStatement
  {
    const s7 = ast.body[7];
    if (s7.type === "IfStatement") {
      assert(s7.condition.type === "ComparisonExpr", "If condition is ComparisonExpr");
      if (s7.condition.type === "ComparisonExpr")
        assert(s7.condition.operator === "==",       "If condition op = '=='");
      assert(s7.consequent.length === 2,             "If consequent has 2 statements");
      assert(s7.alternate !== null,                  "If has else block");
      if (s7.alternate)
        assert(s7.alternate.length === 1,            "Else block has 1 statement");
    }
  }

  // JSON serialisable
  const json = JSON.stringify(ast);
  assert(typeof json === "string" && json.length > 0, "AST is JSON-serialisable");
  const roundTrip = JSON.parse(json);
  assert(roundTrip.type === "Program",                 "JSON round-trips cleanly");
}

// ============================================================================
//  TEST 2: Panic Mode Error Recovery
// ============================================================================
section("TEST 2 - Panic Mode recovery (test_invalid.aeth)");

{
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../samples/test_invalid.aeth"), "utf-8"
  );
  const lexer  = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast    = parser.parseProgram();

  console.log(`\n  Parsed ${ast.body.length} statements, ` +
              `${parser.diagnostics.length} parse errors, ` +
              `${lexer.diagnostics.length} lex errors.\n`);

  assert(ast.type === "Program",               "Root is ProgramNode");
  assert(parser.diagnostics.length > 0,        "Parser reports errors");
  assert(ast.body.length > 1,                  "Parser recovered past first error");

  // Count ErrorStatement nodes
  const errorNodes = ast.body.filter(s => s.type === "ErrorStatement");
  assert(errorNodes.length > 0,                "AST contains ErrorStatement nodes");
  console.log(`  [INFO]  ErrorStatement nodes: ${errorNodes.length}`);

  // Print all diagnostics
  console.log(`\n  Parser diagnostics:`);
  for (const d of parser.diagnostics) {
    console.log(`    [${d.line}:${d.column}] ${d.message}`);
  }

  // Key assertion: the parser should have recovered far enough to see
  // the `if` block at the end of the file
  const hasIf = ast.body.some(s => s.type === "IfStatement" || s.type === "ErrorStatement");
  assert(hasIf, "Parser recovered far enough to attempt the if-block");
}

// ============================================================================
//  TEST 3: Micro-tests (inline)
// ============================================================================
section("TEST 3 - Micro-tests (specific productions)");

// 3a. Simple int declaration
{
  const { ast, errors } = parseSource("let a: int = 5;");
  assert(errors === 0, "No errors for simple int decl");
  assert(ast.body.length === 1, "One statement");
  const s = ast.body[0];
  assert(s.type === "VarDecl" && s.name === "a", "VarDecl name = 'a'");
}

// 3b. Declaration without initialiser
{
  const { ast, errors } = parseSource("let b: float;");
  assert(errors === 0, "No errors for uninitialised decl");
  if (ast.body[0].type === "VarDecl")
    assert(ast.body[0].init === null, "No initialiser -> null");
}

// 3c. Tensor type parsing
{
  const { ast, errors } = parseSource("let t: tensor<i32, [100]>;");
  assert(errors === 0, "No errors for 1D tensor");
  const s = ast.body[0];
  if (s.type === "VarDecl" && s.varType.type === "TensorType") {
    assert(s.varType.baseType === "i32", "baseType = i32");
    assert(s.varType.dimensions.length === 1, "1 dimension");
    assert(s.varType.dimensions[0] === 100, "dim = 100");
  }
}

// 3d. Operator precedence: 1 + 2 * 3 -> (1 + (2 * 3))
{
  const { ast, errors } = parseSource("let v: int = 1 + 2 * 3;");
  assert(errors === 0, "No errors for precedence test");
  const s = ast.body[0];
  if (s.type === "VarDecl" && s.init && s.init.type === "BinaryExpr") {
    assert(s.init.operator === "+", "Top-level op is +");
    assert(s.init.right.type === "BinaryExpr", "Right is nested BinaryExpr");
    if (s.init.right.type === "BinaryExpr")
      assert(s.init.right.operator === "*", "Nested op is *");
  }
}

// 3e. Parenthesised expression: (1 + 2) * 3
{
  const { ast, errors } = parseSource("let v: int = (1 + 2) * 3;");
  assert(errors === 0, "No errors for parens test");
  const s = ast.body[0];
  if (s.type === "VarDecl" && s.init && s.init.type === "BinaryExpr") {
    assert(s.init.operator === "*", "Top-level op is * (parens shift precedence)");
    assert(s.init.left.type === "ParenExpr", "Left is ParenExpr");
  }
}

// 3f. Nested if-else
{
  const src = `
    if (a == 1) {
      let x: int = 10;
    } else {
      if (b != 2) {
        let y: int = 20;
      }
    }
  `;
  const { ast, errors } = parseSource(src);
  assert(errors === 0, "No errors for nested if-else");
  assert(ast.body[0].type === "IfStatement", "Outer if parsed");
  const outer = ast.body[0];
  if (outer.type === "IfStatement" && outer.alternate) {
    assert(outer.alternate[0].type === "IfStatement", "Nested if in else block");
  }
}

// 3g. Comparison operators
{
  for (const op of ["==", "!=", "<", ">", "<=", ">="]) {
    const src = `if (a ${op} b) { let z: int = 0; }`;
    const { ast, errors } = parseSource(src);
    assert(errors === 0, `No errors for comparison '${op}'`);
    const s = ast.body[0];
    if (s.type === "IfStatement" && s.condition.type === "ComparisonExpr") {
      assert(s.condition.operator === op, `Comparison op = '${op}'`);
    }
  }
}

// 3h. AI call
{
  const { ast, errors } = parseSource('r := infer(data, "model-v2");');
  assert(errors === 0, "No errors for AI call");
  const s = ast.body[0];
  if (s.type === "AiCall") {
    assert(s.target === "r", "AI call target = 'r'");
    assert(s.source === "data", "AI call source = 'data'");
    assert(s.modelRef === "model-v2", "AI call model = 'model-v2'");
  }
}

// 3i. Remote block
{
  const { ast, errors } = parseSource('remote("10.0.0.1") { let n: int; }');
  assert(errors === 0, "No errors for remote block");
  const s = ast.body[0];
  if (s.type === "CloudBlock") {
    assert(s.ipAddress === "10.0.0.1", "Remote IP = '10.0.0.1'");
    assert(s.body.length === 1, "Remote body has 1 statement");
  }
}

// 3j. Range tracking
{
  const { ast } = parseSource("let x: int = 1;");
  assert(ast.range.line === 1 && ast.range.column === 1, "Program range is 1:1");
  const s = ast.body[0];
  assert(s.range.line === 1 && s.range.column === 1, "First statement range = 1:1");
}

// 3k. Multiple errors in one pass (Panic Mode proof)
{
  const src = `
    let a: int = ;
    let b: int = 5;
    let c: int = ;
    let d: int = 10;
  `;
  const lexer  = new Lexer(src);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast    = parser.parseProgram();

  assert(parser.diagnostics.length >= 2, "Multiple errors reported in one pass");

  // The valid declarations should still parse
  const validDecls = ast.body.filter(s => s.type === "VarDecl");
  assert(validDecls.length >= 2, "Valid declarations survived Panic Mode");
  console.log(`  [INFO]  ${parser.diagnostics.length} errors, ` +
              `${validDecls.length} valid decls, ` +
              `${ast.body.filter(s => s.type === "ErrorStatement").length} error nodes`);
}

// 3l. Empty program
{
  const { ast, errors } = parseSource("");
  assert(errors === 0, "Empty program -> no errors");
  assert(ast.body.length === 0, "Empty program -> no statements");
}

// 3m. Multi-dimensional tensor
{
  const { ast, errors } = parseSource("let t: tensor<f32, [3, 224, 224]>;");
  assert(errors === 0, "No errors for 3D tensor");
  const s = ast.body[0];
  if (s.type === "VarDecl" && s.varType.type === "TensorType") {
    assert(s.varType.dimensions.length === 3, "3D tensor has 3 dimensions");
    assert(s.varType.dimensions[0] === 3, "dim[0] = 3");
    assert(s.varType.dimensions[1] === 224, "dim[1] = 224");
    assert(s.varType.dimensions[2] === 224, "dim[2] = 224");
  }
}

// ============================================================================
//  TEST 4: JSON Bridge Validation
// ============================================================================
section("TEST 4 - JSON Bridge serialisation");

{
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../samples/test_valid.aeth"), "utf-8"
  );
  const { ast } = parseSource(source);
  const json = JSON.stringify(ast, null, 2);

  // Write to output for inspection
  const outDir  = path.resolve(__dirname, "../../output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "ast.json");
  fs.writeFileSync(outPath, json, "utf-8");

  assert(json.includes('"type": "Program"'),       "JSON contains Program node");
  assert(json.includes('"type": "VarDecl"'),        "JSON contains VarDecl nodes");
  assert(json.includes('"type": "AiCall"'),          "JSON contains AiCall node");
  assert(json.includes('"type": "CloudBlock"'),      "JSON contains CloudBlock node");
  assert(json.includes('"type": "IfStatement"'),     "JSON contains IfStatement node");
  assert(json.includes('"type": "TensorType"'),      "JSON contains TensorType nodes");
  assert(json.includes('"type": "ComparisonExpr"'),  "JSON contains ComparisonExpr");
  assert(json.includes('"_offset": null'),           "JSON contains Stage-3 meta stubs");

  console.log(`\n  [INFO]  AST JSON written to: ${outPath} (${json.length} bytes)`);
}

// ============================================================================
//  Summary
// ============================================================================
section("SUMMARY");
console.log(`\n  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);
if (failCount === 0) {
  console.log(`\n  [PASS]  ALL TESTS PASSED`);
} else {
  console.log(`\n  [FAIL]  ${failCount} TEST(S) FAILED`);
}
console.log(`\n${"=".repeat(70)}\n`);
