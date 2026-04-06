// ============================================================================
// Aether-Lang — IR Optimizer (Stage 5)
// ============================================================================
// Three optimization passes on flat TAC:
//   1. Constant Folding — pre-compute arithmetic on known constants
//   2. Dead Code Elimination — remove writes that are never read
//   3. Peephole Optimization — eliminate redundant STORE-LOAD sequences
// ============================================================================

#pragma once

#include "ir_instruction.h"

#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cmath>
#include <sstream>

namespace aether {

// ── Optimization Statistics ────────────────────────────────────────────────
struct OptStats {
    int constantsFolded  = 0;
    int deadCodeRemoved  = 0;
    int peepholeApplied  = 0;

    std::string summary() const {
        std::ostringstream out;
        out << "  Constants folded:    " << constantsFolded << "\n";
        out << "  Dead code removed:   " << deadCodeRemoved << "\n";
        out << "  Peephole optimised:  " << peepholeApplied << "\n";
        out << "  Total eliminated:    " << (constantsFolded + deadCodeRemoved + peepholeApplied) << "\n";
        return out.str();
    }
};

// ============================================================================
//  Optimizer
// ============================================================================

class Optimizer {
public:
    /// Run all optimization passes. Returns a new optimized instruction vector.
    std::vector<Instruction> optimize(const std::vector<Instruction>& input) {
        stats_ = {};
        auto result = input;

        result = constantFolding(result);
        result = deadCodeElimination(result);
        result = peepholeOptimization(result);

        // Remove NOPs
        result.erase(
            std::remove_if(result.begin(), result.end(),
                [](const Instruction& i) { return i.opcode == OpCode::NOP; }),
            result.end());

        return result;
    }

    const OptStats& stats() const { return stats_; }

private:
    OptStats stats_;

    // ========================================================================
    //  Pass 1: Constant Folding
    // ========================================================================
    //
    //  Pattern:
    //    LOAD_CONST t1, 5
    //    LOAD_CONST t2, 10
    //    ADD        t3, t1, t2
    //  →
    //    LOAD_CONST t3, 15
    //    NOP
    //    NOP
    //
    // We scan for arithmetic instructions where both operands are temporaries
    // that were loaded from constants, and replace the entire sequence with a
    // single pre-computed LOAD_CONST.
    // ========================================================================

    std::vector<Instruction> constantFolding(std::vector<Instruction> instrs) {
        // Map: temp register → {isConst, intVal, floatVal, isFloat, instrIndex}
        struct ConstInfo {
            bool   isConst  = false;
            int    intVal   = 0;
            double floatVal = 0.0;
            bool   isFloat  = false;
            int    index    = -1;
        };

        std::unordered_map<std::string, ConstInfo> constMap;

        for (int i = 0; i < (int)instrs.size(); i++) {
            auto& instr = instrs[i];

            if (instr.opcode == OpCode::LOAD_CONST) {
                ConstInfo ci;
                ci.isConst = true;
                ci.index   = i;
                if (instr.extra == "float") {
                    ci.isFloat  = true;
                    ci.floatVal = instr.floatVal;
                } else {
                    ci.isFloat = false;
                    ci.intVal  = instr.intVal;
                }
                constMap[instr.dest] = ci;
                continue;
            }

            // Check arithmetic ops
            if (instr.opcode == OpCode::ADD || instr.opcode == OpCode::SUB ||
                instr.opcode == OpCode::MUL || instr.opcode == OpCode::DIV) {

                auto itL = constMap.find(instr.src1);
                auto itR = constMap.find(instr.src2);

                if (itL != constMap.end() && itL->second.isConst &&
                    itR != constMap.end() && itR->second.isConst) {

                    const auto& lhs = itL->second;
                    const auto& rhs = itR->second;
                    bool isFloat = lhs.isFloat || rhs.isFloat;

                    double lv = lhs.isFloat ? lhs.floatVal : (double)lhs.intVal;
                    double rv = rhs.isFloat ? rhs.floatVal : (double)rhs.intVal;
                    double result = 0.0;

                    switch (instr.opcode) {
                        case OpCode::ADD: result = lv + rv; break;
                        case OpCode::SUB: result = lv - rv; break;
                        case OpCode::MUL: result = lv * rv; break;
                        case OpCode::DIV:
                            if (rv == 0.0) continue; // skip division by zero
                            result = lv / rv;
                            break;
                        default: continue;
                    }

                    // Replace the arithmetic instruction with LOAD_CONST
                    if (isFloat) {
                        instrs[i] = Instruction::loadConstFloat(instr.dest, result, instr.srcLine);
                    } else {
                        instrs[i] = Instruction::loadConst(instr.dest, (int)result, instr.srcLine);
                    }

                    // NOP the original LOAD_CONST instructions (if not used elsewhere)
                    instrs[lhs.index] = Instruction::nop();
                    instrs[rhs.index] = Instruction::nop();

                    // Register the folded result as a new constant
                    ConstInfo ci;
                    ci.isConst  = true;
                    ci.isFloat  = isFloat;
                    ci.intVal   = (int)result;
                    ci.floatVal = result;
                    ci.index    = i;
                    constMap[instr.dest] = ci;

                    stats_.constantsFolded++;
                }
            }

            // If a temp is overwritten by a non-const, invalidate it
            if (!instr.dest.empty() && instr.opcode != OpCode::LOAD_CONST) {
                constMap.erase(instr.dest);
            }
        }

        return instrs;
    }

