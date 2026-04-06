// ============================================================================
// Aether-Lang — TypeScript Pipeline Entry
// ============================================================================

export { compile, type CompilationResult } from "./compile";
export { IRGenerator } from "./irgen";
export { Optimizer, type OptStats } from "./optimizer";
export { X86Emitter } from "./emitter";
export { formatTAC, type Instruction, OpCode } from "./ir_instruction";
export type { ProgramNode, StatementNode, ExpressionNode } from "./ast";
export type { DiagnosticBag, Diagnostic } from "./diagnostics";
