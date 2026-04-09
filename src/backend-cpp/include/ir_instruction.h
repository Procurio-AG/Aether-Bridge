// ============================================================================
// Aether-Lang — Three-Address Code (TAC) Instruction Definition
// ============================================================================
// Each instruction represents a single operation in the IR.
// The IR is a flat std::vector<Instruction> — no nesting, no blocks.
// Control flow is resolved with LABEL, JMP, and JMP_IF_FALSE.
// ============================================================================

#pragma once

#include <string>
#include <vector>
#include <sstream>
#include <iomanip>

namespace aether {

// ── Opcodes ────────────────────────────────────────────────────────────────

enum class OpCode {
    // ── Data movement ──
    LOAD_CONST,       // LOAD_CONST   dest, value          ; load immediate
    LOAD_MEM,         // LOAD_MEM     dest, [RBP - offset] ; load from stack
    STORE_MEM,        // STORE_MEM    [RBP - offset], src  ; store to stack

    // ── Arithmetic ──
    ADD,              // ADD   dest, src1, src2
    SUB,              // SUB   dest, src1, src2
    MUL,              // MUL   dest, src1, src2
    DIV,              // DIV   dest, src1, src2

    // ── Comparison ──
    CMP_EQ,           // CMP_EQ  dest, src1, src2
    CMP_NEQ,          // CMP_NEQ dest, src1, src2
    CMP_LT,           // CMP_LT  dest, src1, src2
    CMP_GT,           // CMP_GT  dest, src1, src2
    CMP_LTE,          // CMP_LTE dest, src1, src2
    CMP_GTE,          // CMP_GTE dest, src1, src2

    // ── Control flow ──
    LABEL,            // LABEL name
    JMP,              // JMP   label
    JMP_IF_FALSE,     // JMP_IF_FALSE condition, label

    // ── Stack frame ──
    ALLOC_STACK,      // ALLOC_STACK totalBytes  ; reserve stack frame
    ALLOC_TENSOR,     // ALLOC_TENSOR offset, byteSize

    // ── AI / Cloud intrinsics ──
    CALL_INFER,       // CALL_INFER dest, src_tensor, model_name
    CALL_REMOTE,      // CALL_REMOTE ip_addr
    END_REMOTE,       // END_REMOTE  ; marks end of remote block

    // ── Tensor operations ──
    TENSOR_ADD,       // TENSOR_ADD dest_off, src1_off, src2_off, byteSize
    TENSOR_SUB,       // TENSOR_SUB dest_off, src1_off, src2_off, byteSize
    TENSOR_MUL,       // TENSOR_MUL dest_off, src1_off, src2_off, byteSize
    TENSOR_DIV,       // TENSOR_DIV dest_off, src1_off, src2_off, byteSize

    // ── Meta ──
    COMMENT,          // ; comment text
    NOP,              // no-op (placeholder for eliminated instructions)
};

// ── Instruction ────────────────────────────────────────────────────────────

struct Instruction {
    OpCode      opcode;
    std::string dest;       // destination register or label
    std::string src1;       // first source operand
    std::string src2;       // second source operand
    std::string extra;      // additional data (model name, IP, comment, etc.)
    int         intVal  = 0;    // integer immediate
    double      floatVal = 0.0; // float immediate
    int         srcLine = 0;    // original source line (for debugging)

    // ── Convenience constructors ──────────────────────────────────────────

