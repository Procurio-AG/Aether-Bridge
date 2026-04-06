// ============================================================================
// Aether-Lang — IR Generator (AST → Three-Address Code)
// ============================================================================
// Walks the C++ AST and emits a flat std::vector<Instruction>.
// Memory layout is derived from the _offset metadata provided by the
// TypeScript Semantic Analyzer — no symbol table needed.
// ============================================================================

#pragma once

#include "ast_node.h"
#include "ir_instruction.h"

#include <string>
#include <vector>
#include <unordered_map>
#include <stdexcept>

namespace aether {

class IRGenerator {
public:
    /// Generate TAC from the fully-annotated AST.
    std::vector<Instruction> generate(const Program& prog) {
        instrs_.clear();
        tempCounter_ = 0;
        labelCounter_ = 0;
        varOffsets_.clear();

        // Stack frame allocation
        emit(Instruction::comment("=== Aether-Lang TAC ==="));
        emit(Instruction::allocStack(prog.totalFrameSize));

        // Lower all top-level statements
        for (const auto& stmt : prog.body) {
            lowerStatement(stmt);
        }

        emit(Instruction::comment("=== end ==="));
        return instrs_;
    }

private:
    std::vector<Instruction> instrs_;
    int tempCounter_  = 0;
    int labelCounter_ = 0;

    /// Maps variable names → stack offsets (populated during VarDecl lowering)
    std::unordered_map<std::string, int> varOffsets_;
    /// Maps variable names → byte sizes (for tensor operations)
    std::unordered_map<std::string, int> varSizes_;
    /// Maps variable names → whether they are tensors
    std::unordered_map<std::string, bool> varIsTensor_;

    // ── Helpers ─────────────────────────────────────────────────────────

    void emit(Instruction instr) {
        instrs_.push_back(std::move(instr));
    }

    std::string newTemp() {
        return "t" + std::to_string(tempCounter_++);
    }

    std::string newLabel() {
        return "L" + std::to_string(labelCounter_++);
    }

    int resolveOffset(const std::string& name) {
        auto it = varOffsets_.find(name);
        if (it != varOffsets_.end()) return it->second;
        return -1; // unknown — should not happen with a valid AST
    }

    int resolveSize(const std::string& name) {
        auto it = varSizes_.find(name);
        if (it != varSizes_.end()) return it->second;
        return 4; // default scalar
    }

    bool isTensor(const std::string& name) {
        auto it = varIsTensor_.find(name);
        return it != varIsTensor_.end() && it->second;
    }

    // ── Statement Lowering ──────────────────────────────────────────────

    void lowerStatement(const StmtPtr& stmt) {
        if (!stmt) return;

        if (stmt->type == "VarDecl")       lowerVarDecl(stmt->varDecl, stmt);
        else if (stmt->type == "Assignment")  lowerAssignment(stmt->assignment, stmt);
        else if (stmt->type == "AiCall")      lowerAiCall(stmt->aiCall, stmt);
        else if (stmt->type == "CloudBlock")  lowerCloudBlock(stmt->cloudBlock, stmt);
        else if (stmt->type == "IfStatement") lowerIfStatement(stmt->ifStmt, stmt);
    }

    void lowerVarDecl(const VarDecl& decl, const StmtPtr& /*stmt*/) {
        int offset   = decl.meta.offset;
        int byteSize = decl.meta.byteSize;
        int line     = decl.range.line;

        // Register in offset map
        varOffsets_[decl.name] = offset;
        varSizes_[decl.name]   = byteSize;

        // Detect tensor type
        bool tensor = std::holds_alternative<TensorType>(decl.varType);
        varIsTensor_[decl.name] = tensor;

        emit(Instruction::comment("let " + decl.name + " (offset=" +
             std::to_string(offset) + ", size=" + std::to_string(byteSize) + "B)"));

        if (tensor) {
            // Tensor: emit ALLOC_TENSOR
            emit(Instruction::allocTensor(offset, byteSize, line));
        }

        // Initialiser
        if (decl.init) {
            std::string src = lowerExpression(decl.init, line);
            emit(Instruction::storeMem(offset, src, line));
        }
    }

    void lowerAssignment(const Assignment& asgn, const StmtPtr& /*stmt*/) {
        int offset = resolveOffset(asgn.name);
        int line   = asgn.range.line;

        emit(Instruction::comment(asgn.name + " = ..."));

        // Check if this is a tensor operation
        if (isTensor(asgn.name) && asgn.value->type == "BinaryExpr") {
            lowerTensorBinaryAssignment(asgn, offset, line);
            return;
        }

        std::string src = lowerExpression(asgn.value, line);
        emit(Instruction::storeMem(offset, src, line));
    }

    void lowerTensorBinaryAssignment(const Assignment& asgn, int destOffset, int line) {
        const auto& binExpr = asgn.value->binExpr;

        // Resolve left and right tensor offsets
        int leftOff  = -1;
        int rightOff = -1;

        if (binExpr.left && binExpr.left->type == "Identifier") {
            leftOff = resolveOffset(binExpr.left->ident.name);
        }
        if (binExpr.right && binExpr.right->type == "Identifier") {
            rightOff = resolveOffset(binExpr.right->ident.name);
        }

        int bytes = resolveSize(asgn.name);

        OpCode tensorOp;
        if (binExpr.op == "+")      tensorOp = OpCode::TENSOR_ADD;
        else if (binExpr.op == "-") tensorOp = OpCode::TENSOR_SUB;
        else if (binExpr.op == "*") tensorOp = OpCode::TENSOR_MUL;
        else                        tensorOp = OpCode::TENSOR_DIV;

        emit(Instruction::tensorOp(tensorOp, destOffset,
             leftOff >= 0 ? leftOff : 0,
             rightOff >= 0 ? rightOff : 0,
             bytes, line));
    }

