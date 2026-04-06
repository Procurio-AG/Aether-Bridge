// ============================================================================
// Aether-Lang — Three-Address Code (TAC) Instruction Definition
// ============================================================================

export enum OpCode {
    // ── Data movement ──
    LOAD_CONST,
    LOAD_MEM,
    STORE_MEM,

    // ── Arithmetic ──
    ADD,
    SUB,
    MUL,
    DIV,

    // ── Comparison ──
    CMP_EQ,
    CMP_NEQ,
    CMP_LT,
    CMP_GT,
    CMP_LTE,
    CMP_GTE,

    // ── Control flow ──
    LABEL,
    JMP,
    JMP_IF_FALSE,

    // ── Stack frame ──
    ALLOC_STACK,
    ALLOC_TENSOR,

    // ── AI / Cloud intrinsics ──
    CALL_INFER,
    CALL_REMOTE,
    END_REMOTE,

    // ── Tensor operations ──
    TENSOR_ADD,
    TENSOR_SUB,
    TENSOR_MUL,
    TENSOR_DIV,

    // ── Meta ──
    COMMENT,
    NOP,
}

export interface Instruction {
    opcode: OpCode;
    dest: string;
    src1: string;
    src2: string;
    extra: string;
    intVal: number;
    floatVal: number;
    srcLine: number;
}

