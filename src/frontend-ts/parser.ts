// ============================================================================
// Aether-Lang - Recursive Descent Parser (Stage 2)
// ============================================================================
// Consumes a Token[] from the Lexer and builds a pure-data AST.
//
// Key design decisions:
//   1. **Panic Mode Error Recovery** - on any syntax error the parser calls
//      `synchronize()` which skips tokens until `;`, `}`, or EOF, then
//      resumes with the next statement.  This allows reporting *multiple*
//      errors per compilation.
//   2. **No exceptions** - errors are collected into a public
//      `diagnostics` array.  The parser always returns a valid
//      `ProgramNode` (possibly containing `ErrorStatement` nodes).
//   3. **Operator Precedence** - `expression()` handles `+`/`-`,
//      `term()` handles `*`/`/`, matching standard arithmetic precedence.
//   4. **`:=` is not assignment** - `identifier := infer(...)` is parsed
//      as a specialised `AiCallNode`, never as a variable assignment.
//   5. **Pure data output** - every node is a plain object; the result
//      is JSON-serialisable for the C++ Backend Bridge.
// ============================================================================

import { Token, TokenType, SourceLocation } from "./tokens";
import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  TypeNode,
  SourceRange,
  makeProgramNode,
  makeVarDecl,
  makeAssignment,
  makeAiCall,
  makeCloudBlock,
  makeIfStatement,
  makeErrorStatement,
  makeSimpleType,
  makeTensorType,
  makeBinaryExpr,
  makeComparisonExpr,
  makeIdentifier,
  makeIntLiteral,
  makeFloatLiteral,
  makeParenExpr,
} from "./ast";

// -- Parser Diagnostic -------------------------------------------------------
export interface ParseDiagnostic {
  line:    number;
  column:  number;
  message: string;
}

// -- Parse Error (internal control flow) -------------------------------------
/** Thrown internally to trigger Panic Mode synchronisation.  Never escapes
 *  the Parser class - caught immediately in `parseStatement()`. */
class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ============================================================================
//  Parser
// ============================================================================