    void lowerAiCall(const AiCall& call, const StmtPtr& /*stmt*/) {
        int line = call.range.line;

        emit(Instruction::comment(call.target + " := infer(" + call.source + ", \"" + call.modelRef + "\")"));

        // Resolve source tensor offset
        int srcOffset = resolveOffset(call.source);
        std::string srcReg = "[RBP-" + std::to_string(srcOffset) + "]";

        // Register the target variable (created by := operator)
        // The frontend analyzer already assigned an offset for implicit declarations
        // We'll use a fresh temp for the result
        std::string destReg = newTemp();

        emit(Instruction::callInfer(destReg, srcReg, call.modelRef, line));

        // Store result — if target is already in varOffsets, use its offset
        int targetOffset = resolveOffset(call.target);
        if (targetOffset >= 0) {
            emit(Instruction::storeMem(targetOffset, destReg, line));
        } else {
            // The frontend should have allocated this, but fallback
            varOffsets_[call.target] = -1;
        }
    }

    void lowerCloudBlock(const CloudBlock& block, const StmtPtr& /*stmt*/) {
        int line = block.range.line;

        emit(Instruction::comment("remote(\"" + block.ipAddress + "\") {"));
        emit(Instruction::callRemote(block.ipAddress, line));

        for (const auto& s : block.body) {
            lowerStatement(s);
        }

        emit(Instruction::endRemote(line));
        emit(Instruction::comment("} // end remote"));
    }

    void lowerIfStatement(const IfStatement& ifStmt, const StmtPtr& /*stmt*/) {
        int line = ifStmt.range.line;

        std::string condReg   = lowerExpression(ifStmt.condition, line);
        std::string elseLabel = newLabel();
        std::string endLabel  = newLabel();

        bool hasElse = !ifStmt.alternate.empty();

        emit(Instruction::comment("if (...) {"));
        emit(Instruction::jmpIfFalse(condReg, hasElse ? elseLabel : endLabel, line));

        // Consequent block
        for (const auto& s : ifStmt.consequent) {
            lowerStatement(s);
        }

        if (hasElse) {
            emit(Instruction::jmp(endLabel, line));

            // Else block
            emit(Instruction::label(elseLabel, line));
            emit(Instruction::comment("} else {"));
            for (const auto& s : ifStmt.alternate) {
                lowerStatement(s);
            }
        }

        emit(Instruction::label(endLabel, line));
        emit(Instruction::comment("} // end if"));
    }

    // ── Expression Lowering ─────────────────────────────────────────────

    /// Returns the name of the temp register holding the expression result.
    std::string lowerExpression(const ExprPtr& expr, int line) {
        if (!expr) return "???";

        if (expr->type == "IntLiteral") {
            std::string dest = newTemp();
            emit(Instruction::loadConst(dest, expr->intLit.value, line));
            return dest;
        }

        if (expr->type == "FloatLiteral") {
            std::string dest = newTemp();
            emit(Instruction::loadConstFloat(dest, expr->floatLit.value, line));
            return dest;
        }

        if (expr->type == "Identifier") {
            std::string dest = newTemp();
            int offset = resolveOffset(expr->ident.name);
            if (offset >= 0) {
                emit(Instruction::loadMem(dest, offset, line));
            } else {
                // Fallback: unknown variable (shouldn't happen with valid AST)
                emit(Instruction::loadConst(dest, 0, line));
            }
            return dest;
        }

        if (expr->type == "ParenExpr") {
            return lowerExpression(expr->parenExpr.expr, line);
        }

        if (expr->type == "BinaryExpr") {
            return lowerBinaryExpr(expr->binExpr, line);
        }

        if (expr->type == "ComparisonExpr") {
            return lowerComparisonExpr(expr->cmpExpr, line);
        }

        return "???";
    }

    std::string lowerBinaryExpr(const BinaryExpr& bin, int line) {
        std::string left  = lowerExpression(bin.left, line);
        std::string right = lowerExpression(bin.right, line);
        std::string dest  = newTemp();

        OpCode op;
        if (bin.op == "+")      op = OpCode::ADD;
        else if (bin.op == "-") op = OpCode::SUB;
        else if (bin.op == "*") op = OpCode::MUL;
        else                    op = OpCode::DIV;

        emit(Instruction::arith(op, dest, left, right, line));
        return dest;
    }

    std::string lowerComparisonExpr(const ComparisonExpr& cmp, int line) {
        std::string left  = lowerExpression(cmp.left, line);
        std::string right = lowerExpression(cmp.right, line);
        std::string dest  = newTemp();

        OpCode op;
        if (cmp.op == "==")      op = OpCode::CMP_EQ;
        else if (cmp.op == "!=") op = OpCode::CMP_NEQ;
        else if (cmp.op == "<")  op = OpCode::CMP_LT;
        else if (cmp.op == ">")  op = OpCode::CMP_GT;
        else if (cmp.op == "<=") op = OpCode::CMP_LTE;
        else                     op = OpCode::CMP_GTE;

        emit(Instruction::cmp(op, dest, left, right, line));
        return dest;
    }
};

} // namespace aether
