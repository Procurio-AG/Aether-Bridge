// ============================================================================
// Aether-Lang — x86-64 Assembly Emitter (Stage 6)
// ============================================================================
// Translates optimized TAC → AT&T-syntax x86-64 Linux assembly.
//
// Design:
//   - Virtual registers (t0, t1, ...) are spilled to the stack frame.
//     Each temp gets 8 bytes at [RBP - (tempSlotBase + id*8)].
//   - We use %rax, %rbx, %rcx, %rdx as scratch registers.
//   - The prologue reserves space for both declared variables (whose
//     offsets come from the frontend) AND spillable temporaries.
//   - String literals are emitted in .rodata and referenced via labels.
//   - External symbols: _aether_infer, _aether_dispatch_remote.
// ============================================================================

#pragma once

#include "ir_instruction.h"

#include <string>
#include <vector>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cmath>
#include <iomanip>

namespace aether {

class X86Emitter {
public:
    /// Emit x86-64 AT&T assembly from a flat TAC vector.
    std::string emit(const std::vector<Instruction>& instrs) {
        out_.str("");
        out_.clear();
        strings_.clear();
        stringCounter_ = 0;
        tempSlotBase_ = 0;
        totalFrame_ = 0;

        // ── Pre-scan ────────────────────────────────────────────────
        prescan(instrs);

        // ── Emit preamble ───────────────────────────────────────────
        emitPreamble();

        // ── Emit string constants (.rodata) ─────────────────────────
        emitRodata();

        // ── Emit .text section ──────────────────────────────────────
        emitTextHeader();

        // ── Emit prologue ───────────────────────────────────────────
        emitPrologue();

        // ── Emit body ───────────────────────────────────────────────
        for (const auto& instr : instrs) {
            emitInstruction(instr);
        }

        // ── Emit epilogue ───────────────────────────────────────────
        emitEpilogue();

        return out_.str();
    }

private:
    std::ostringstream out_;

    // String literal table: label_name → string content
    std::unordered_map<std::string, std::string> strings_;
    // Reverse: string content → label (for dedup)
    std::unordered_map<std::string, std::string> stringLabels_;
    int stringCounter_ = 0;

    // Stack layout
    int tempSlotBase_ = 0;   // byte offset where temp spill area starts
    int maxTempId_    = 0;   // highest tN seen
    int totalFrame_   = 0;   // total frame size (16-byte aligned)
    int declaredFrame_= 0;   // frame from ALLOC_STACK

    // ========================================================================
    //  Pre-scan: Discover string literals & max temp register
    // ========================================================================

    void prescan(const std::vector<Instruction>& instrs) {
        maxTempId_ = 0;

        for (const auto& instr : instrs) {
            // Collect string literals from CALL_INFER and CALL_REMOTE
            if (instr.opcode == OpCode::CALL_INFER && !instr.extra.empty()) {
                internString(instr.extra);
            }
            if (instr.opcode == OpCode::CALL_REMOTE && !instr.extra.empty()) {
                internString(instr.extra);
            }

            // Track max temp id
            scanTemp(instr.dest);
            scanTemp(instr.src1);
            scanTemp(instr.src2);

            // Capture declared frame size
            if (instr.opcode == OpCode::ALLOC_STACK) {
                declaredFrame_ = instr.intVal;
            }
        }

        // Layout: [declared vars][temp spill slots]
        // Each temp gets 8 bytes (to hold either int64 or double).
        tempSlotBase_ = declaredFrame_;
        int tempSpillBytes = (maxTempId_ + 1) * 8;
        int rawFrame = declaredFrame_ + tempSpillBytes;

        // Align to 16 bytes (ABI requirement)
        totalFrame_ = (rawFrame + 15) & ~15;
    }

    void scanTemp(const std::string& reg) {
        if (reg.size() > 1 && reg[0] == 't') {
            try {
                int id = std::stoi(reg.substr(1));
                if (id > maxTempId_) maxTempId_ = id;
            } catch (...) {}
        }
    }

    std::string internString(const std::string& str) {
        auto it = stringLabels_.find(str);
        if (it != stringLabels_.end()) return it->second;

        std::string label = ".Lstr" + std::to_string(stringCounter_++);
        strings_[label] = str;
        stringLabels_[str] = label;
        return label;
    }

    // ========================================================================
    //  Temp register → memory mapping
    // ========================================================================

    /// Returns the stack offset for temp register tN.
    int tempOffset(const std::string& reg) const {
        if (reg.size() > 1 && reg[0] == 't') {
            int id = std::stoi(reg.substr(1));
            return tempSlotBase_ + id * 8;
        }
        return 0;
    }

