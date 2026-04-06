// ============================================================================
// Aether-Lang — IR Generator (AST → Three-Address Code)
// ============================================================================

import type { ProgramNode, StatementNode, ExpressionNode, VarDeclNode, AssignmentNode, AiCallNode, CloudBlockNode, IfStatementNode, BinaryExprNode, ComparisonExprNode } from "./ast";
import { OpCode, Instruction, InstructionFactory as I } from "./ir_instruction";

export class IRGenerator {
    private instrs: Instruction[] = [];
    private tempCounter: number = 0;
    private labelCounter: number = 0;

    private varOffsets: Map<string, number> = new Map();
    private varSizes: Map<string, number> = new Map();
    private varIsTensor: Map<string, boolean> = new Map();

    public generate(prog: ProgramNode, totalFrameSize: number): Instruction[] {
        this.instrs = [];
        this.tempCounter = 0;
        this.labelCounter = 0;
        this.varOffsets.clear();
        this.varSizes.clear();
        this.varIsTensor.clear();

        this.emit(I.comment("=== Aether-Lang TAC ==="));
        this.emit(I.allocStack(totalFrameSize));

        for (const stmt of prog.body) {
            this.lowerStatement(stmt);
        }

        this.emit(I.comment("=== end ==="));
        return this.instrs;
    }

    private emit(instr: Instruction) {
        this.instrs.push(instr);
    }

    private newTemp(): string {
        return `t${this.tempCounter++}`;
    }

    private newLabel(): string {
        return `L${this.labelCounter++}`;
    }

    private resolveOffset(name: string): number {
        return this.varOffsets.get(name) ?? -1;
    }

    private resolveSize(name: string): number {
        return this.varSizes.get(name) ?? 4;
    }

    private isTensor(name: string): boolean {
        return this.varIsTensor.get(name) ?? false;
    }

    private lowerStatement(stmt: StatementNode | null) {
        if (!stmt) return;

        switch (stmt.type) {
            case "VarDecl": return this.lowerVarDecl(stmt);
            case "Assignment": return this.lowerAssignment(stmt);
            case "AiCall": return this.lowerAiCall(stmt);
            case "CloudBlock": return this.lowerCloudBlock(stmt);
            case "IfStatement": return this.lowerIfStatement(stmt);
        }
    }

    private lowerVarDecl(decl: VarDeclNode) {
        const offset = decl.meta._offset ?? -1;
        const byteSize = decl.meta._byteSize ?? 4;
        const line = decl.range.line;

        this.varOffsets.set(decl.name, offset);
        this.varSizes.set(decl.name, byteSize);

        const tensor = decl.varType.type === "TensorType";
        this.varIsTensor.set(decl.name, tensor);

        this.emit(I.comment(`let ${decl.name} (offset=${offset}, size=${byteSize}B)`));

        if (tensor) {
            this.emit(I.allocTensor(offset, byteSize, line));
        }

        if (decl.init) {
            const src = this.lowerExpression(decl.init, line);
            this.emit(I.storeMem(offset, src, line));
        }
    }

    private lowerAssignment(asgn: AssignmentNode) {
        const offset = this.resolveOffset(asgn.name);
        const line = asgn.range.line;

        this.emit(I.comment(`${asgn.name} = ...`));

        if (this.isTensor(asgn.name) && asgn.value.type === "BinaryExpr") {
            this.lowerTensorBinaryAssignment(asgn, offset, line);
            return;
        }

        const src = this.lowerExpression(asgn.value, line);
        this.emit(I.storeMem(offset, src, line));
    }

    private lowerTensorBinaryAssignment(asgn: AssignmentNode, destOffset: number, line: number) {
        const binExpr = asgn.value as BinaryExprNode;
        let leftOff = -1;
        let rightOff = -1;

        if (binExpr.left.type === "Identifier") {
            leftOff = this.resolveOffset(binExpr.left.name);
        }
        if (binExpr.right.type === "Identifier") {
            rightOff = this.resolveOffset(binExpr.right.name);
        }

        const bytes = this.resolveSize(asgn.name);
        let tensorOp = OpCode.TENSOR_ADD;
        if (binExpr.operator === "+") tensorOp = OpCode.TENSOR_ADD;
        else if (binExpr.operator === "-") tensorOp = OpCode.TENSOR_SUB;
        else if (binExpr.operator === "*") tensorOp = OpCode.TENSOR_MUL;
        else if (binExpr.operator === "/") tensorOp = OpCode.TENSOR_DIV;

        this.emit(I.tensorOp(tensorOp, destOffset, leftOff >= 0 ? leftOff : 0, rightOff >= 0 ? rightOff : 0, bytes, line));
    }

