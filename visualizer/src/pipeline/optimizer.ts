// ============================================================================
// Aether-Lang — IR Optimizer (Stage 5)
// ============================================================================

import { OpCode, Instruction, InstructionFactory as I } from "./ir_instruction";

export interface OptStats {
    constantsFolded: number;
    deadCodeRemoved: number;
    peepholeApplied: number;
}

export class Optimizer {
    private stats_: OptStats = { constantsFolded: 0, deadCodeRemoved: 0, peepholeApplied: 0 };

    public optimize(input: Instruction[]): Instruction[] {
        this.stats_ = { constantsFolded: 0, deadCodeRemoved: 0, peepholeApplied: 0 };
        let result = [...input];

        result = this.constantFolding(result);
        result = this.deadCodeElimination(result);
        result = this.peepholeOptimization(result);

        return result.filter(instr => instr.opcode !== OpCode.NOP);
    }

    public get stats(): OptStats {
        return this.stats_;
    }

    private constantFolding(instrs: Instruction[]): Instruction[] {
        interface ConstInfo {
            isConst: boolean;
            intVal: number;
            floatVal: number;
            isFloat: boolean;
            index: number;
        }

        const constMap = new Map<string, ConstInfo>();

        for (let i = 0; i < instrs.length; i++) {
            const instr = instrs[i];

            if (instr.opcode === OpCode.LOAD_CONST) {
                const ci: ConstInfo = {
                    isConst: true,
                    index: i,
                    isFloat: instr.extra === "float",
                    intVal: instr.extra !== "float" ? instr.intVal : 0,
                    floatVal: instr.extra === "float" ? instr.floatVal : 0.0
                };
                constMap.set(instr.dest, ci);
                continue;
            }

            if ([OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV].includes(instr.opcode)) {
                const lhs = constMap.get(instr.src1);
                const rhs = constMap.get(instr.src2);

                if (lhs?.isConst && rhs?.isConst) {
                    const isFloat = lhs.isFloat || rhs.isFloat;
                    const lv = lhs.isFloat ? lhs.floatVal : lhs.intVal;
                    const rv = rhs.isFloat ? rhs.floatVal : rhs.intVal;
                    let result = 0.0;

                    switch (instr.opcode) {
                        case OpCode.ADD: result = lv + rv; break;
                        case OpCode.SUB: result = lv - rv; break;
                        case OpCode.MUL: result = lv * rv; break;
                        case OpCode.DIV:
                            if (rv === 0.0) continue;
                            result = lv / rv;
                            break;
                    }

                    if (isFloat) {
                        instrs[i] = I.loadConstFloat(instr.dest, result, instr.srcLine);
                    } else {
                        instrs[i] = I.loadConst(instr.dest, Math.trunc(result), instr.srcLine);
                    }

                    instrs[lhs.index] = I.nop();
                    instrs[rhs.index] = I.nop();

                    constMap.set(instr.dest, {
                        isConst: true,
                        isFloat,
                        intVal: Math.trunc(result),
                        floatVal: result,
                        index: i
                    });

                    this.stats_.constantsFolded++;
                }
            }

            if (instr.dest && instr.opcode as any !== OpCode.LOAD_CONST) {
                constMap.delete(instr.dest);
            }
        }

        return instrs;
    }

    private deadCodeElimination(instrs: Instruction[]): Instruction[] {
        const usedRegs = new Set<string>();

        for (const instr of instrs) {
            if (instr.src1) usedRegs.add(instr.src1);
            if (instr.src2) usedRegs.add(instr.src2);
        }

        for (let i = 0; i < instrs.length; i++) {
            const instr = instrs[i];

            if (!instr.dest || !instr.dest.startsWith("t")) continue;

            const sideEffects = [
                OpCode.STORE_MEM, OpCode.CALL_INFER, OpCode.CALL_REMOTE, OpCode.END_REMOTE,
                OpCode.ALLOC_STACK, OpCode.ALLOC_TENSOR, OpCode.LABEL, OpCode.JMP,
                OpCode.JMP_IF_FALSE, OpCode.COMMENT, OpCode.NOP
            ];

            if (sideEffects.includes(instr.opcode)) continue;

            if (!usedRegs.has(instr.dest)) {
                instrs[i] = I.nop();
                this.stats_.deadCodeRemoved++;
            }
        }

        return instrs;
    }

    private peepholeOptimization(instrs: Instruction[]): Instruction[] {
        for (let i = 0; i < instrs.length - 1; i++) {
            const a = instrs[i];
            const b = instrs[i + 1];

            if (a.opcode === OpCode.STORE_MEM && b.opcode === OpCode.LOAD_MEM) {
                if (a.dest === b.src1 && a.intVal === b.intVal) {
                    const oldReg = b.dest;
                    const newReg = a.src1;

                    for (let j = i + 2; j < instrs.length; j++) {
                        if (instrs[j].src1 === oldReg) instrs[j].src1 = newReg;
                        if (instrs[j].src2 === oldReg) instrs[j].src2 = newReg;
                    }

                    instrs[i + 1] = I.nop();
                    this.stats_.peepholeApplied++;
                }
            }

            if (a.opcode === OpCode.LOAD_MEM && b.opcode === OpCode.STORE_MEM) {
                if (a.src1 === b.dest && a.dest === b.src1 && a.intVal === b.intVal) {
                    instrs[i + 1] = I.nop();
                    this.stats_.peepholeApplied++;
                }
            }
        }

        return instrs;
    }
}
