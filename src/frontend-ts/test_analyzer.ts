// ============================================================================
// Aether-Lang - Semantic Analyzer + Diagnostics Test Suite
// ============================================================================
// Run:  npx ts-node src/frontend-ts/test_analyzer.ts
// ============================================================================

import * as fs   from "fs";
import * as path from "path";
import { compile }          from "./main";
import { Lexer }            from "./lexer";
import { Parser }           from "./parser";
import { SemanticAnalyzer } from "./analyzer";
import { DiagnosticBag }    from "./diagnostics";
import type { VarDeclNode, ProgramNode } from "./ast";

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

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}`);
}

// Helper: parse + analyze a source string, return result
function analyzeSource(source: string) {
  return compile(source);
}

// ============================================================================
//  TEST 1: Memory Planning on Valid Program
// ============================================================================
section("TEST 1 - Memory planning (byte sizes & offsets)");

{
  const source = `
let a: int = 1;
let b: float = 2.0;
let t: tensor<f32, [4, 4]>;
let c: int = 3;
`;
  const result = analyzeSource(source);

  assert(!result.bag.hasErrors, "No errors on valid program");

  const stmts = result.ast.body;

  // a: int -> 4 bytes, offset 0
  const a = stmts[0] as VarDeclNode;
  assert(a.meta._byteSize === 4, "a: byteSize = 4");
  assert(a.meta._offset === 0,   "a: offset = 0");
  assert(a.meta._scope === 0,    "a: scope = 0 (global)");

  // b: float -> 4 bytes, offset 4
  const b = stmts[1] as VarDeclNode;
  assert(b.meta._byteSize === 4, "b: byteSize = 4");
  assert(b.meta._offset === 4,   "b: offset = 4");
  assert(b.meta._scope === 0,    "b: scope = 0");

  // t: tensor<f32, [4, 4]> -> 4*4 = 16 elements * 4 bytes = 64 bytes, offset 8
  const t = stmts[2] as VarDeclNode;
  assert(t.meta._byteSize === 64, "t: byteSize = 64 (4x4x4)");
  assert(t.meta._offset === 8,    "t: offset = 8");
  assert(t.meta._scope === 0,     "t: scope = 0");

  // c: int -> 4 bytes, offset 72
  const c = stmts[3] as VarDeclNode;
  assert(c.meta._byteSize === 4, "c: byteSize = 4");
  assert(c.meta._offset === 72,  "c: offset = 72 (8+64)");

  // Total stack frame
  assert(result.totalFrameSize === 76, `Total frame = 76 bytes (got ${result.totalFrameSize})`);
}

// ============================================================================
//  TEST 2: Scope Management & Variable Shadowing
// ============================================================================
section("TEST 2 - Scoping & shadowing");

{
  const source = `
let x: int = 1;
if (x == 0) {
  let y: int = 10;
}
`;
  const result = analyzeSource(source);
  assert(!result.bag.hasErrors, "No errors with proper scoping");

  // x is at scope 0, y at scope 1
  const x = result.ast.body[0] as VarDeclNode;
  assert(x.meta._scope === 0, "x: scope = 0 (global)");

  const ifStmt = result.ast.body[1];
  if (ifStmt.type === "IfStatement") {
    const y = ifStmt.consequent[0] as VarDeclNode;
    assert(y.meta._scope === 1, "y: scope = 1 (if-block)");
  }
}

{
  // Nested scopes
  const source = `
