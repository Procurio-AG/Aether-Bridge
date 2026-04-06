// ============================================================================
// Aether-Lang - Semantic Analyzer (Stage 3)
// ============================================================================
// Walks the AST produced by the Parser and performs:
//   1. Scoped Symbol Table management (stack of Maps)
//   2. Memory Planning: computes _byteSize, _offset, _scope for VarDecl
//   3. Type checking for expressions and assignments
//   4. Tensor dimension validation (shape-compatible operations)
//   5. AI-call and remote-block validation
//
// The analyzer mutates the AST in-place, filling `meta` fields on
// VarDeclNode.  It does NOT throw - all errors go to the DiagnosticBag.
// ============================================================================

import type {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  VarDeclNode,
  AssignmentNode,
  AiCallNode,
  CloudBlockNode,
  IfStatementNode,
  TypeNode,
  BinaryExprNode,
  ComparisonExprNode,
  IdentifierNode,
  SourceRange,
} from "./ast";
import { DiagnosticBag } from "./diagnostics";

// -- Resolved Type -----------------------------------------------------------
/**
 * Type information stored in the symbol table.  This is the analyzer's
 * internal representation - NOT the AST's TypeNode.
 */
export type ResolvedType =
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "tensor"; baseType: "f32" | "i32"; dimensions: number[] }
  | { kind: "unknown" };

// -- Symbol Entry ------------------------------------------------------------
export interface SymbolEntry {
  name:       string;
  resolvedType: ResolvedType;
  byteSize:   number;
  offset:     number;
  scope:      number;
  line:       number;
}

// -- Size Constants ----------------------------------------------------------
const SIZEOF_INT   = 4;
const SIZEOF_FLOAT = 4;
const SIZEOF_F32   = 4;
const SIZEOF_I32   = 4;

// ============================================================================
//  Semantic Analyzer
// ============================================================================

export class SemanticAnalyzer {
  /** Diagnostic collector (shared with Lexer + Parser diagnostics). */
  public readonly bag: DiagnosticBag;

  /** Stack of scope maps.  Index 0 = global scope. */
  private scopes: Map<string, SymbolEntry>[] = [];

  /** Current scope depth (0 = global). */
  private scopeDepth: number = 0;

  /** Running stack frame offset (bytes from base pointer). */
  private currentOffset: number = 0;

  /** Total stack frame size (maximum offset reached). */
  public totalFrameSize: number = 0;

  constructor(bag: DiagnosticBag) {
    this.bag = bag;
  }

  // ========================================================================
  //  Public API
  // ========================================================================

  /**
   * Analyse the entire program.  Mutates `ast` in-place, filling
   * `VarDeclNode.meta` fields.  Errors are collected in `this.bag`.
   */
  public analyze(ast: ProgramNode): void {
    this.enterScope();
    this.analyzeStatements(ast.body);
    this.exitScope();
    this.totalFrameSize = this.currentOffset;
  }

  // ========================================================================
  //  Scope Management
  // ========================================================================

  private enterScope(): void {
    this.scopes.push(new Map());
    this.scopeDepth = this.scopes.length - 1;
  }

  private exitScope(): void {
    this.scopes.pop();
    this.scopeDepth = Math.max(0, this.scopes.length - 1);
  }