    static Instruction loadConst(const std::string& dest, int val, int line = 0) {
        return {OpCode::LOAD_CONST, dest, "", "", "", val, 0.0, line};
    }
    static Instruction loadConstFloat(const std::string& dest, double val, int line = 0) {
        return {OpCode::LOAD_CONST, dest, "", "", "float", 0, val, line};
    }
    static Instruction loadMem(const std::string& dest, int offset, int line = 0) {
        return {OpCode::LOAD_MEM, dest, "[RBP-" + std::to_string(offset) + "]", "", "", offset, 0.0, line};
    }
    static Instruction storeMem(int offset, const std::string& src, int line = 0) {
        return {OpCode::STORE_MEM, "[RBP-" + std::to_string(offset) + "]", src, "", "", offset, 0.0, line};
    }
    static Instruction arith(OpCode op, const std::string& dest, const std::string& s1, const std::string& s2, int line = 0) {
        return {op, dest, s1, s2, "", 0, 0.0, line};
    }
    static Instruction cmp(OpCode op, const std::string& dest, const std::string& s1, const std::string& s2, int line = 0) {
        return {op, dest, s1, s2, "", 0, 0.0, line};
    }
    static Instruction label(const std::string& name, int line = 0) {
        return {OpCode::LABEL, name, "", "", "", 0, 0.0, line};
    }
    static Instruction jmp(const std::string& target, int line = 0) {
        return {OpCode::JMP, target, "", "", "", 0, 0.0, line};
    }
    static Instruction jmpIfFalse(const std::string& cond, const std::string& target, int line = 0) {
        return {OpCode::JMP_IF_FALSE, target, cond, "", "", 0, 0.0, line};
    }
    static Instruction allocStack(int bytes, int line = 0) {
        return {OpCode::ALLOC_STACK, "", "", "", "", bytes, 0.0, line};
    }
    static Instruction allocTensor(int offset, int byteSize, int line = 0) {
        return {OpCode::ALLOC_TENSOR, "[RBP-" + std::to_string(offset) + "]", "", "", "", byteSize, 0.0, line};
    }
    static Instruction callInfer(const std::string& dest, const std::string& src, const std::string& model, int line = 0) {
        return {OpCode::CALL_INFER, dest, src, "", model, 0, 0.0, line};
    }
    static Instruction callRemote(const std::string& ip, int line = 0) {
        return {OpCode::CALL_REMOTE, "", "", "", ip, 0, 0.0, line};
    }
    static Instruction endRemote(int line = 0) {
        return {OpCode::END_REMOTE, "", "", "", "", 0, 0.0, line};
    }
    static Instruction tensorOp(OpCode op, int destOff, int src1Off, int src2Off, int bytes, int line = 0) {
        return {op,
                "[RBP-" + std::to_string(destOff) + "]",
                "[RBP-" + std::to_string(src1Off) + "]",
                "[RBP-" + std::to_string(src2Off) + "]",
                "", bytes, 0.0, line};
    }
    static Instruction comment(const std::string& text, int line = 0) {
        return {OpCode::COMMENT, "", "", "", text, 0, 0.0, line};
    }
    static Instruction nop() {
        return {OpCode::NOP, "", "", "", "", 0, 0.0, 0};
    }