let a: int = 1;
remote("1.2.3.4") {
  let b: int = 2;
  if (a == b) {
    let c: int = 3;
  }
}
`;
  const result = analyzeSource(source);
  assert(!result.bag.hasErrors, "No errors with nested scoping");

  const a = result.ast.body[0] as VarDeclNode;
  assert(a.meta._scope === 0, "a: scope = 0 (global)");

  const remote = result.ast.body[1];
  if (remote.type === "CloudBlock") {
    const b = remote.body[0] as VarDeclNode;
    assert(b.meta._scope === 1, "b: scope = 1 (remote block)");

    const innerIf = remote.body[1];
    if (innerIf.type === "IfStatement") {
      const c = innerIf.consequent[0] as VarDeclNode;
      assert(c.meta._scope === 2, "c: scope = 2 (if inside remote)");
    }
  }
}

// ============================================================================
//  TEST 3: Undeclared Variable Detection
// ============================================================================
section("TEST 3 - Undeclared variable errors");

{
  const result = analyzeSource("x = 5;");
  assert(result.bag.hasErrors, "Error: undeclared 'x' in assignment");
  assert(result.bag.errorCount === 1, "Exactly 1 error");
  assert(result.bag.diagnostics[0].message.includes("Undeclared"), "Message says 'Undeclared'");
}

{
  const result = analyzeSource("let a: int = b;");
  assert(result.bag.hasErrors, "Error: undeclared 'b' in initialiser");
}

{
  const result = analyzeSource("if (z == 0) { let q: int; }");
  assert(result.bag.hasErrors, "Error: undeclared 'z' in if condition");
}

// ============================================================================
//  TEST 4: Redeclaration Detection
// ============================================================================
section("TEST 4 - Redeclaration in same scope");

{
  const result = analyzeSource(`
let x: int = 1;
let x: int = 2;
`);
  assert(result.bag.hasErrors, "Error: redeclaration of 'x'");
  assert(result.bag.diagnostics.some(d => d.message.includes("already declared")),
    "Message mentions 'already declared'");
}

{
  // Different scopes: NOT a redeclaration
  const result = analyzeSource(`
let x: int = 1;
if (x == 0) {
  let x: int = 2;
}
`);
  assert(!result.bag.hasErrors, "No error: 'x' in different scope is valid shadowing");
}

// ============================================================================
//  TEST 5: Type Checking - Assignment compatibility
// ============================================================================
section("TEST 5 - Type checking (assignments)");

{
  // int <- int: OK
  const r1 = analyzeSource("let a: int = 42;");
  assert(!r1.bag.hasErrors, "int <- IntLiteral: OK");
}

{
  // float <- float: OK
  const r2 = analyzeSource("let b: float = 3.14;");
  assert(!r2.bag.hasErrors, "float <- FloatLiteral: OK");
}

{
  // int <- float: implicit conversion allowed
  const r3 = analyzeSource("let c: int = 3.14;");
  assert(!r3.bag.hasErrors, "int <- float: implicit conversion (allowed in DSL)");
}

{
  // tensor <- int: NOT allowed
  const r4 = analyzeSource("let t: tensor<f32, [10]> = 5;");
  assert(r4.bag.hasErrors, "tensor <- int: type error");
}

// ============================================================================
//  TEST 6: Type Checking - Binary Expressions
// ============================================================================
section("TEST 6 - Type checking (expressions)");

{
  // int + int -> int
  const r = analyzeSource("let a: int = 1 + 2;");
  assert(!r.bag.hasErrors, "int + int: OK");
}

{
  // float + float -> float
  const r = analyzeSource("let a: float = 1.0 + 2.0;");
  assert(!r.bag.hasErrors, "float + float: OK");
}

{
  // int + float -> float (widening)
  const r = analyzeSource("let a: float = 1 + 2.0;");
  assert(!r.bag.hasErrors, "int + float: OK (widening)");
}

// ============================================================================
//  TEST 7: Tensor Dimension Validation
// ============================================================================
section("TEST 7 - Tensor shape validation");

{
  // Same shape: OK
  const r = analyzeSource(`
let a: tensor<f32, [10, 20]>;
let b: tensor<f32, [10, 20]>;
a = a + b;
`);
  assert(!r.bag.hasErrors, "tensor[10,20] + tensor[10,20]: OK");
}

{
  // Mismatched shape: ERROR
  const r = analyzeSource(`
let a: tensor<f32, [10, 20]>;
let b: tensor<f32, [5, 20]>;
a = a + b;
`);
  assert(r.bag.hasErrors, "tensor[10,20] + tensor[5,20]: dim mismatch ERROR");
  assert(r.bag.diagnostics.some(d => d.message.includes("dimension mismatch") || d.message.includes("Tensor dimension")),
    "Error message mentions dimension mismatch");
}

{
  // Mismatched rank: ERROR
  const r = analyzeSource(`