  /** Look up a symbol, walking outward from innermost scope. */
  private lookup(name: string): SymbolEntry | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const entry = this.scopes[i].get(name);
      if (entry) return entry;
    }
    return undefined;
  }

  /** Look up only in the current (innermost) scope (for redeclaration check). */
  private lookupLocal(name: string): SymbolEntry | undefined {
    if (this.scopes.length === 0) return undefined;
    return this.scopes[this.scopes.length - 1].get(name);
  }

  /** Define a symbol in the current scope. */
  private define(entry: SymbolEntry): void {
    if (this.scopes.length === 0) return;
    this.scopes[this.scopes.length - 1].set(entry.name, entry);
  }

  // ========================================================================
  //  Statement Analysis
  // ========================================================================

  private analyzeStatements(stmts: StatementNode[]): void {
    for (const stmt of stmts) {
      this.analyzeStatement(stmt);
    }
  }

  private analyzeStatement(stmt: StatementNode): void {
    switch (stmt.type) {
      case "VarDecl":        this.analyzeVarDecl(stmt);        break;
      case "Assignment":     this.analyzeAssignment(stmt);     break;
      case "AiCall":         this.analyzeAiCall(stmt);         break;
      case "CloudBlock":     this.analyzeCloudBlock(stmt);     break;
      case "IfStatement":    this.analyzeIfStatement(stmt);    break;
      case "ErrorStatement": /* skip - already reported by parser */ break;
    }
  }

  // -- VarDecl -------------------------------------------------------------
  private analyzeVarDecl(node: VarDeclNode): void {
    // Check redeclaration in the SAME scope
    const existing = this.lookupLocal(node.name);
    if (existing) {
      this.bag.addError(node.range.line, node.range.column,
        `Variable '${node.name}' is already declared in this scope (previously at line ${existing.line})`);
    }

    // Compute byte size
    const resolvedType = this.resolveTypeNode(node.varType);
    const byteSize     = this.computeByteSize(resolvedType);

    // Allocate stack space
    const offset = this.currentOffset;
    this.currentOffset += byteSize;

    // Fill AST metadata
    node.meta._offset   = offset;
    node.meta._byteSize = byteSize;
    node.meta._scope    = this.scopeDepth;

    // Register in symbol table
    const entry: SymbolEntry = {
      name:         node.name,
      resolvedType,
      byteSize,
      offset,
      scope:        this.scopeDepth,
      line:         node.range.line,
    };
    this.define(entry);

    // Type-check the initializer (if present)
    if (node.init) {
      const initType = this.resolveExprType(node.init);
      this.checkAssignmentCompat(resolvedType, initType, node.range,
        `Cannot initialise '${node.name}' of type '${this.typeToString(resolvedType)}' with '${this.typeToString(initType)}'`);
    }
  }

  // -- Assignment ----------------------------------------------------------
  private analyzeAssignment(node: AssignmentNode): void {
    const sym = this.lookup(node.name);
    if (!sym) {
      this.bag.addError(node.range.line, node.range.column,
        `Undeclared variable '${node.name}'`);
      return;
    }

    const valueType = this.resolveExprType(node.value);
    this.checkAssignmentCompat(sym.resolvedType, valueType, node.range,
      `Cannot assign '${this.typeToString(valueType)}' to '${node.name}' of type '${this.typeToString(sym.resolvedType)}'`);
  }

  // -- AI Call -------------------------------------------------------------
  private analyzeAiCall(node: AiCallNode): void {
    // The source identifier must be declared
    const src = this.lookup(node.source);
    if (!src) {
      this.bag.addError(node.range.line, node.range.column,
        `Undeclared variable '${node.source}' in infer() call`);
    } else if (src.resolvedType.kind !== "tensor") {
      this.bag.addError(node.range.line, node.range.column,
        `The source '${node.source}' in infer() must be a tensor, got '${this.typeToString(src.resolvedType)}'`);
    }

    // The target is being declared implicitly by `:=` - treat as new
    // variable of type `tensor<f32, [unspecified]>`.  We model it as
    // an "unknown" tensor since the output shape depends on the model.
    // For now, register it as a generic int (result handle).
    const existing = this.lookupLocal(node.target);
    if (existing) {
      this.bag.addWarning(node.range.line, node.range.column,
        `Variable '${node.target}' is being re-bound via ':=' (was declared at line ${existing.line})`);
    }

    // Register target as a new integer handle (inference result handle)
    const offset = this.currentOffset;
    this.currentOffset += SIZEOF_INT;
    this.define({
      name:         node.target,
      resolvedType: { kind: "int" },
      byteSize:     SIZEOF_INT,
      offset,
      scope:        this.scopeDepth,
      line:         node.range.line,
    });
  }

  // -- Cloud Block ---------------------------------------------------------
  private analyzeCloudBlock(node: CloudBlockNode): void {
    this.enterScope();
    this.analyzeStatements(node.body);
    this.exitScope();
  }

  // -- If Statement --------------------------------------------------------
  private analyzeIfStatement(node: IfStatementNode): void {
    // Analyse condition
    this.resolveExprType(node.condition);

    // Consequent block
    this.enterScope();
    this.analyzeStatements(node.consequent);
    this.exitScope();

    // Alternate block (if present)
    if (node.alternate) {
      this.enterScope();
      this.analyzeStatements(node.alternate);
      this.exitScope();
    }
  }

  // ========================================================================
  //  Type Resolution
  // ========================================================================

  /** Convert an AST TypeNode to our internal ResolvedType. */
  private resolveTypeNode(typeNode: TypeNode): ResolvedType {
    switch (typeNode.type) {
      case "SimpleType":
        return typeNode.name === "int" ? { kind: "int" } : { kind: "float" };
      case "TensorType":
        return {
          kind:       "tensor",
          baseType:   typeNode.baseType,
          dimensions: [...typeNode.dimensions],
        };
    }
  }

  /**
   * Infer the type of an expression node.
   * Returns `{ kind: "unknown" }` when the type cannot be determined
   * (e.g. undeclared variable) - the error is already reported.
   */
  private resolveExprType(expr: ExpressionNode): ResolvedType {
    switch (expr.type) {
      case "IntLiteral":
        return { kind: "int" };

      case "FloatLiteral":
        return { kind: "float" };

      case "Identifier":
        return this.resolveIdentifierType(expr);

      case "ParenExpr":
        return this.resolveExprType(expr.expr);

      case "BinaryExpr":
        return this.resolveBinaryExprType(expr);

      case "ComparisonExpr":
        return this.resolveComparisonExprType(expr);
    }
  }

  private resolveIdentifierType(node: IdentifierNode): ResolvedType {
    const sym = this.lookup(node.name);
    if (!sym) {
      this.bag.addError(node.range.line, node.range.column,
        `Undeclared variable '${node.name}'`);
      return { kind: "unknown" };
    }
    return sym.resolvedType;
  }

  private resolveBinaryExprType(node: BinaryExprNode): ResolvedType {
    const leftType  = this.resolveExprType(node.left);
    const rightType = this.resolveExprType(node.right);

    // Skip checking if either side is unknown (already errored)
    if (leftType.kind === "unknown" || rightType.kind === "unknown") {
      return { kind: "unknown" };
    }

    // -- Tensor rules ----------------------------------------------
    if (leftType.kind === "tensor" || rightType.kind === "tensor") {
      // Both must be tensors for +/-
      if (leftType.kind !== "tensor" || rightType.kind !== "tensor") {
        this.bag.addError(node.range.line, node.range.column,
          `Cannot mix tensor and scalar types in '${node.operator}' operation`);
        return { kind: "unknown" };
      }

      // For +/-, dimensions must match exactly
      if (node.operator === "+" || node.operator === "-") {
        if (!this.dimensionsMatch(leftType.dimensions, rightType.dimensions)) {
          this.bag.addError(node.range.line, node.range.column,
            `Tensor dimension mismatch: [${leftType.dimensions}] ${node.operator} [${rightType.dimensions}]`);
          return { kind: "unknown" };
        }
      }

      // For *: could be element-wise or matmul - accept matching dims for now
      if (node.operator === "*" || node.operator === "/") {
        if (!this.dimensionsMatch(leftType.dimensions, rightType.dimensions)) {
          this.bag.addError(node.range.line, node.range.column,
            `Tensor dimension mismatch for '${node.operator}': [${leftType.dimensions}] vs [${rightType.dimensions}]`);
          return { kind: "unknown" };
        }
      }

      return leftType; // result has same shape
    }

    // -- Scalar rules ----------------------------------------------
    // int op int -> int
    if (leftType.kind === "int" && rightType.kind === "int") {
      return { kind: "int" };
    }
    // float op float -> float
    if (leftType.kind === "float" && rightType.kind === "float") {
      return { kind: "float" };
    }
    // int + float or float + int -> float (implicit widening)
    if ((leftType.kind === "int" && rightType.kind === "float") ||
        (leftType.kind === "float" && rightType.kind === "int")) {
      return { kind: "float" };
    }

    this.bag.addError(node.range.line, node.range.column,
      `Incompatible types in '${node.operator}': '${this.typeToString(leftType)}' and '${this.typeToString(rightType)}'`);
    return { kind: "unknown" };
  }

  private resolveComparisonExprType(node: ComparisonExprNode): ResolvedType {
    const leftType  = this.resolveExprType(node.left);
    const rightType = this.resolveExprType(node.right);

    if (leftType.kind === "unknown" || rightType.kind === "unknown") {
      return { kind: "int" }; // comparisons produce int (boolean result)
    }

    // Tensors cannot be compared
    if (leftType.kind === "tensor" || rightType.kind === "tensor") {
      this.bag.addError(node.range.line, node.range.column,
        `Cannot compare tensor types with '${node.operator}'`);
    }

    // Scalar comparisons are allowed (int/float are compatible)
    return { kind: "int" }; // comparison result is int (0 or 1)
  }

  // ========================================================================
  //  Memory Planning
  // ========================================================================

  private computeByteSize(resolved: ResolvedType): number {
    switch (resolved.kind) {
      case "int":     return SIZEOF_INT;
      case "float":   return SIZEOF_FLOAT;
      case "tensor": {
        const elemSize = resolved.baseType === "f32" ? SIZEOF_F32 : SIZEOF_I32;
        const totalElements = resolved.dimensions.reduce((a, b) => a * b, 1);
        return totalElements * elemSize;
      }
      case "unknown": return 0;
    }
  }

  // ========================================================================
  //  Compatibility Checks
  // ========================================================================

  private checkAssignmentCompat(
    target: ResolvedType,
    value:  ResolvedType,
    range:  SourceRange,
    message: string,
  ): void {
    if (value.kind === "unknown") return; // already reported

    // Same kind
    if (target.kind === value.kind) {
      // For tensors, dimensions must match
      if (target.kind === "tensor" && value.kind === "tensor") {
        if (!this.dimensionsMatch(target.dimensions, value.dimensions)) {
          this.bag.addError(range.line, range.column, message +
            ` (dimension mismatch: [${target.dimensions}] vs [${value.dimensions}])`);
        }
      }
      return; // compatible
    }

    // int <- float or float <- int: allow implicit conversion with warning
    if ((target.kind === "int" && value.kind === "float") ||
        (target.kind === "float" && value.kind === "int")) {
      // Implicit numeric widening/narrowing - allow silently for this DSL
      return;
    }

    // Everything else: error
    this.bag.addError(range.line, range.column, message);
  }

  private dimensionsMatch(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ========================================================================
  //  Utilities
  // ========================================================================

  public typeToString(rt: ResolvedType): string {
    switch (rt.kind) {
      case "int":     return "int";
      case "float":   return "float";
      case "tensor":  return `tensor<${rt.baseType}, [${rt.dimensions.join(", ")}]>`;
      case "unknown": return "<unknown>";
    }
  }
}
