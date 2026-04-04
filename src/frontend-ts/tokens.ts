// ============================================================================
// Aether-Lang - Token Definitions
// ============================================================================
// Every token the lexer produces carries its `line` and `column` of origin,
// enabling precise diagnostic messages in later pipeline stages.
// ============================================================================

/**
 * Exhaustive enumeration of token types produced by the Aether-Lang lexer.
 *
 * Naming convention:
 *   - Keywords     -> K_<KEYWORD>
 *   - Operators    -> OP_<NAME>
 *   - Delimiters   -> DLM_<NAME>
 *   - Literals     -> LIT_<KIND>
 *   - Special      -> descriptive name
 */
export enum TokenType {

  // --- Keywords ----------------------------------------------------------
  K_LET         = "K_LET",          // let
  K_IF          = "K_IF",           // if
  K_ELSE        = "K_ELSE",         // else
  K_INT         = "K_INT",          // int  (type keyword)
  K_FLOAT       = "K_FLOAT",        // float (type keyword)
  K_TENSOR      = "K_TENSOR",       // tensor
  K_F32         = "K_F32",          // f32  (base type)
  K_I32         = "K_I32",          // i32  (base type)
  K_INFER       = "K_INFER",        // infer (AI call)
  K_REMOTE      = "K_REMOTE",       // remote (cloud block)

  // --- Identifiers & Literals --------------------------------------------
  IDENTIFIER    = "IDENTIFIER",
  LIT_INTEGER   = "LIT_INTEGER",    // 42
  LIT_FLOAT     = "LIT_FLOAT",      // 3.14
  LIT_STRING    = "LIT_STRING",     // "gpt-4"  (inside double-quotes)

  // --- Operators ---------------------------------------------------------
  OP_PLUS       = "OP_PLUS",        // +
  OP_MINUS      = "OP_MINUS",       // -
  OP_STAR       = "OP_STAR",        // *
  OP_SLASH      = "OP_SLASH",       // /
  OP_ASSIGN     = "OP_ASSIGN",      // =
  OP_COLON_EQ   = "OP_COLON_EQ",    // :=  (AI inference binding)
  OP_LT         = "OP_LT",          // <
  OP_GT         = "OP_GT",          // >

  // --- Comparison Operators (for if-statement conditions) ----------------
  OP_EQ         = "OP_EQ",          // ==
  OP_NEQ        = "OP_NEQ",         // !=
  OP_LTE        = "OP_LTE",         // <=
  OP_GTE        = "OP_GTE",         // >=

  // --- Delimiters --------------------------------------------------------
  DLM_LPAREN    = "DLM_LPAREN",     // (
  DLM_RPAREN    = "DLM_RPAREN",     // )
  DLM_LBRACE    = "DLM_LBRACE",     // {
  DLM_RBRACE    = "DLM_RBRACE",     // }
  DLM_LBRACKET  = "DLM_LBRACKET",   // [
  DLM_RBRACKET  = "DLM_RBRACKET",   // ]
  DLM_COMMA     = "DLM_COMMA",      // ,
  DLM_COLON     = "DLM_COLON",      // :
  DLM_SEMICOLON = "DLM_SEMICOLON",  // ;

  // --- Special -----------------------------------------------------------
  EOF           = "EOF",
  ILLEGAL       = "ILLEGAL",        // Unrecognised character
}

// --- Keyword Lookup Table -------------------------------------------------
/** Maps reserved word lexemes to their token types. */
export const KEYWORDS: ReadonlyMap<string, TokenType> = new Map<string, TokenType>([
  ["let",    TokenType.K_LET],
  ["if",     TokenType.K_IF],
  ["else",   TokenType.K_ELSE],
  ["int",    TokenType.K_INT],
  ["float",  TokenType.K_FLOAT],
  ["tensor", TokenType.K_TENSOR],
  ["f32",    TokenType.K_F32],
  ["i32",    TokenType.K_I32],
  ["infer",  TokenType.K_INFER],
  ["remote", TokenType.K_REMOTE],
]);

// --- Source Location ------------------------------------------------------
/** Pinpoints a character position in the source file. */
export interface SourceLocation {
  /** 1-based line number. */
  line:   number;
  /** 1-based column number. */
  column: number;
}

// --- Token -----------------------------------------------------------------
/**
 * An immutable lexical token produced by the scanner.
 *
 * `lexeme` preserves the original source text so the Diagnostics Module
 * can reproduce exact snippets when generating `listing.txt`.
 */
export interface Token {
  /** Discriminant tag. */
  readonly type:   TokenType;
  /** Verbatim source text of this token. */
  readonly lexeme: string;
  /** Where the token begins in the source. */
  readonly loc:    SourceLocation;
}

// --- Factory helper --------------------------------------------------------
/** Creates a frozen Token value. */
export function makeToken(
  type:   TokenType,
  lexeme: string,
  line:   number,
  column: number,
): Token {
  return Object.freeze({ type, lexeme, loc: Object.freeze({ line, column }) });
}