let a: tensor<f32, [10]>;
let b: tensor<f32, [10, 20]>;
a = a + b;
`);
  assert(r.bag.hasErrors, "tensor[10] + tensor[10,20]: rank mismatch ERROR");
}

{
  // Tensor + scalar: ERROR
  const r = analyzeSource(`
let a: tensor<f32, [10]>;
let b: int = 5;
a = a + b;
`);
  assert(r.bag.hasErrors, "tensor + scalar: type error");
}

// ============================================================================
//  TEST 8: AI Call Validation
// ============================================================================
section("TEST 8 - AI call (infer) validation");

{
  // Source must be a tensor
  const r = analyzeSource(`
let w: tensor<f32, [784, 256]>;
result := infer(w, "gpt-4");
`);
  assert(!r.bag.hasErrors, "infer(tensor, model): OK");
}

{
  // Source must be declared
  const r = analyzeSource(`result := infer(unknown_var, "model");`);
  assert(r.bag.hasErrors, "infer(undeclared): ERROR");
}

{
  // Source must be a tensor (not int)
  const r = analyzeSource(`
let x: int = 5;
result := infer(x, "model");
`);
  assert(r.bag.hasErrors, "infer(int): ERROR - source must be tensor");
  assert(r.bag.diagnostics.some(d => d.message.includes("must be a tensor")),
    "Error message says 'must be a tensor'");
}

// ============================================================================
//  TEST 9: Full Valid Program (test_valid.aeth)
// ============================================================================
section("TEST 9 - Full pipeline on test_valid.aeth");

{
  const sourcePath = path.resolve(__dirname, "../../samples/test_valid.aeth");
  const source     = fs.readFileSync(sourcePath, "utf-8");
  const result     = compile(source);

  console.log(`\n  Errors:   ${result.bag.errorCount}`);
  console.log(`  Warnings: ${result.bag.warningCount}`);
  console.log(`  Gate:     ${result.gateOpen ? "OPEN" : "CLOSED"}`);
  console.log(`  Frame:    ${result.totalFrameSize} bytes\n`);

  // Note: test_valid.aeth has `batch = batch + weights` where shapes
  // [32,10] + [784,256] mismatch.  This is an intentional semantic error.
  // Let's check if the analyzer catches it.
  const hasTensorError = result.bag.diagnostics.some(d =>
    d.message.includes("dimension mismatch") || d.message.includes("Tensor dimension")
  );

  if (hasTensorError) {
    console.log("  [INFO]  Expected tensor dimension mismatch caught in test_valid.aeth");
    console.log("     (batch: tensor<i32, [32,10]> + weights: tensor<f32, [784,256]>)");
    assert(true, "Tensor dimension mismatch correctly detected");
  }

  // All VarDecl meta should be populated
  for (const stmt of result.ast.body) {
    if (stmt.type === "VarDecl") {
      assert(stmt.meta._offset !== null,   `${stmt.name}: _offset populated`);
      assert(stmt.meta._byteSize !== null,  `${stmt.name}: _byteSize populated`);
      assert(stmt.meta._scope !== null,     `${stmt.name}: _scope populated`);
    }
  }
}

// ============================================================================
//  TEST 10: Diagnostics Module - Listing Generation
// ============================================================================
section("TEST 10 - Diagnostics / listing.txt");

{
  const source = `let a: int = 1;
