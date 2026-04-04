// ============================================================================
// Aether-Lang - AST Node Definitions
// ============================================================================
// Discriminated union types for every EBNF production.
// Every node carries:
//   * `type`  - discriminant tag for type-safe pattern matching
//   * `range` - source location for diagnostics and listing.txt
//   * Stage-3 metadata stubs (`_offset`, `_byteSize`, `_scope`) that the
//     Semantic Analyzer will populate before JSON serialization to the
//     C++ Backend.
//
// IMPORTANT: All nodes are pure data - no methods, no prototypes.
// This guarantees JSON.stringify round-trips cleanly over the Bridge.
// ============================================================================

import type { SourceLocation } from "./tokens";

// -- Source Range ------------------------------------------------------------
/** Start position of a node in source.  End tracking is optional; the
 *  Diagnostics Module only needs the start. */
export interface SourceRange {
  line:   number;
  column: number;
}

// -- Stage-3 Metadata Stubs --------------------------------------------------
/**
 * Memory layout metadata computed by the Semantic Analyzer (Stage 3).
 * Attached to declaration nodes before the JSON Bridge serialises them.
 * The C++ Backend reads these directly - no symbol-table rebuild needed.
 */
export interface MemoryMeta {
  /** Stack offset in bytes from the current frame's base pointer. */
  _offset:   number | null;
  /** Total byte size of this variable (4 for int/f32, product(dims)*sizeof for tensors). */
  _byteSize: number | null;
  /** Lexical scope depth (0 = global). */
  _scope:    number | null;
}

// -- Helpers -----------------------------------------------------------------

function defaultMeta(): MemoryMeta {
  return { _offset: null, _byteSize: null, _scope: null };
}

// ============================================================================
//  AST Node Types - Discriminated Union
// ============================================================================

// -- Program (root) ----------------------------------------------------------
export interface ProgramNode {
  type:       "Program";
  body:       StatementNode[];
  range:      SourceRange;
}

// -- Statements --------------------------------------------------------------

export interface VarDeclNode {
  type:       "VarDecl";
  name:       string;
  varType:    TypeNode;
  init:       ExpressionNode | null;     // null when declaration has no `= expr`
  range:      SourceRange;
  meta:       MemoryMeta;
}

export interface AssignmentNode {
  type:       "Assignment";
  name:       string;
  value:      ExpressionNode;
  range:      SourceRange;
}

export interface AiCallNode {
  type:       "AiCall";
  target:     string;                    // identifier left of `:=`
  source:     string;                    // identifier first arg to `infer()`
  modelRef:   string;                    // string literal (model path)
  range:      SourceRange;
}

export interface CloudBlockNode {
  type:       "CloudBlock";
  ipAddress:  string;                    // string literal (IP / URL)
  body:       StatementNode[];
  range:      SourceRange;
}

export interface IfStatementNode {
  type:       "IfStatement";
  condition:  ExpressionNode;
  consequent: StatementNode[];
  alternate:  StatementNode[] | null;    // null when no `else` block
  range:      SourceRange;
}

/** Placeholder produced by Panic Mode recovery so the AST stays well-formed. */
export interface ErrorStatementNode {
  type:       "ErrorStatement";
  message:    string;
  range:      SourceRange;
}

export type StatementNode =
  | VarDeclNode
  | AssignmentNode
  | AiCallNode
  | CloudBlockNode
  | IfStatementNode
  | ErrorStatementNode;

// -- Types -------------------------------------------------------------------

export interface SimpleTypeNode {
  type:       "SimpleType";
  name:       "int" | "float";
  range:      SourceRange;
}

export interface TensorTypeNode {
  type:       "TensorType";
  baseType:   "f32" | "i32";
  dimensions: number[];                  // e.g. [784, 256]
  range:      SourceRange;
}

export type TypeNode = SimpleTypeNode | TensorTypeNode;

// -- Expressions -------------------------------------------------------------