export class Parser {
  /** Token stream from the Lexer. */
  private readonly tokens: Token[];
  /** Current position in the token stream. */
  private pos: number = 0;
  /** Accumulated diagnostics. */
  public readonly diagnostics: ParseDiagnostic[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ========================================================================
  //  Public API
  // ========================================================================

  /**
   * Parse the entire token stream into a `ProgramNode`.
   *
   * ```
   * program = { statement } ;
   * ```
   */
  public parseProgram(): ProgramNode {
    const range = this.currentRange();
    const body: StatementNode[] = [];

    while (!this.isAtEnd()) {
      // Skip stray semicolons (the grammar allows bare `;` as a statement)
      if (this.check(TokenType.DLM_SEMICOLON)) {
        this.advance();
        continue;
      }
      body.push(this.parseStatement());
    }

    return makeProgramNode(body, range);
  }

  // ========================================================================
  //  Statement Parsers
  // ========================================================================

  /**
   * ```
   * statement = var_decl | assignment | ai_call
   *           | cloud_block | if_statement | ";" ;
   * ```
   *
   * This method wraps every parsing attempt in a try/catch so that a
   * `ParseError` triggers Panic Mode synchronisation instead of aborting
   * the entire parse.
   */
  private parseStatement(): StatementNode {
    try {
      // -- Keywords first ------------------------------------------
      if (this.check(TokenType.K_LET))    return this.parseVarDecl();
      if (this.check(TokenType.K_IF))     return this.parseIfStatement();
      if (this.check(TokenType.K_REMOTE)) return this.parseCloudBlock();

      // -- Identifier-led statements -------------------------------
      //   assignment   -> identifier "=" expression ";"
      //   ai_call      -> identifier ":=" "infer" "(" ... ")" ";"
      if (this.check(TokenType.IDENTIFIER)) {
        return this.parseIdentifierStatement();
      }

      // -- Nothing matched -----------------------------------------
      throw this.error(this.peek(), `Unexpected token '${this.peek().lexeme}'`);

    } catch (e) {
      if (e instanceof ParseError) {
        // Panic Mode: skip to synchronisation point, emit ErrorStatement
        const range = this.currentRange();
        this.synchronize();
        return makeErrorStatement(e.message, range);
      }
      throw e; // re-throw non-parse errors (bugs)
    }
  }

  // -- let declarations ----------------------------------------------------
  /**
   * ```
   * var_decl = "let" identifier ":" type [ "=" expression ] ";" ;
   * ```
   */
  private parseVarDecl(): StatementNode {
    const range = this.currentRange();
    this.expect(TokenType.K_LET, "'let'");

    const nameTok = this.expect(TokenType.IDENTIFIER, "variable name");
    this.expect(TokenType.DLM_COLON, "':'");

    const varType = this.parseType();

    let init: ExpressionNode | null = null;
    if (this.check(TokenType.OP_ASSIGN)) {
      this.advance(); // consume '='
      init = this.parseExpression();
    }

    this.expect(TokenType.DLM_SEMICOLON, "';'");
    return makeVarDecl(nameTok.lexeme, varType, init, range);
  }

  // -- Identifier-leading statements (assignment or ai_call) -------------
  /**
   * Disambiguates between:
   *   assignment -> identifier "=" expression ";"
   *   ai_call    -> identifier ":=" "infer" "(" identifier "," model_ref ")" ";"
   */
  private parseIdentifierStatement(): StatementNode {
    const range   = this.currentRange();
    const nameTok = this.advance(); // consume identifier

    // -- AI Inference Call (:=) --------------------------------------
    if (this.check(TokenType.OP_COLON_EQ)) {
      return this.parseAiCall(nameTok.lexeme, range);
    }

    // -- Assignment (=) ----------------------------------------------
    this.expect(TokenType.OP_ASSIGN, "'=' or ':='");
    const value = this.parseExpression();
    this.expect(TokenType.DLM_SEMICOLON, "';'");
    return makeAssignment(nameTok.lexeme, value, range);
  }

  // -- AI Call -----------------------------------------------------------
  /**
   * ```
   * ai_call = identifier ":=" "infer" "(" identifier "," model_ref ")" ";"
   * model_ref = "\"" string_literal "\""
   * ```
   */
  private parseAiCall(target: string, range: SourceRange): StatementNode {
    this.expect(TokenType.OP_COLON_EQ, "':='");
    this.expect(TokenType.K_INFER,     "'infer'");
    this.expect(TokenType.DLM_LPAREN,  "'('");

    const sourceTok = this.expect(TokenType.IDENTIFIER, "source identifier");

    this.expect(TokenType.DLM_COMMA, "','");

    const modelTok  = this.expect(TokenType.LIT_STRING, "model reference string");
    // Strip surrounding quotes: "gpt-4" -> gpt-4
    const modelRef  = modelTok.lexeme.slice(1, -1);

    this.expect(TokenType.DLM_RPAREN,    "')'");
    this.expect(TokenType.DLM_SEMICOLON, "';'");

    return makeAiCall(target, sourceTok.lexeme, modelRef, range);
  }

  // -- Cloud Block -------------------------------------------------------
  /**
   * ```
   * cloud_block = "remote" "(" ip_address ")" "{" { statement } "}" ;
   * ip_address  = "\"" string_literal "\""
   * ```
   */
  private parseCloudBlock(): StatementNode {
    const range = this.currentRange();
    this.expect(TokenType.K_REMOTE,   "'remote'");
    this.expect(TokenType.DLM_LPAREN, "'('");

    const ipTok     = this.expect(TokenType.LIT_STRING, "IP address string");
    const ipAddress = ipTok.lexeme.slice(1, -1);

    this.expect(TokenType.DLM_RPAREN, "')'");
    this.expect(TokenType.DLM_LBRACE, "'{'");

    const body = this.parseBlock();

    this.expect(TokenType.DLM_RBRACE, "'}'");
    return makeCloudBlock(ipAddress, body, range);
  }

  // -- If Statement ------------------------------------------------------
  /**
   * ```
   * if_statement = "if" "(" expression ")" "{" { statement } "}"
   *                [ "else" "{" { statement } "}" ] ;
   * ```
   */
  private parseIfStatement(): StatementNode {
    const range = this.currentRange();
    this.expect(TokenType.K_IF,       "'if'");
    this.expect(TokenType.DLM_LPAREN, "'('");

    const condition = this.parseComparison();

    this.expect(TokenType.DLM_RPAREN, "')'");
    this.expect(TokenType.DLM_LBRACE, "'{'");

    const consequent = this.parseBlock();
    this.expect(TokenType.DLM_RBRACE, "'}'");

    let alternate: StatementNode[] | null = null;
    if (this.check(TokenType.K_ELSE)) {
      this.advance(); // consume 'else'
      this.expect(TokenType.DLM_LBRACE, "'{'");
      alternate = this.parseBlock();
      this.expect(TokenType.DLM_RBRACE, "'}'");
    }

    return makeIfStatement(condition, consequent, alternate, range);
  }

  // -- Block (shared helper) ---------------------------------------------
  /** Parses statements until `}` or EOF. Does NOT consume the closing `}`. */
  private parseBlock(): StatementNode[] {
    const stmts: StatementNode[] = [];
    while (!this.check(TokenType.DLM_RBRACE) && !this.isAtEnd()) {
      if (this.check(TokenType.DLM_SEMICOLON)) {
        this.advance();
        continue;
      }
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // ========================================================================
  //  Type Parsers
  // ========================================================================

  /**
   * ```
   * type = "int" | "float" | tensor_type ;
   * ```
   */
  private parseType(): TypeNode {
    const range = this.currentRange();

    if (this.check(TokenType.K_INT)) {
      this.advance();
      return makeSimpleType("int", range);
    }
    if (this.check(TokenType.K_FLOAT)) {
      this.advance();
      return makeSimpleType("float", range);
    }
    if (this.check(TokenType.K_TENSOR)) {
      return this.parseTensorType();
    }

    throw this.error(this.peek(), `Expected type ('int', 'float', or 'tensor'), got '${this.peek().lexeme}'`);
  }

  /**
   * ```
   * tensor_type    = "tensor" "<" base_type "," "[" dimension_list "]" ">" ;
   * base_type      = "f32" | "i32" ;
   * dimension_list = integer { "," integer } ;
   * ```
   */
  private parseTensorType(): TypeNode {
    const range = this.currentRange();
    this.expect(TokenType.K_TENSOR, "'tensor'");
    this.expect(TokenType.OP_LT,   "'<'");

    // base_type
    let baseType: "f32" | "i32";
    if (this.check(TokenType.K_F32)) {
      baseType = "f32";
      this.advance();
    } else if (this.check(TokenType.K_I32)) {
      baseType = "i32";
      this.advance();
    } else {
      throw this.error(this.peek(), `Expected base type ('f32' or 'i32'), got '${this.peek().lexeme}'`);
    }

    this.expect(TokenType.DLM_COMMA,    "','");
    this.expect(TokenType.DLM_LBRACKET, "'['");

    // dimension_list: at least one integer, then { "," integer }
    const dimensions: number[] = [];
    const firstDim = this.expect(TokenType.LIT_INTEGER, "dimension (integer)");
    dimensions.push(parseInt(firstDim.lexeme, 10));

    while (this.check(TokenType.DLM_COMMA)) {
      this.advance(); // consume ','
      // Guard: if next token isn't an integer, report error
      if (!this.check(TokenType.LIT_INTEGER)) {
        throw this.error(this.peek(), `Expected dimension (integer) after ',', got '${this.peek().lexeme}'`);
      }
      const dim = this.advance();
      dimensions.push(parseInt(dim.lexeme, 10));
    }

    this.expect(TokenType.DLM_RBRACKET, "']'");
    this.expect(TokenType.OP_GT,        "'>'");

    return makeTensorType(baseType, dimensions, range);
  }

  // ========================================================================
  //  Expression Parsers (Precedence Climbing)
  // ========================================================================

  /**
   * Top-level comparison expression for `if` conditions.
   *
   * ```
   * comparison = expression ( ("==" | "!=" | "<" | ">" | "<=" | ">=") expression )? ;
   * ```
   */
  private parseComparison(): ExpressionNode {
    const range = this.currentRange();
    let left = this.parseExpression();

    const compOps: TokenType[] = [
      TokenType.OP_EQ,  TokenType.OP_NEQ,
      TokenType.OP_LT,  TokenType.OP_GT,
      TokenType.OP_LTE, TokenType.OP_GTE,
    ];

    if (this.checkAny(compOps)) {
      const opTok = this.advance();
      const right = this.parseExpression();
      const op = opTok.lexeme as "==" | "!=" | "<" | ">" | "<=" | ">=";
      left = makeComparisonExpr(op, left, right, range);
    }

    return left;
  }

  /**
   * Additive expressions (lowest arithmetic precedence).
   *
   * ```
   * expression = term { ( "+" | "-" ) term } ;
   * ```
   */
  private parseExpression(): ExpressionNode {
    const range = this.currentRange();
    let left = this.parseTerm();

    while (this.check(TokenType.OP_PLUS) || this.check(TokenType.OP_MINUS)) {
      const opTok = this.advance();
      const right = this.parseTerm();
      const op    = opTok.lexeme as "+" | "-";
      left = makeBinaryExpr(op, left, right, range);
    }

    return left;
  }

  /**
   * Multiplicative expressions (higher precedence than +/-).
   *
   * ```
   * term = factor { ( "*" | "/" ) factor } ;
   * ```
   */
  private parseTerm(): ExpressionNode {
    const range = this.currentRange();
    let left = this.parseFactor();

    while (this.check(TokenType.OP_STAR) || this.check(TokenType.OP_SLASH)) {
      const opTok = this.advance();
      const right = this.parseFactor();
      const op    = opTok.lexeme as "*" | "/";
      left = makeBinaryExpr(op, left, right, range);
    }

    return left;
  }

  /**
   * Primary (atomic) expressions.
   *
   * ```
   * factor = identifier | integer | float | "(" expression ")" ;
   * ```
   */
  private parseFactor(): ExpressionNode {
    const range = this.currentRange();

    // Identifier
    if (this.check(TokenType.IDENTIFIER)) {
      const tok = this.advance();
      return makeIdentifier(tok.lexeme, range);
    }

    // Integer literal
    if (this.check(TokenType.LIT_INTEGER)) {
      const tok = this.advance();
      return makeIntLiteral(parseInt(tok.lexeme, 10), range);
    }

    // Float literal
    if (this.check(TokenType.LIT_FLOAT)) {
      const tok = this.advance();
      return makeFloatLiteral(parseFloat(tok.lexeme), range);
    }

    // Parenthesised expression
    if (this.check(TokenType.DLM_LPAREN)) {
      this.advance(); // consume '('
      const expr = this.parseExpression();
      this.expect(TokenType.DLM_RPAREN, "')'");
      return makeParenExpr(expr, range);
    }

    throw this.error(this.peek(), `Expected expression, got '${this.peek().lexeme}'`);
  }

  // ========================================================================
  //  Panic Mode Error Recovery
  // ========================================================================

  /**
   * Record an error and return a `ParseError` (does **not** throw).
   * The caller must `throw` the returned error to enter Panic Mode.
   */
  private error(token: Token, message: string): ParseError {
    const loc = token.loc;
    const fullMsg = `[${loc.line}:${loc.column}] ${message}`;
    this.diagnostics.push({ line: loc.line, column: loc.column, message });
    return new ParseError(fullMsg);
  }

  /**
   * **Panic Mode Synchronisation.**
   *
   * Called when a `ParseError` is caught.  Skips tokens until a
   * synchronisation point is found:
   *   * `;`  - end of a statement
   *   * `}`  - end of a block
   *   * EOF  - end of file
   *
   * After synchronisation, the parser resumes at the next statement,
   * allowing it to report additional errors downstream.
   */
  private synchronize(): void {
    while (!this.isAtEnd()) {
      const tok = this.peek();

      // Semicolons: consume them so the next `parseStatement` starts fresh
      if (tok.type === TokenType.DLM_SEMICOLON) {
        this.advance();
        return;
      }

      // Closing brace: DO NOT consume - the enclosing `parseBlock`
      // or `parseIfStatement` needs to see it.
      if (tok.type === TokenType.DLM_RBRACE) {
        return;
      }

      // Statement-starting keywords indicate a valid recovery point.
      // Don't consume them - let the next `parseStatement` handle it.
      if (
        tok.type === TokenType.K_LET    ||
        tok.type === TokenType.K_IF     ||
        tok.type === TokenType.K_REMOTE ||
        tok.type === TokenType.K_ELSE
      ) {
        return;
      }

      this.advance(); // skip non-synchronisation token
    }
  }

  // ========================================================================
  //  Token-stream Helpers
  // ========================================================================

  /** Returns the current token without consuming it. */
  private peek(): Token {
    return this.tokens[this.pos];
  }

  /** Returns the next token (lookahead 1) without consuming. */
  private peekNext(): Token {
    if (this.pos + 1 >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[this.pos + 1];
  }

  /** Consumes and returns the current token. */
  private advance(): Token {
    const tok = this.tokens[this.pos];
    if (!this.isAtEnd()) this.pos++;
    return tok;
  }

  /** True if the current token has the given type. */
  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /** True if the current token matches any of the given types. */
  private checkAny(types: TokenType[]): boolean {
    const current = this.peek().type;
    return types.includes(current);
  }

  /** True if we've reached the EOF token. */
  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  /**
   * Consumes the current token if it matches `type`.
   * Otherwise, throws a `ParseError` (entering Panic Mode).
   */
  private expect(type: TokenType, what: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), `Expected ${what}, got '${this.peek().lexeme}' (${this.peek().type})`);
  }

  /** Extracts a `SourceRange` from the current token. */
  private currentRange(): SourceRange {
    const loc = this.peek().loc;
    return { line: loc.line, column: loc.column };
  }
}
