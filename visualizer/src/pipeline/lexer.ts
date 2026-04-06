// ============================================================================
// Aether-Lang - Lexical Analyser (Stage 1)
// ============================================================================
// Scans `.aeth` source text into a stream of Tokens.
//
// Design decisions
//   * Every token carries line/column for the Diagnostics Module.
//   * String literals are delimited by `"`, which completely avoids the
//     float-vs-IP-address ambiguity: `3.14` is always a float,
//     `"192.168.1.1"` is always a string literal.
//   * Unrecognised characters emit an ILLEGAL token rather than throwing,
//     enabling Panic Mode Error Recovery in the parser.
//   * Single-line comments start with `//` and are silently consumed.
// ============================================================================

import {
  Token,
  TokenType,
  KEYWORDS,
  makeToken,
} from "./tokens";

// --- Diagnostic Error ------------------------------------------------------
/** A lightweight diagnostic emitted during lexing. */
export interface LexDiagnostic {
  line:    number;
  column:  number;
  message: string;
}

// --- Lexer Class -----------------------------------------------------------
export class Lexer {
  /** Raw source text. */
  private readonly source: string;
  /** Source split into lines (1-indexed via offset). Used by the Diagnostics Module. */
  public readonly sourceLines: string[];
  /** Current absolute offset into `source`. */
  private pos: number = 0;
  /** Current 1-based line number. */
  private line: number = 1;
  /** Current 1-based column number. */
  private column: number = 1;
  /** Diagnostics collected during scanning. */
  public readonly diagnostics: LexDiagnostic[] = [];

  constructor(source: string) {
    this.source = source;
    this.sourceLines = source.split("\n");
  }

  // --- Public API --------------------------------------------------------