export interface BinaryExprNode {
  type:       "BinaryExpr";
  operator:   "+" | "-" | "*" | "/";
  left:       ExpressionNode;
  right:      ExpressionNode;
  range:      SourceRange;
}

export interface ComparisonExprNode {
  type:       "ComparisonExpr";
  operator:   "==" | "!=" | "<" | ">" | "<=" | ">=";
  left:       ExpressionNode;
  right:      ExpressionNode;
  range:      SourceRange;
}

export interface IdentifierNode {
  type:       "Identifier";
  name:       string;
  range:      SourceRange;
}

export interface IntLiteralNode {
  type:       "IntLiteral";
  value:      number;
  range:      SourceRange;
}

export interface FloatLiteralNode {
  type:       "FloatLiteral";
  value:      number;
  range:      SourceRange;
}

export interface ParenExprNode {
  type:       "ParenExpr";
  expr:       ExpressionNode;
  range:      SourceRange;
}

export type ExpressionNode =
  | BinaryExprNode
  | ComparisonExprNode
  | IdentifierNode
  | IntLiteralNode
  | FloatLiteralNode
  | ParenExprNode;

// -- All Nodes ---------------------------------------------------------------
export type ASTNode =
  | ProgramNode
  | StatementNode
  | TypeNode
  | ExpressionNode;

// -- Factory Functions -------------------------------------------------------
// Pure-data constructors.  No class instances -> guaranteed JSON-safe.

export function makeProgramNode(body: StatementNode[], range: SourceRange): ProgramNode {
  return { type: "Program", body, range };
}

export function makeVarDecl(name: string, varType: TypeNode, init: ExpressionNode | null, range: SourceRange): VarDeclNode {
  return { type: "VarDecl", name, varType, init, range, meta: defaultMeta() };
}

export function makeAssignment(name: string, value: ExpressionNode, range: SourceRange): AssignmentNode {
  return { type: "Assignment", name, value, range };
}

export function makeAiCall(target: string, source: string, modelRef: string, range: SourceRange): AiCallNode {
  return { type: "AiCall", target, source, modelRef, range };
}

export function makeCloudBlock(ipAddress: string, body: StatementNode[], range: SourceRange): CloudBlockNode {
  return { type: "CloudBlock", ipAddress, body, range };
}

export function makeIfStatement(condition: ExpressionNode, consequent: StatementNode[], alternate: StatementNode[] | null, range: SourceRange): IfStatementNode {
  return { type: "IfStatement", condition, consequent, alternate, range };
}

export function makeErrorStatement(message: string, range: SourceRange): ErrorStatementNode {
  return { type: "ErrorStatement", message, range };
}

export function makeSimpleType(name: "int" | "float", range: SourceRange): SimpleTypeNode {
  return { type: "SimpleType", name, range };
}

export function makeTensorType(baseType: "f32" | "i32", dimensions: number[], range: SourceRange): TensorTypeNode {
  return { type: "TensorType", baseType, dimensions, range };
}

export function makeBinaryExpr(operator: BinaryExprNode["operator"], left: ExpressionNode, right: ExpressionNode, range: SourceRange): BinaryExprNode {
  return { type: "BinaryExpr", operator, left, right, range };
}

export function makeComparisonExpr(operator: ComparisonExprNode["operator"], left: ExpressionNode, right: ExpressionNode, range: SourceRange): ComparisonExprNode {
  return { type: "ComparisonExpr", operator, left, right, range };
}

export function makeIdentifier(name: string, range: SourceRange): IdentifierNode {
  return { type: "Identifier", name, range };
}

export function makeIntLiteral(value: number, range: SourceRange): IntLiteralNode {
  return { type: "IntLiteral", value, range };
}

export function makeFloatLiteral(value: number, range: SourceRange): FloatLiteralNode {
  return { type: "FloatLiteral", value, range };
}

export function makeParenExpr(expr: ExpressionNode, range: SourceRange): ParenExprNode {
  return { type: "ParenExpr", expr, range };
}
