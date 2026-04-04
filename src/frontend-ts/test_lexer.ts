// ============================================================================
// Aether-Lang - Lexer Test Harness
// ============================================================================
// Run: npx ts-node src/frontend-ts/test_lexer.ts
// Or:  npm run test:lexer
// ============================================================================

import * as fs   from "fs";
import * as path from "path";
import { Lexer }         from "./lexer";
import { TokenType }     from "./tokens";
import type { Token }    from "./tokens";

// --- Formatting helpers --------------------------------------------------

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

function formatToken(tok: Token): string {
  const loc    = `${tok.loc.line}:${tok.loc.column}`;
  const type   = padRight(tok.type, 18);
  const lexeme = tok.lexeme.replace(/\n/g, "\\n");
  return `  ${padRight(loc, 8)} ${type} ${lexeme}`;
}

// --- Test runner ---------------------------------------------------------

function runTest(label: string, filePath: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(70)}`);

  if (!fs.existsSync(filePath)) {
    console.error(`  X File not found: ${filePath}`);
    return;
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const lexer  = new Lexer(source);
  const tokens = lexer.tokenize();

  // Print token table
  console.log(`\n  ${"LOC".padEnd(8)} ${"TYPE".padEnd(18)} LEXEME`);
  console.log(`  ${"-".repeat(60)}`);
  for (const tok of tokens) {
    console.log(formatToken(tok));
  }

  // Print diagnostics (if any)
  if (lexer.diagnostics.length > 0) {
    console.log(`\n  !  Lexer Diagnostics (${lexer.diagnostics.length}):`);
    for (const d of lexer.diagnostics) {
      console.log(`     [${d.line}:${d.column}] ${d.message}`);
    }
  } else {
    console.log(`\n  OK No lexer diagnostics.`);
  }

  // Stats
  const countByType = new Map<TokenType, number>();
  for (const tok of tokens) {
    countByType.set(tok.type, (countByType.get(tok.type) ?? 0) + 1);
  }
  console.log(`\n  Token summary (${tokens.length} total):`);
  for (const [type, count] of [...countByType.entries()].sort()) {
    console.log(`    ${padRight(type, 18)} x ${count}`);
  }
}

// --- Main ----------------------------------------------------------------

const samplesDir = path.resolve(__dirname, "../../samples");

runTest("TEST 1 - Valid Program (test_valid.aeth)",   path.join(samplesDir, "test_valid.aeth"));
runTest("TEST 2 - Invalid Program (test_invalid.aeth)", path.join(samplesDir, "test_invalid.aeth"));

// --- Inline micro-tests --------------------------------------------------
console.log(`\n${"=".repeat(70)}`);
console.log("  TEST 3 - Micro-tests (inline assertions)");
console.log(`${"=".repeat(70)}\n`);

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  OK ${label}`);
  } else {
    console.error(`  X  FAILED: ${label}`);
    process.exitCode = 1;
  }
}

// 3a. Float vs integer disambiguation
{
  const tokens = new Lexer("42 3.14 100").tokenize();
  assert(tokens[0].type === TokenType.LIT_INTEGER,   "42 is LIT_INTEGER");
  assert(tokens[0].lexeme === "42",                   "42 lexeme exact");
  assert(tokens[1].type === TokenType.LIT_FLOAT,      "3.14 is LIT_FLOAT");
  assert(tokens[1].lexeme === "3.14",                  "3.14 lexeme exact");
  assert(tokens[2].type === TokenType.LIT_INTEGER,    "100 is LIT_INTEGER");
}

// 3b. String literal (IP address)
{
  const tokens = new Lexer('"192.168.1.1"').tokenize();
  assert(tokens[0].type === TokenType.LIT_STRING,     'IP in quotes is LIT_STRING');
  assert(tokens[0].lexeme === '"192.168.1.1"',         'IP lexeme is exact');
}

// 3c. String literal (model reference)
{
  const tokens = new Lexer('"gpt-4/turbo"').tokenize();
  assert(tokens[0].type === TokenType.LIT_STRING,     'Model ref is LIT_STRING');
  assert(tokens[0].lexeme === '"gpt-4/turbo"',         'Model ref lexeme is exact');
}