    // ========================================================================
    //  Pass 2: Dead Code Elimination (DCE)
    // ========================================================================
    //
    //  A temp register is "dead" if it is written but never subsequently read
    //  (as src1 or src2) before being overwritten or the end of the program.
    //  We mark such instructions as NOP.
    //
    //  We do NOT eliminate:
    //    - STORE_MEM (writes to stack — observable side effect)
    //    - CALL_INFER, CALL_REMOTE, END_REMOTE (side effects)
    //    - ALLOC_* (resource allocation)
    //    - LABEL, JMP, JMP_IF_FALSE (control flow)
    //    - COMMENT
    //    - TENSOR_* (side effects on memory)
    // ========================================================================

    std::vector<Instruction> deadCodeElimination(std::vector<Instruction> instrs) {
        // Collect all used registers (those appearing as src1 or src2)
        std::unordered_set<std::string> usedRegs;

        for (const auto& instr : instrs) {
            if (!instr.src1.empty()) usedRegs.insert(instr.src1);
            if (!instr.src2.empty()) usedRegs.insert(instr.src2);
        }

        // Mark dead LOAD_CONST and arithmetic instructions
        for (int i = 0; i < (int)instrs.size(); i++) {
            auto& instr = instrs[i];

            // Only consider instructions that write to a temp register (tN)
            if (instr.dest.empty() || instr.dest[0] != 't') continue;

            // Skip if the instruction has side effects
            if (instr.opcode == OpCode::STORE_MEM  ||
                instr.opcode == OpCode::CALL_INFER  ||
                instr.opcode == OpCode::CALL_REMOTE ||
                instr.opcode == OpCode::END_REMOTE  ||
                instr.opcode == OpCode::ALLOC_STACK ||
                instr.opcode == OpCode::ALLOC_TENSOR ||
                instr.opcode == OpCode::LABEL        ||
                instr.opcode == OpCode::JMP          ||
                instr.opcode == OpCode::JMP_IF_FALSE ||
                instr.opcode == OpCode::COMMENT      ||
                instr.opcode == OpCode::NOP) {
                continue;
            }

            // If dest is never used as a source, it's dead
            if (usedRegs.find(instr.dest) == usedRegs.end()) {
                instrs[i] = Instruction::nop();
                stats_.deadCodeRemoved++;
            }
        }

        return instrs;
    }

    // ========================================================================
    //  Pass 3: Peephole Optimization
    // ========================================================================
    //
    //  Pattern 1: Redundant STORE then LOAD
    //    STORE_MEM  [RBP-N], tX
    //    LOAD_MEM   tY, [RBP-N]
    //  →
    //    STORE_MEM  [RBP-N], tX
    //    (replace tY with tX everywhere downstream, NOP the LOAD)
    //
    //  Pattern 2: Store immediately after Load from same location
    //    LOAD_MEM   tX, [RBP-N]
    //    STORE_MEM  [RBP-N], tX
    //  → NOP the STORE (writing back the same value)
    // ========================================================================

    std::vector<Instruction> peepholeOptimization(std::vector<Instruction> instrs) {
        // Pattern 1: STORE then LOAD from same offset
        for (int i = 0; i + 1 < (int)instrs.size(); i++) {
            auto& a = instrs[i];
            auto& b = instrs[i + 1];

            if (a.opcode == OpCode::STORE_MEM && b.opcode == OpCode::LOAD_MEM) {
                // Same memory location?
                if (a.dest == b.src1 && a.intVal == b.intVal) {
                    // Replace all uses of b.dest with a.src1
                    std::string oldReg = b.dest;
                    std::string newReg = a.src1;

                    for (int j = i + 2; j < (int)instrs.size(); j++) {
                        if (instrs[j].src1 == oldReg) instrs[j].src1 = newReg;
                        if (instrs[j].src2 == oldReg) instrs[j].src2 = newReg;
                    }

                    instrs[i + 1] = Instruction::nop();
                    stats_.peepholeApplied++;
                }
            }

            // Pattern 2: LOAD then STORE back to same location
            if (a.opcode == OpCode::LOAD_MEM && b.opcode == OpCode::STORE_MEM) {
                if (a.src1 == b.dest && a.dest == b.src1 && a.intVal == b.intVal) {
                    instrs[i + 1] = Instruction::nop();
                    stats_.peepholeApplied++;
                }
            }
        }

        return instrs;
    }
};

} // namespace aether