export const InstructionFactory = {
    loadConst(dest: string, val: number, line: number = 0): Instruction {
        return { opcode: OpCode.LOAD_CONST, dest, src1: "", src2: "", extra: "", intVal: val, floatVal: 0.0, srcLine: line };
    },
    loadConstFloat(dest: string, val: number, line: number = 0): Instruction {
        return { opcode: OpCode.LOAD_CONST, dest, src1: "", src2: "", extra: "float", intVal: 0, floatVal: val, srcLine: line };
    },
    loadMem(dest: string, offset: number, line: number = 0): Instruction {
        return { opcode: OpCode.LOAD_MEM, dest, src1: `[RBP-${offset}]`, src2: "", extra: "", intVal: offset, floatVal: 0.0, srcLine: line };
    },
    storeMem(offset: number, src: string, line: number = 0): Instruction {
        return { opcode: OpCode.STORE_MEM, dest: `[RBP-${offset}]`, src1: src, src2: "", extra: "", intVal: offset, floatVal: 0.0, srcLine: line };
    },
    arith(op: OpCode, dest: string, s1: string, s2: string, line: number = 0): Instruction {
        return { opcode: op, dest, src1: s1, src2: s2, extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    cmp(op: OpCode, dest: string, s1: string, s2: string, line: number = 0): Instruction {
        return { opcode: op, dest, src1: s1, src2: s2, extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    label(name: string, line: number = 0): Instruction {
        return { opcode: OpCode.LABEL, dest: name, src1: "", src2: "", extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    jmp(target: string, line: number = 0): Instruction {
        return { opcode: OpCode.JMP, dest: target, src1: "", src2: "", extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    jmpIfFalse(cond: string, target: string, line: number = 0): Instruction {
        return { opcode: OpCode.JMP_IF_FALSE, dest: target, src1: cond, src2: "", extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    allocStack(bytes: number, line: number = 0): Instruction {
        return { opcode: OpCode.ALLOC_STACK, dest: "", src1: "", src2: "", extra: "", intVal: bytes, floatVal: 0.0, srcLine: line };
    },
    allocTensor(offset: number, byteSize: number, line: number = 0): Instruction {
        return { opcode: OpCode.ALLOC_TENSOR, dest: `[RBP-${offset}]`, src1: "", src2: "", extra: "", intVal: byteSize, floatVal: 0.0, srcLine: line };
    },
    callInfer(dest: string, src: string, model: string, line: number = 0): Instruction {
        return { opcode: OpCode.CALL_INFER, dest, src1: src, src2: "", extra: model, intVal: 0, floatVal: 0.0, srcLine: line };
    },
    callRemote(ip: string, line: number = 0): Instruction {
        return { opcode: OpCode.CALL_REMOTE, dest: "", src1: "", src2: "", extra: ip, intVal: 0, floatVal: 0.0, srcLine: line };
    },
    endRemote(line: number = 0): Instruction {
        return { opcode: OpCode.END_REMOTE, dest: "", src1: "", src2: "", extra: "", intVal: 0, floatVal: 0.0, srcLine: line };
    },
    tensorOp(op: OpCode, destOff: number, src1Off: number, src2Off: number, bytes: number, line: number = 0): Instruction {
        return { opcode: op,
                 dest: `[RBP-${destOff}]`,
                 src1: `[RBP-${src1Off}]`,
                 src2: `[RBP-${src2Off}]`,
                 extra: "", intVal: bytes, floatVal: 0.0, srcLine: line };
    },
    comment(text: string, line: number = 0): Instruction {
        return { opcode: OpCode.COMMENT, dest: "", src1: "", src2: "", extra: text, intVal: 0, floatVal: 0.0, srcLine: line };
    },
    nop(): Instruction {
        return { opcode: OpCode.NOP, dest: "", src1: "", src2: "", extra: "", intVal: 0, floatVal: 0.0, srcLine: 0 };
    }
};

export function opcodeToString(op: OpCode): string {
    return OpCode[op] || "???";
}

export function formatInstruction(instr: Instruction, index: number = -1): string {
    if (instr.opcode === OpCode.NOP) return "";

    if (instr.opcode === OpCode.COMMENT) {
        return `    ; ${instr.extra}`;
    }

    if (instr.opcode === OpCode.LABEL) {
        return `${instr.dest}:`;
    }

    const idxStr = index >= 0 ? index.toString().padStart(4, " ") + "  " : "      ";
    const opStr = opcodeToString(instr.opcode).padEnd(16, " ");

    let details = "";
    switch (instr.opcode) {
        case OpCode.LOAD_CONST:
            if (instr.extra === "float") {
                details = `${instr.dest}, ${instr.floatVal.toFixed(6)}`;
            } else {
                details = `${instr.dest}, ${instr.intVal}`;
            }
            break;
        case OpCode.LOAD_MEM:
        case OpCode.STORE_MEM:
            details = `${instr.dest}, ${instr.src1}`;
            break;
        case OpCode.ADD: case OpCode.SUB:
        case OpCode.MUL: case OpCode.DIV:
        case OpCode.CMP_EQ: case OpCode.CMP_NEQ:
        case OpCode.CMP_LT: case OpCode.CMP_GT:
        case OpCode.CMP_LTE: case OpCode.CMP_GTE:
            details = `${instr.dest}, ${instr.src1}, ${instr.src2}`;
            break;
        case OpCode.JMP:
            details = instr.dest;
            break;
        case OpCode.JMP_IF_FALSE:
            details = `${instr.src1}, ${instr.dest}`;
            break;
        case OpCode.ALLOC_STACK:
            details = `${instr.intVal} bytes`;
            break;
        case OpCode.ALLOC_TENSOR:
            details = `${instr.dest}, ${instr.intVal} bytes`;
            break;
        case OpCode.CALL_INFER:
            details = `${instr.dest}, ${instr.src1}, "${instr.extra}"`;
            break;
        case OpCode.CALL_REMOTE:
            details = `"${instr.extra}"`;
            break;
        case OpCode.END_REMOTE:
            break;
        case OpCode.TENSOR_ADD: case OpCode.TENSOR_SUB:
        case OpCode.TENSOR_MUL: case OpCode.TENSOR_DIV:
            details = `${instr.dest}, ${instr.src1}, ${instr.src2} (${instr.intVal}B)`;
            break;
    }

    return `${idxStr}${opStr}${details}`;
}

export function formatTAC(instrs: Instruction[], title: string = "TAC"): string {
    const lines = [
        "",
        "======================================================================",
        `  ${title} (${instrs.length} instructions)`,
        "======================================================================",
        ""
    ];

    let idx = 0;
    for (const instr of instrs) {
        const line = formatInstruction(instr, idx);
        if (line) lines.push(line);
        idx++;
    }

    lines.push("");
    lines.push("======================================================================");
    return lines.join("\n");
}