    private lowerAiCall(call: AiCallNode) {
        const line = call.range.line;
        this.emit(I.comment(`${call.target} := infer(${call.source}, "${call.modelRef}")`));

        const srcOffset = this.resolveOffset(call.source);
        const srcReg = `[RBP-${srcOffset}]`;
        const destReg = this.newTemp();

        this.emit(I.callInfer(destReg, srcReg, call.modelRef, line));

        const targetOffset = this.resolveOffset(call.target);
        if (targetOffset >= 0) {
            this.emit(I.storeMem(targetOffset, destReg, line));
        } else {
            this.varOffsets.set(call.target, -1);
        }
    }

    private lowerCloudBlock(block: CloudBlockNode) {
        const line = block.range.line;
        this.emit(I.comment(`remote("${block.ipAddress}") {`));
        this.emit(I.callRemote(block.ipAddress, line));

        for (const s of block.body) {
            this.lowerStatement(s);
        }

        this.emit(I.endRemote(line));
        this.emit(I.comment(`} // end remote`));
    }

    private lowerIfStatement(ifStmt: IfStatementNode) {
        const line = ifStmt.range.line;
        const condReg = this.lowerExpression(ifStmt.condition, line);
        const elseLabel = this.newLabel();
        const endLabel = this.newLabel();
        const hasElse = ifStmt.alternate !== null && ifStmt.alternate.length > 0;

        this.emit(I.comment("if (...) {"));
        this.emit(I.jmpIfFalse(condReg, hasElse ? elseLabel : endLabel, line));

        for (const s of ifStmt.consequent) {
            this.lowerStatement(s);
        }

        if (hasElse) {
            this.emit(I.jmp(endLabel, line));
            this.emit(I.label(elseLabel, line));
            this.emit(I.comment("} else {"));
            for (const s of ifStmt.alternate!) {
                this.lowerStatement(s);
            }
        }

        this.emit(I.label(endLabel, line));
        this.emit(I.comment("} // end if"));
    }

    private lowerExpression(expr: ExpressionNode | null, line: number): string {
        if (!expr) return "???";

        switch (expr.type) {
            case "IntLiteral": {
                const dest = this.newTemp();
                this.emit(I.loadConst(dest, expr.value, line));
                return dest;
            }
            case "FloatLiteral": {
                const dest = this.newTemp();
                this.emit(I.loadConstFloat(dest, expr.value, line));
                return dest;
            }
            case "Identifier": {
                const dest = this.newTemp();
                const offset = this.resolveOffset(expr.name);
                if (offset >= 0) {
                    this.emit(I.loadMem(dest, offset, line));
                } else {
                    this.emit(I.loadConst(dest, 0, line));
                }
                return dest;
            }
            case "ParenExpr":
                return this.lowerExpression(expr.expr, line);
            case "BinaryExpr":
                return this.lowerBinaryExpr(expr, line);
            case "ComparisonExpr":
                return this.lowerComparisonExpr(expr, line);
        }
        return "???";
    }

    private lowerBinaryExpr(bin: BinaryExprNode, line: number): string {
        const left = this.lowerExpression(bin.left, line);
        const right = this.lowerExpression(bin.right, line);
        const dest = this.newTemp();

        let op = OpCode.ADD;
        if (bin.operator === "+") op = OpCode.ADD;
        else if (bin.operator === "-") op = OpCode.SUB;
        else if (bin.operator === "*") op = OpCode.MUL;
        else if (bin.operator === "/") op = OpCode.DIV;

        this.emit(I.arith(op, dest, left, right, line));
        return dest;
    }

    private lowerComparisonExpr(cmp: ComparisonExprNode, line: number): string {
        const left = this.lowerExpression(cmp.left, line);
        const right = this.lowerExpression(cmp.right, line);
        const dest = this.newTemp();

        let op = OpCode.CMP_EQ;
        if (cmp.operator === "==") op = OpCode.CMP_EQ;
        else if (cmp.operator === "!=") op = OpCode.CMP_NEQ;
        else if (cmp.operator === "<") op = OpCode.CMP_LT;
        else if (cmp.operator === ">") op = OpCode.CMP_GT;
        else if (cmp.operator === "<=") op = OpCode.CMP_LTE;
        else if (cmp.operator === ">=") op = OpCode.CMP_GTE;

        this.emit(I.cmp(op, dest, left, right, line));
        return dest;
    }
}