// 3d. Colon-equals vs colon + equals
{
  const tokens = new Lexer(":= : =").tokenize();
  assert(tokens[0].type === TokenType.OP_COLON_EQ,    ':= is OP_COLON_EQ');
  assert(tokens[1].type === TokenType.DLM_COLON,      ': is DLM_COLON');
  assert(tokens[2].type === TokenType.OP_ASSIGN,      '= is OP_ASSIGN');
}

// 3e. Comparison operators
{
  const tokens = new Lexer("== != <= >= < >").tokenize();
  assert(tokens[0].type === TokenType.OP_EQ,   '== is OP_EQ');
  assert(tokens[1].type === TokenType.OP_NEQ,  '!= is OP_NEQ');
  assert(tokens[2].type === TokenType.OP_LTE,  '<= is OP_LTE');
  assert(tokens[3].type === TokenType.OP_GTE,  '>= is OP_GTE');
  assert(tokens[4].type === TokenType.OP_LT,   '< is OP_LT');
  assert(tokens[5].type === TokenType.OP_GT,   '> is OP_GT');
}

// 3f. Keywords vs identifiers
{
  const tokens = new Lexer("let x infer inference tensor tensorFlow").tokenize();
  assert(tokens[0].type === TokenType.K_LET,        'let is K_LET');
  assert(tokens[1].type === TokenType.IDENTIFIER,   'x is IDENTIFIER');
  assert(tokens[2].type === TokenType.K_INFER,      'infer is K_INFER');
  assert(tokens[3].type === TokenType.IDENTIFIER,   'inference is IDENTIFIER (not keyword)');
  assert(tokens[4].type === TokenType.K_TENSOR,     'tensor is K_TENSOR');
  assert(tokens[5].type === TokenType.IDENTIFIER,   'tensorFlow is IDENTIFIER (not keyword)');
}

// 3g. Line/column tracking
{
  const tokens = new Lexer("a\nb\nc").tokenize();
  assert(tokens[0].loc.line === 1 && tokens[0].loc.column === 1, 'a at 1:1');
  assert(tokens[1].loc.line === 2 && tokens[1].loc.column === 1, 'b at 2:1');
  assert(tokens[2].loc.line === 3 && tokens[2].loc.column === 1, 'c at 3:1');
}

// 3h. Unterminated string -> ILLEGAL + diagnostic
{
  const lexer = new Lexer('"hello');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === TokenType.ILLEGAL,      'Unterminated string -> ILLEGAL');
  assert(lexer.diagnostics.length === 1,             'Exactly one diagnostic');
  assert(lexer.diagnostics[0].message.includes("Unterminated"), 'Diagnostic mentions "Unterminated"');
}

// 3i. Comments are skipped
{
  const tokens = new Lexer("a // this is a comment\nb").tokenize();
  assert(tokens.length === 3,                        'Comment produces no token (a, b, EOF)');
  assert(tokens[0].lexeme === "a",                   'First token is a');
  assert(tokens[1].lexeme === "b",                   'Second token is b');
}

// 3j. Tensor type tokens
{
  const tokens = new Lexer("tensor<f32, [784, 256]>").tokenize();
  assert(tokens[0].type === TokenType.K_TENSOR,     'tensor keyword');
  assert(tokens[1].type === TokenType.OP_LT,        '< delimiter');
  assert(tokens[2].type === TokenType.K_F32,        'f32 base type');
  assert(tokens[3].type === TokenType.DLM_COMMA,    ', separator');
  assert(tokens[4].type === TokenType.DLM_LBRACKET, '[ bracket');
  assert(tokens[5].type === TokenType.LIT_INTEGER,  '784 dimension');
  assert(tokens[6].type === TokenType.DLM_COMMA,    ', separator');
  assert(tokens[7].type === TokenType.LIT_INTEGER,  '256 dimension');
  assert(tokens[8].type === TokenType.DLM_RBRACKET, '] bracket');
  assert(tokens[9].type === TokenType.OP_GT,        '> delimiter');
}

console.log(`\n${"=".repeat(70)}`);
console.log("  ALL TESTS COMPLETE");
console.log(`${"=".repeat(70)}\n`);