  /**
   * Tokenise the entire source, returning an array terminated by an EOF
   * token.  ILLEGAL tokens are emitted for unrecognised characters so the
   * parser can invoke Panic Mode recovery.
   */
  public tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const tok = this.scanToken();
      tokens.push(tok);
    }

    tokens.push(makeToken(TokenType.EOF, "", this.line, this.column));
    return tokens;
  }

  // --- Character-level helpers -------------------------------------------

  /** True when `pos` is at or past the end of source. */
  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  /** Returns the current character without advancing. */
  private peek(): string {
    return this.source[this.pos];
  }

  /** Returns the character one position ahead without advancing. */
  private peekNext(): string {
    if (this.pos + 1 >= this.source.length) return "\0";
    return this.source[this.pos + 1];
  }

  /** Consumes and returns the current character, advancing line/column. */
  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  /**
   * Consumes the current character only if it matches `expected`.
   * Returns true on match.
   */
  /* private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source.substring(this.current, this.current + expected.length) !== expected) {
      return false;
    }
    this.current += expected.length;
    return true;
  } */

  // --- Whitespace & Comments ---------------------------------------------

  /** Skips spaces, tabs, newlines, and `//`-style line comments. */
  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.advance();
        continue;
      }

      // Single-line comment
      if (ch === "/" && this.peekNext() === "/") {
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  // --- Token Scanners ----------------------------------------------------

  /** Main dispatch - called once per token. */
  private scanToken(): Token {
    const startLine   = this.line;
    const startColumn = this.column;
    const ch          = this.peek();

    // --- String Literal ----------------------------------------------
    if (ch === '"') return this.scanString();

    // --- Numeric Literal (int or float) ------------------------------
    if (this.isDigit(ch)) return this.scanNumber();

    // --- Identifier / Keyword ----------------------------------------
    if (this.isAlpha(ch)) return this.scanIdentifier();

    // --- Two-character operators (must be checked before singles) -----
    // :=
    if (ch === ":" && this.peekNext() === "=") {
      this.advance(); this.advance();
      return makeToken(TokenType.OP_COLON_EQ, ":=", startLine, startColumn);
    }
    // ==
    if (ch === "=" && this.peekNext() === "=") {
      this.advance(); this.advance();
      return makeToken(TokenType.OP_EQ, "==", startLine, startColumn);
    }
    // !=
    if (ch === "!" && this.peekNext() === "=") {
      this.advance(); this.advance();
      return makeToken(TokenType.OP_NEQ, "!=", startLine, startColumn);
    }
    // <=
    if (ch === "<" && this.peekNext() === "=") {
      this.advance(); this.advance();
      return makeToken(TokenType.OP_LTE, "<=", startLine, startColumn);
    }
    // >=
    if (ch === ">" && this.peekNext() === "=") {
      this.advance(); this.advance();
      return makeToken(TokenType.OP_GTE, ">=", startLine, startColumn);
    }

    // --- Single-character operators & delimiters ---------------------
    this.advance(); // consume the character

    switch (ch) {
      case "+": return makeToken(TokenType.OP_PLUS,       ch, startLine, startColumn);
      case "-": return makeToken(TokenType.OP_MINUS,      ch, startLine, startColumn);
      case "*": return makeToken(TokenType.OP_STAR,       ch, startLine, startColumn);
      case "/": return makeToken(TokenType.OP_SLASH,      ch, startLine, startColumn);
      case "=": return makeToken(TokenType.OP_ASSIGN,     ch, startLine, startColumn);
      case "<": return makeToken(TokenType.OP_LT,         ch, startLine, startColumn);
      case ">": return makeToken(TokenType.OP_GT,         ch, startLine, startColumn);
      case "(": return makeToken(TokenType.DLM_LPAREN,    ch, startLine, startColumn);
      case ")": return makeToken(TokenType.DLM_RPAREN,    ch, startLine, startColumn);
      case "{": return makeToken(TokenType.DLM_LBRACE,    ch, startLine, startColumn);
      case "}": return makeToken(TokenType.DLM_RBRACE,    ch, startLine, startColumn);
      case "[": return makeToken(TokenType.DLM_LBRACKET,  ch, startLine, startColumn);
      case "]": return makeToken(TokenType.DLM_RBRACKET,  ch, startLine, startColumn);
      case ",": return makeToken(TokenType.DLM_COMMA,     ch, startLine, startColumn);
      case ":": return makeToken(TokenType.DLM_COLON,     ch, startLine, startColumn);
      case ";": return makeToken(TokenType.DLM_SEMICOLON, ch, startLine, startColumn);
    }

    // --- Illegal Character -------------------------------------------
    this.diagnostics.push({
      line:    startLine,
      column:  startColumn,
      message: `Unexpected character '${ch}' (U+${ch.charCodeAt(0).toString(16).padStart(4, "0")})`,
    });
    return makeToken(TokenType.ILLEGAL, ch, startLine, startColumn);
  }

  // --- Number Scanner ----------------------------------------------------
  /**
   * Scans an integer or floating-point literal.
   *
   * Grammar:
   *   integer = digit { digit } ;
   *   float   = digit { digit } "." { digit } ;
   *
   * Because string literals are always enclosed in `"`, there is zero
   * ambiguity between `192.168.1.1` (which would be scanned in a string)
   * and `3.14` (which is a float).
   */
  private scanNumber(): Token {
    const startLine   = this.line;
    const startColumn = this.column;
    let lexeme = "";

    // Integer part
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      lexeme += this.advance();
    }

    // Check for fractional part
    if (!this.isAtEnd() && this.peek() === "." && this.isDigitOrEnd(this.peekNext())) {
      lexeme += this.advance(); // consume '.'

      // Fractional digits
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        lexeme += this.advance();
      }

      return makeToken(TokenType.LIT_FLOAT, lexeme, startLine, startColumn);
    }

    return makeToken(TokenType.LIT_INTEGER, lexeme, startLine, startColumn);
  }

  // --- String Scanner ----------------------------------------------------
  /**
   * Scans a `"string_literal"`.
   *
   * The grammar's `string_literal` production accepts letters, digits,
   * `_`, `-`, `.`, and `/`.  We are deliberately permissive inside quotes
   * to also accept `:` (for ports like `192.168.1.1:8080`) and any other
   * printable character that may appear in model paths or URLs.
   *
   * The lexeme includes the surrounding quotes; downstream stages can
   * strip them trivially with `lexeme.slice(1, -1)`.
   */
  private scanString(): Token {
    const startLine   = this.line;
    const startColumn = this.column;
    let lexeme = "";

    lexeme += this.advance(); // opening "

    while (!this.isAtEnd() && this.peek() !== '"' && this.peek() !== "\n") {
      lexeme += this.advance();
    }

    if (this.isAtEnd() || this.peek() === "\n") {
      this.diagnostics.push({
        line:    startLine,
        column:  startColumn,
        message: `Unterminated string literal`,
      });
      return makeToken(TokenType.ILLEGAL, lexeme, startLine, startColumn);
    }

    lexeme += this.advance(); // closing "
    return makeToken(TokenType.LIT_STRING, lexeme, startLine, startColumn);
  }

  // --- Identifier / Keyword Scanner --------------------------------------
  /**
   * Scans identifiers and resolves keywords via the lookup table.
   *
   * Grammar:
   *   identifier = letter { letter | digit | "_" } ;
   */
  private scanIdentifier(): Token {
    const startLine   = this.line;
    const startColumn = this.column;
    let lexeme = "";

    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
      lexeme += this.advance();
    }

    const keyword = KEYWORDS.get(lexeme);
    const type    = keyword ?? TokenType.IDENTIFIER;
    return makeToken(type, lexeme, startLine, startColumn);
  }

  // --- Character classification ------------------------------------------

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") ||
           (ch >= "A" && ch <= "Z") ||
           ch === "_";
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  /**
   * Returns true if `ch` is a digit **or** if we've reached the end.
   * Used when deciding whether `42.` should be treated as a float
   * (i.e. `42.0` with zero fractional digits) or rejected.
   */
  private isDigitOrEnd(ch: string): boolean {
    return this.isDigit(ch) || ch === "\0";
  }
}