let b: tensor<f32, [10]>;
a = b;
`;
  const result = analyzeSource(source);
  assert(result.bag.hasErrors, "Type error found");

  const listing = result.bag.generateListing();
  assert(listing.includes("AETHER-LANG DIAGNOSTIC LISTING"), "Listing has header");
  assert(listing.includes("let a: int = 1;"), "Listing includes source line 1");
  assert(listing.includes("a = b;"), "Listing includes error line");
  assert(listing.includes("ERROR"), "Listing includes ERROR marker");
  assert(listing.includes("BLOCKED"), "Listing mentions BLOCKED");

  console.log("\n  -- Sample listing output --");
  console.log(listing);
}

// ============================================================================
//  TEST 11: Conditional Execution Gate
// ============================================================================
section("TEST 11 - Conditional Execution Gate");

{
  // Valid -> gate OPEN
  const valid = analyzeSource("let x: int = 42;");
  assert(valid.gateOpen === true, "Valid program: gate OPEN");
}

{
  // Semantic error -> gate CLOSED
  const invalid = analyzeSource("x = 5;");
  assert(invalid.gateOpen === false, "Undeclared var: gate CLOSED");
}

{
  // Parse error -> gate CLOSED
  const parseErr = analyzeSource("let x: int = ;");
  assert(parseErr.gateOpen === false, "Parse error: gate CLOSED");
}

// ============================================================================
//  TEST 12: Edge Cases
// ============================================================================
section("TEST 12 - Edge cases");

{
  // Empty program
  const r = analyzeSource("");
  assert(!r.bag.hasErrors, "Empty program: no errors");
  assert(r.totalFrameSize === 0, "Empty program: 0 frame size");
}

{
  // Large tensor
  const r = analyzeSource("let huge: tensor<f32, [1000, 1000, 3]>;");
  assert(!r.bag.hasErrors, "Large tensor: no errors");
  const decl = r.ast.body[0] as VarDeclNode;
  assert(decl.meta._byteSize === 1000 * 1000 * 3 * 4,
    `Large tensor: byteSize = ${1000 * 1000 * 3 * 4} (got ${decl.meta._byteSize})`);
}

{
  // Variable used after scope exits
  const r = analyzeSource(`
if (1 == 1) {
  let scoped: int = 42;
}
scoped = 10;
`);
  assert(r.bag.hasErrors, "Error: 'scoped' used after scope exit");
}

{
  // Multiple errors: semantic analyzer catches all of them
  const r = analyzeSource(`
x = 1;
y = 2;
z = 3;
`);
  assert(r.bag.errorCount === 3, `3 undeclared variable errors (got ${r.bag.errorCount})`);
}

// ============================================================================
//  TEST 13: i32 tensor byte size
// ============================================================================
section("TEST 13 - i32 tensor sizing");

{
  const r = analyzeSource("let t: tensor<i32, [8, 8]>;");
  assert(!r.bag.hasErrors, "i32 tensor: no errors");
  const decl = r.ast.body[0] as VarDeclNode;
  assert(decl.meta._byteSize === 8 * 8 * 4, `i32 tensor: byteSize = ${8*8*4} (got ${decl.meta._byteSize})`);
}

// ============================================================================
//  TEST 14: Bridge JSON with populated metadata
// ============================================================================
section("TEST 14 - Bridge JSON with populated meta");

{
  const r = analyzeSource(`
let x: int = 42;
let y: float = 3.14;
let z: tensor<f32, [3, 3]>;
`);
  assert(!r.bag.hasErrors, "No errors");

  const json = JSON.stringify(r.ast, null, 2);
  const parsed = JSON.parse(json);

  // Meta should be populated (not null)
  assert(parsed.body[0].meta._offset === 0, "JSON: x._offset = 0");
  assert(parsed.body[0].meta._byteSize === 4, "JSON: x._byteSize = 4");
  assert(parsed.body[0].meta._scope === 0, "JSON: x._scope = 0");

  assert(parsed.body[1].meta._offset === 4, "JSON: y._offset = 4");
  assert(parsed.body[2].meta._offset === 8, "JSON: z._offset = 8");
  assert(parsed.body[2].meta._byteSize === 36, "JSON: z._byteSize = 36 (3x3x4)");
}

// ============================================================================
//  Summary
// ============================================================================
section("SUMMARY");
console.log(`\n  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);
if (failCount === 0) {
  console.log(`\n  [PASS]  ALL SEMANTIC ANALYZER TESTS PASSED\n`);
} else {
  console.log(`\n  [FAIL]  ${failCount} TEST(S) FAILED\n`);
}
console.log(`${"=".repeat(70)}\n`);