    /// Returns AT&T memory operand for a temp register: -OFFSET(%rbp)
    std::string tempMem(const std::string& reg) const {
        return "-" + std::to_string(tempOffset(reg)) + "(%rbp)";
    }

    /// Returns AT&T memory operand for a declared variable offset.
    std::string varMem(int offset) const {
        return "-" + std::to_string(offset) + "(%rbp)";
    }

    /// Parse an offset from [RBP-N] format.
    int parseRBPOffset(const std::string& s) const {
        auto pos = s.find("RBP-");
        if (pos != std::string::npos) {
            return std::stoi(s.substr(pos + 4, s.find(']') - pos - 4));
        }
        return 0;
    }

    // ========================================================================
    //  Assembly Emission Helpers
    // ========================================================================

    void line(const std::string& s)         { out_ << s << "\n"; }
    void indent(const std::string& s)       { out_ << "    " << s << "\n"; }
    void comment(const std::string& s)      { out_ << "    # " << s << "\n"; }
    void label(const std::string& s)        { out_ << s << ":\n"; }
    void blank()                            { out_ << "\n"; }

    // ── Load temp tN into %rax ──
    void loadTemp(const std::string& reg, const std::string& dest = "%rax") {
        indent("movq    " + tempMem(reg) + ", " + dest);
    }

    // ── Store %rax into temp tN ──
    void storeTemp(const std::string& reg, const std::string& src = "%rax") {
        indent("movq    " + src + ", " + tempMem(reg));
    }

    // ========================================================================
    //  Section Emitters
    // ========================================================================

    void emitPreamble() {
        line("# ============================================================================");
        line("# Aether-Lang — Generated x86-64 Assembly (AT&T Syntax)");
        line("# Target: Linux x86-64, System V AMD64 ABI");
        line("# ============================================================================");
        blank();
        indent(".file   \"aether_output.s\"");
        blank();
    }

    void emitRodata() {
        if (strings_.empty()) return;

        indent(".section .rodata");
        for (const auto& [lbl, str] : strings_) {
            line(lbl + ":");
            indent(".asciz  \"" + escapeString(str) + "\"");
        }
        blank();
    }

    void emitTextHeader() {
        indent(".text");
        indent(".globl  main");
        indent(".type   main, @function");
        blank();
    }

    void emitPrologue() {
        label("main");
        comment("=== Prologue ===");
        indent("pushq   %rbp");
        indent("movq    %rsp, %rbp");
        indent("subq    $" + std::to_string(totalFrame_) + ", %rsp");
        blank();
    }

    void emitEpilogue() {
        blank();
        comment("=== Epilogue ===");
        indent("xorl    %eax, %eax");           // return 0
        indent("movq    %rbp, %rsp");
        indent("popq    %rbp");
        indent("ret");
        blank();
        indent(".size   main, .-main");
    }

    // ========================================================================
    //  Instruction Translation
    // ========================================================================

    void emitInstruction(const Instruction& instr) {
        switch (instr.opcode) {
            case OpCode::NOP:
                break;

            case OpCode::COMMENT:
                comment(instr.extra);
                break;

            case OpCode::ALLOC_STACK:
                // Already handled in prologue
                comment("Stack frame: " + std::to_string(instr.intVal) + " bytes (aligned to " +
                        std::to_string(totalFrame_) + ")");
                break;

            case OpCode::ALLOC_TENSOR:
                comment("Tensor at " + instr.dest + " (" + std::to_string(instr.intVal) + " bytes) — reserved in stack frame");
                break;

            case OpCode::LOAD_CONST:
                emitLoadConst(instr);
                break;

            case OpCode::LOAD_MEM:
                emitLoadMem(instr);
                break;

            case OpCode::STORE_MEM:
                emitStoreMem(instr);
                break;

            case OpCode::ADD: case OpCode::SUB:
            case OpCode::MUL: case OpCode::DIV:
                emitArith(instr);
                break;

            case OpCode::CMP_EQ: case OpCode::CMP_NEQ:
            case OpCode::CMP_LT: case OpCode::CMP_GT:
            case OpCode::CMP_LTE: case OpCode::CMP_GTE:
                emitCompare(instr);
                break;

            case OpCode::LABEL:
                label(".L_" + instr.dest);
                break;

            case OpCode::JMP:
                indent("jmp     .L_" + instr.dest);
                break;

            case OpCode::JMP_IF_FALSE:
                emitJmpIfFalse(instr);
                break;

            case OpCode::CALL_INFER:
                emitCallInfer(instr);
                break;

            case OpCode::CALL_REMOTE:
                emitCallRemote(instr);
                break;

            case OpCode::END_REMOTE:
                comment("--- end remote block ---");
                indent("call    _aether_end_remote");
                break;

            case OpCode::TENSOR_ADD: case OpCode::TENSOR_SUB:
            case OpCode::TENSOR_MUL: case OpCode::TENSOR_DIV:
                emitTensorOp(instr);
                break;
        }
    }