    bool isArithmetic() const {
        return opcode == OpCode::ADD || opcode == OpCode::SUB ||
               opcode == OpCode::MUL || opcode == OpCode::DIV;
    }
};

// ── Opcode → String ────────────────────────────────────────────────────────

inline const char* opcodeToString(OpCode op) {
    switch (op) {
        case OpCode::LOAD_CONST:    return "LOAD_CONST";
        case OpCode::LOAD_MEM:      return "LOAD_MEM";
        case OpCode::STORE_MEM:     return "STORE_MEM";
        case OpCode::ADD:           return "ADD";
        case OpCode::SUB:           return "SUB";
        case OpCode::MUL:           return "MUL";
        case OpCode::DIV:           return "DIV";
        case OpCode::CMP_EQ:       return "CMP_EQ";
        case OpCode::CMP_NEQ:      return "CMP_NEQ";
        case OpCode::CMP_LT:       return "CMP_LT";
        case OpCode::CMP_GT:       return "CMP_GT";
        case OpCode::CMP_LTE:      return "CMP_LTE";
        case OpCode::CMP_GTE:      return "CMP_GTE";
        case OpCode::LABEL:        return "LABEL";
        case OpCode::JMP:          return "JMP";
        case OpCode::JMP_IF_FALSE: return "JMP_IF_FALSE";
        case OpCode::ALLOC_STACK:  return "ALLOC_STACK";
        case OpCode::ALLOC_TENSOR: return "ALLOC_TENSOR";
        case OpCode::CALL_INFER:   return "CALL_INFER";
        case OpCode::CALL_REMOTE:  return "CALL_REMOTE";
        case OpCode::END_REMOTE:   return "END_REMOTE";
        case OpCode::TENSOR_ADD:   return "TENSOR_ADD";
        case OpCode::TENSOR_SUB:   return "TENSOR_SUB";
        case OpCode::TENSOR_MUL:   return "TENSOR_MUL";
        case OpCode::TENSOR_DIV:   return "TENSOR_DIV";
        case OpCode::COMMENT:      return "COMMENT";
        case OpCode::NOP:          return "NOP";
    }
    return "???";
}

// ── Pretty Printer ─────────────────────────────────────────────────────────

inline std::string formatInstruction(const Instruction& instr, int index = -1) {
    std::ostringstream out;

    if (instr.opcode == OpCode::NOP) return "";

    if (instr.opcode == OpCode::COMMENT) {
        out << "    ; " << instr.extra;
        return out.str();
    }

    if (instr.opcode == OpCode::LABEL) {
        out << instr.dest << ":";
        return out.str();
    }

    // Instruction index (optional)
    if (index >= 0) {
        out << std::setw(4) << index << "  ";
    } else {
        out << "      ";
    }

    out << std::left << std::setw(16) << opcodeToString(instr.opcode);

    switch (instr.opcode) {
        case OpCode::LOAD_CONST:
            if (instr.extra == "float") {
                out << instr.dest << ", " << std::fixed << std::setprecision(6) << instr.floatVal;
            } else {
                out << instr.dest << ", " << instr.intVal;
            }
            break;

        case OpCode::LOAD_MEM:
            out << instr.dest << ", " << instr.src1;
            break;

        case OpCode::STORE_MEM:
            out << instr.dest << ", " << instr.src1;
            break;

        case OpCode::ADD: case OpCode::SUB:
        case OpCode::MUL: case OpCode::DIV:
            out << instr.dest << ", " << instr.src1 << ", " << instr.src2;
            break;

        case OpCode::CMP_EQ: case OpCode::CMP_NEQ:
        case OpCode::CMP_LT: case OpCode::CMP_GT:
        case OpCode::CMP_LTE: case OpCode::CMP_GTE:
            out << instr.dest << ", " << instr.src1 << ", " << instr.src2;
            break;

        case OpCode::JMP:
            out << instr.dest;
            break;

        case OpCode::JMP_IF_FALSE:
            out << instr.src1 << ", " << instr.dest;
            break;

        case OpCode::ALLOC_STACK:
            out << instr.intVal << " bytes";
            break;

        case OpCode::ALLOC_TENSOR:
            out << instr.dest << ", " << instr.intVal << " bytes";
            break;

        case OpCode::CALL_INFER:
            out << instr.dest << ", " << instr.src1 << ", \"" << instr.extra << "\"";
            break;

        case OpCode::CALL_REMOTE:
            out << "\"" << instr.extra << "\"";
            break;

        case OpCode::END_REMOTE:
            break;

        case OpCode::TENSOR_ADD: case OpCode::TENSOR_SUB:
        case OpCode::TENSOR_MUL: case OpCode::TENSOR_DIV:
            out << instr.dest << ", " << instr.src1 << ", " << instr.src2 << " (" << instr.intVal << "B)";
            break;

        default:
            break;
    }

    return out.str();
}

inline std::string formatTAC(const std::vector<Instruction>& instrs, const std::string& title = "TAC") {
    std::ostringstream out;
    out << "\n";
    out << "======================================================================\n";
    out << "  " << title << " (" << instrs.size() << " instructions)\n";
    out << "======================================================================\n\n";

    int idx = 0;
    for (const auto& instr : instrs) {
        std::string line = formatInstruction(instr, idx);
        if (!line.empty()) {
            out << line << "\n";
        }
        idx++;
    }

    out << "\n======================================================================\n";
    return out.str();
}

} // namespace aether