    // ── LOAD_CONST ──────────────────────────────────────────────────────

    void emitLoadConst(const Instruction& instr) {
        if (instr.extra == "float") {
            // Encode float as raw bits and load via integer path
            comment("load float " + std::to_string(instr.floatVal) + " -> " + instr.dest);
            union { double d; uint64_t u; } conv;
            conv.d = instr.floatVal;
            indent("movabsq $" + std::to_string(conv.u) + ", %rax");
            storeTemp(instr.dest);
        } else {
            comment("load int " + std::to_string(instr.intVal) + " -> " + instr.dest);
            indent("movq    $" + std::to_string(instr.intVal) + ", %rax");
            storeTemp(instr.dest);
        }
    }

    // ── LOAD_MEM ────────────────────────────────────────────────────────

    void emitLoadMem(const Instruction& instr) {
        int off = instr.intVal;
        comment("load [RBP-" + std::to_string(off) + "] -> " + instr.dest);
        indent("movq    " + varMem(off) + ", %rax");
        storeTemp(instr.dest);
    }

    // ── STORE_MEM ───────────────────────────────────────────────────────

    void emitStoreMem(const Instruction& instr) {
        int off = instr.intVal;
        comment("store " + instr.src1 + " -> [RBP-" + std::to_string(off) + "]");
        loadTemp(instr.src1, "%rax");
        indent("movq    %rax, " + varMem(off));
    }

    // ── Arithmetic ──────────────────────────────────────────────────────

    void emitArith(const Instruction& instr) {
        std::string opName;
        switch (instr.opcode) {
            case OpCode::ADD: opName = "ADD"; break;
            case OpCode::SUB: opName = "SUB"; break;
            case OpCode::MUL: opName = "MUL"; break;
            case OpCode::DIV: opName = "DIV"; break;
            default: opName = "???";
        }
        comment(opName + " " + instr.dest + " = " + instr.src1 + " op " + instr.src2);

        // Load src1 → %rax, src2 → %rbx
        loadTemp(instr.src1, "%rax");
        loadTemp(instr.src2, "%rbx");

        switch (instr.opcode) {
            case OpCode::ADD:
                indent("addq    %rbx, %rax");
                break;
            case OpCode::SUB:
                indent("subq    %rbx, %rax");
                break;
            case OpCode::MUL:
                indent("imulq   %rbx, %rax");
                break;
            case OpCode::DIV:
                // idivq divides RDX:RAX by operand; result in RAX, remainder in RDX
                indent("cqto");                     // sign-extend RAX into RDX:RAX
                indent("idivq   %rbx");
                break;
            default: break;
        }

        // Store result from %rax → dest
        storeTemp(instr.dest);
    }

    // ── Comparison ──────────────────────────────────────────────────────

    void emitCompare(const Instruction& instr) {
        std::string setInstr;
        switch (instr.opcode) {
            case OpCode::CMP_EQ:  setInstr = "sete";  break;
            case OpCode::CMP_NEQ: setInstr = "setne"; break;
            case OpCode::CMP_LT:  setInstr = "setl";  break;
            case OpCode::CMP_GT:  setInstr = "setg";  break;
            case OpCode::CMP_LTE: setInstr = "setle"; break;
            case OpCode::CMP_GTE: setInstr = "setge"; break;
            default: setInstr = "sete";
        }

        comment("compare " + instr.src1 + " vs " + instr.src2 + " -> " + instr.dest);

        loadTemp(instr.src1, "%rax");
        loadTemp(instr.src2, "%rbx");
        indent("cmpq    %rbx, %rax");
        indent(setInstr + "    %al");
        indent("movzbq  %al, %rax");
        storeTemp(instr.dest);
    }

    // ── JMP_IF_FALSE ────────────────────────────────────────────────────

    void emitJmpIfFalse(const Instruction& instr) {
        comment("if !" + instr.src1 + " goto " + instr.dest);
        loadTemp(instr.src1, "%rax");
        indent("testq   %rax, %rax");
        indent("je      .L_" + instr.dest);
    }

    // ── CALL_INFER ──────────────────────────────────────────────────────

    void emitCallInfer(const Instruction& instr) {
        comment("infer: " + instr.dest + " = _aether_infer(" + instr.src1 + ", \"" + instr.extra + "\")");

        // %rdi = pointer to source tensor on stack
        int srcOff = parseRBPOffset(instr.src1);
        indent("leaq    " + varMem(srcOff) + ", %rdi");

        // %rsi = pointer to model name string
        std::string strLabel = stringLabels_[instr.extra];
        indent("leaq    " + strLabel + "(%rip), %rsi");

        // ABI: align stack before call (preserve 16-byte alignment)
        indent("call    _aether_infer");

        // Result in %rax → store to dest temp
        storeTemp(instr.dest);
    }

    // ── CALL_REMOTE ─────────────────────────────────────────────────────

    void emitCallRemote(const Instruction& instr) {
        comment("remote: dispatch to \"" + instr.extra + "\"");

        // %rdi = pointer to IP string
        std::string strLabel = stringLabels_[instr.extra];
        indent("leaq    " + strLabel + "(%rip), %rdi");
        indent("call    _aether_dispatch_remote");
    }

    // ── Tensor Operations ───────────────────────────────────────────────

    void emitTensorOp(const Instruction& instr) {
        std::string opName;
        std::string asmOp;
        switch (instr.opcode) {
            case OpCode::TENSOR_ADD: opName = "TENSOR_ADD"; asmOp = "addl"; break;
            case OpCode::TENSOR_SUB: opName = "TENSOR_SUB"; asmOp = "subl"; break;
            case OpCode::TENSOR_MUL: opName = "TENSOR_MUL"; asmOp = "imull"; break;
            case OpCode::TENSOR_DIV: opName = "TENSOR_DIV"; asmOp = "idivl"; break;
            default: opName = "???"; asmOp = "???";
        }

        int destOff = parseRBPOffset(instr.dest);
        int src1Off = parseRBPOffset(instr.src1);
        int src2Off = parseRBPOffset(instr.src2);
        int bytes   = instr.intVal;
        int count   = bytes / 4; // number of 32-bit elements

        comment(opName + " " + instr.dest + " = " + instr.src1 + " op " + instr.src2 +
                " (" + std::to_string(bytes) + " bytes, " + std::to_string(count) + " elements)");

        // Emit an element-wise loop:
        //   leaq  dest(%rbp), %rdi
        //   leaq  src1(%rbp), %rsi
        //   leaq  src2(%rbp), %rdx
        //   movq  $count, %rcx
        // .Ltensor_N:
        //   movl  (%rsi), %eax
        //   addl  (%rdx), %eax      (or subl, imull)
        //   movl  %eax, (%rdi)
        //   addq  $4, %rdi
        //   addq  $4, %rsi
        //   addq  $4, %rdx
        //   decq  %rcx
        //   jnz   .Ltensor_N

        std::string loopLabel = ".Ltensor_" + std::to_string(tensorLoopCounter_++);

        indent("leaq    " + varMem(destOff) + ", %rdi");
        indent("leaq    " + varMem(src1Off) + ", %rsi");
        indent("leaq    " + varMem(src2Off) + ", %rdx");
        indent("movq    $" + std::to_string(count) + ", %rcx");

        label(loopLabel);

        if (instr.opcode == OpCode::TENSOR_DIV) {
            // Division requires special handling
            indent("movl    (%rsi), %eax");
            indent("cltd");                             // sign-extend EAX → EDX:EAX
            indent("idivl   (%rdx)");
            indent("movl    %eax, (%rdi)");
        } else {
            indent("movl    (%rsi), %eax");
            indent(asmOp + "   (%rdx), %eax");
            indent("movl    %eax, (%rdi)");
        }

        indent("addq    $4, %rdi");
        indent("addq    $4, %rsi");
        indent("addq    $4, %rdx");
        indent("decq    %rcx");
        indent("jnz     " + loopLabel);
    }

    int tensorLoopCounter_ = 0;

    // ========================================================================
    //  Utility
    // ========================================================================

    std::string escapeString(const std::string& s) const {
        std::string result;
        for (char c : s) {
            switch (c) {
                case '\\': result += "\\\\"; break;
                case '"':  result += "\\\""; break;
                case '\n': result += "\\n";  break;
                case '\t': result += "\\t";  break;
                default:   result += c;
            }
        }
        return result;
    }
};

} // namespace aether
