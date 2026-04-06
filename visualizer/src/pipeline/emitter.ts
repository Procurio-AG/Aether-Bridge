// ============================================================================
// Aether-Lang — x86-64 Assembly Emitter (Stage 6)
// ============================================================================

import { OpCode, Instruction } from "./ir_instruction";

export class X86Emitter {
    private out: string[] = [];
    private strings: Map<string, string> = new Map();
    private stringLabels: Map<string, string> = new Map();
    private stringCounter: number = 0;

    private tempSlotBase: number = 0;
    private maxTempId: number = 0;
    private totalFrame: number = 0;
    private declaredFrame: number = 0;
    private tensorLoopCounter: number = 0;

    public emit(instrs: Instruction[]): string {
        this.out = [];
        this.strings.clear();
        this.stringLabels.clear();
        this.stringCounter = 0;
        this.tempSlotBase = 0;
        this.totalFrame = 0;
        this.tensorLoopCounter = 0;

        this.prescan(instrs);
        this.emitPreamble();
        this.emitRodata();
        this.emitTextHeader();
        this.emitPrologue();

        for (const instr of instrs) {
            this.emitInstruction(instr);
        }

        this.emitEpilogue();
        return this.out.join("\n");
    }

    private prescan(instrs: Instruction[]) {
        this.maxTempId = 0;

        for (const instr of instrs) {
            if (instr.opcode === OpCode.CALL_INFER && instr.extra) {
                this.internString(instr.extra);
            }
            if (instr.opcode === OpCode.CALL_REMOTE && instr.extra) {
                this.internString(instr.extra);
            }

            this.scanTemp(instr.dest);
            this.scanTemp(instr.src1);
            this.scanTemp(instr.src2);

            if (instr.opcode === OpCode.ALLOC_STACK) {
                this.declaredFrame = instr.intVal;
            }
        }

        this.tempSlotBase = this.declaredFrame;
        const tempSpillBytes = (this.maxTempId + 1) * 8;
        const rawFrame = this.declaredFrame + tempSpillBytes;
        this.totalFrame = (rawFrame + 15) & ~15;
    }

    private scanTemp(reg: string) {
        if (reg.length > 1 && reg.startsWith("t")) {
            const id = parseInt(reg.substring(1), 10);
            if (!isNaN(id) && id > this.maxTempId) {
                this.maxTempId = id;
            }
        }
    }

    private internString(str: string): string {
        if (this.stringLabels.has(str)) {
            return this.stringLabels.get(str)!;
        }

        const label = `.Lstr${this.stringCounter++}`;
        this.strings.set(label, str);
        this.stringLabels.set(str, label);
        return label;
    }

    private tempOffset(reg: string): number {
        if (reg.length > 1 && reg.startsWith("t")) {
            const id = parseInt(reg.substring(1), 10);
            return this.tempSlotBase + id * 8;
        }
        return 0;
    }

    private tempMem(reg: string): string {
        return `-${this.tempOffset(reg)}(%rbp)`;
    }

    private varMem(offset: number): string {
        return `-${offset}(%rbp)`;
    }

    private parseRBPOffset(s: string): number {
        const match = s.match(/RBP-(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return 0;
    }

    private line(s: string) { this.out.push(s); }
    private indent(s: string) { this.out.push(`    ${s}`); }
    private comment(s: string) { this.out.push(`    # ${s}`); }
    private label(s: string) { this.out.push(`${s}:`); }
    private blank() { this.out.push(""); }

    private loadTemp(reg: string, dest: string = "%rax") {
        this.indent(`movq    ${this.tempMem(reg)}, ${dest}`);
    }

    private storeTemp(reg: string, src: string = "%rax") {
        this.indent(`movq    ${src}, ${this.tempMem(reg)}`);
    }

    private emitPreamble() {
        this.line("# ============================================================================");
        this.line("# Aether-Lang — Generated x86-64 Assembly (AT&T Syntax)");
        this.line("# Target: Linux x86-64, System V AMD64 ABI");
        this.line("# ============================================================================");
        this.blank();
        this.indent(".file   \"aether_output.s\"");
        this.blank();
    }

    private emitRodata() {
        if (this.strings.size === 0) return;

        this.indent(".section .rodata");
        for (const [lbl, str] of this.strings) {
            this.line(`${lbl}:`);
            this.indent(`.asciz  "${this.escapeString(str)}"`);
        }
        this.blank();
    }

    private emitTextHeader() {
        this.indent(".text");
        this.indent(".globl  main");
        this.indent(".type   main, @function");
        this.blank();
    }

    private emitPrologue() {
        this.label("main");
        this.comment("=== Prologue ===");
        this.indent("pushq   %rbp");
        this.indent("movq    %rsp, %rbp");
        this.indent(`subq    $${this.totalFrame}, %rsp`);
        this.blank();
    }

    private emitEpilogue() {
        this.blank();
        this.comment("=== Epilogue ===");
        this.indent("xorl    %eax, %eax");
        this.indent("movq    %rbp, %rsp");
        this.indent("popq    %rbp");
        this.indent("ret");
        this.blank();
        this.indent(".size   main, .-main");
    }

    private emitInstruction(instr: Instruction) {
        switch (instr.opcode) {
            case OpCode.NOP: break;
            case OpCode.COMMENT: this.comment(instr.extra); break;
            case OpCode.ALLOC_STACK:
                this.comment(`Stack frame: ${instr.intVal} bytes (aligned to ${this.totalFrame})`);
                break;
            case OpCode.ALLOC_TENSOR:
                this.comment(`Tensor at ${instr.dest} (${instr.intVal} bytes) — reserved in stack frame`);
                break;
            case OpCode.LOAD_CONST: this.emitLoadConst(instr); break;
            case OpCode.LOAD_MEM: this.emitLoadMem(instr); break;
            case OpCode.STORE_MEM: this.emitStoreMem(instr); break;
            case OpCode.ADD: case OpCode.SUB:
            case OpCode.MUL: case OpCode.DIV: this.emitArith(instr); break;
            case OpCode.CMP_EQ: case OpCode.CMP_NEQ:
            case OpCode.CMP_LT: case OpCode.CMP_GT:
            case OpCode.CMP_LTE: case OpCode.CMP_GTE: this.emitCompare(instr); break;
            case OpCode.LABEL: this.label(`.L_${instr.dest}`); break;
            case OpCode.JMP: this.indent(`jmp     .L_${instr.dest}`); break;
            case OpCode.JMP_IF_FALSE: this.emitJmpIfFalse(instr); break;
            case OpCode.CALL_INFER: this.emitCallInfer(instr); break;
            case OpCode.CALL_REMOTE: this.emitCallRemote(instr); break;
            case OpCode.END_REMOTE:
                this.comment("--- end remote block ---");
                this.indent("call    _aether_end_remote");
                break;
            case OpCode.TENSOR_ADD: case OpCode.TENSOR_SUB:
            case OpCode.TENSOR_MUL: case OpCode.TENSOR_DIV: this.emitTensorOp(instr); break;
        }
    }

    private emitLoadConst(instr: Instruction) {
        if (instr.extra === "float") {
            this.comment(`load float ${instr.floatVal} -> ${instr.dest}`);
            // Float to 64-bit IEEE-754 bit manipulation
            const buffer = new ArrayBuffer(8);
            const floatView = new Float64Array(buffer);
            const intView = new BigInt64Array(buffer);
            floatView[0] = instr.floatVal;
            const bitValue = intView[0].toString();
            
            this.indent(`movabsq $${bitValue}, %rax`);
            this.storeTemp(instr.dest);
        } else {
            this.comment(`load int ${instr.intVal} -> ${instr.dest}`);
            this.indent(`movq    $${instr.intVal}, %rax`);
            this.storeTemp(instr.dest);
        }
    }

    private emitLoadMem(instr: Instruction) {
        const off = instr.intVal;
        this.comment(`load [RBP-${off}] -> ${instr.dest}`);
        this.indent(`movq    ${this.varMem(off)}, %rax`);
        this.storeTemp(instr.dest);
    }

    private emitStoreMem(instr: Instruction) {
        const off = instr.intVal;
        this.comment(`store ${instr.src1} -> [RBP-${off}]`);
        this.loadTemp(instr.src1, "%rax");
        this.indent(`movq    %rax, ${this.varMem(off)}`);
    }

    private emitArith(instr: Instruction) {
        let opName = "???";
        switch (instr.opcode) {
            case OpCode.ADD: opName = "ADD"; break;
            case OpCode.SUB: opName = "SUB"; break;
            case OpCode.MUL: opName = "MUL"; break;
            case OpCode.DIV: opName = "DIV"; break;
        }
        this.comment(`${opName} ${instr.dest} = ${instr.src1} op ${instr.src2}`);

        this.loadTemp(instr.src1, "%rax");
        this.loadTemp(instr.src2, "%rbx");

        switch (instr.opcode) {
            case OpCode.ADD: this.indent("addq    %rbx, %rax"); break;
            case OpCode.SUB: this.indent("subq    %rbx, %rax"); break;
            case OpCode.MUL: this.indent("imulq   %rbx, %rax"); break;
            case OpCode.DIV:
                this.indent("cqto");
                this.indent("idivq   %rbx");
                break;
        }

        this.storeTemp(instr.dest);
    }

    private emitCompare(instr: Instruction) {
        let setInstr = "sete";
        switch (instr.opcode) {
            case OpCode.CMP_EQ: setInstr = "sete"; break;
            case OpCode.CMP_NEQ: setInstr = "setne"; break;
            case OpCode.CMP_LT: setInstr = "setl"; break;
            case OpCode.CMP_GT: setInstr = "setg"; break;
            case OpCode.CMP_LTE: setInstr = "setle"; break;
            case OpCode.CMP_GTE: setInstr = "setge"; break;
        }

        this.comment(`compare ${instr.src1} vs ${instr.src2} -> ${instr.dest}`);
        this.loadTemp(instr.src1, "%rax");
        this.loadTemp(instr.src2, "%rbx");
        this.indent("cmpq    %rbx, %rax");
        this.indent(`${setInstr}    %al`);
        this.indent("movzbq  %al, %rax");
        this.storeTemp(instr.dest);
    }

    private emitJmpIfFalse(instr: Instruction) {
        this.comment(`if !${instr.src1} goto ${instr.dest}`);
        this.loadTemp(instr.src1, "%rax");
        this.indent("testq   %rax, %rax");
        this.indent(`je      .L_${instr.dest}`);
    }

    private emitCallInfer(instr: Instruction) {
        this.comment(`infer: ${instr.dest} = _aether_infer(${instr.src1}, "${instr.extra}")`);

        const srcOff = this.parseRBPOffset(instr.src1);
        this.indent(`leaq    ${this.varMem(srcOff)}, %rdi`);

        const strLabel = this.stringLabels.get(instr.extra)!;
        this.indent(`leaq    ${strLabel}(%rip), %rsi`);

        this.indent("call    _aether_infer");
        this.storeTemp(instr.dest);
    }

    private emitCallRemote(instr: Instruction) {
        this.comment(`remote: dispatch to "${instr.extra}"`);

        const strLabel = this.stringLabels.get(instr.extra)!;
        this.indent(`leaq    ${strLabel}(%rip), %rdi`);
        this.indent("call    _aether_dispatch_remote");
    }

    private emitTensorOp(instr: Instruction) {
        let opName = "???";
        let asmOp = "???";
        switch (instr.opcode) {
            case OpCode.TENSOR_ADD: opName = "TENSOR_ADD"; asmOp = "addl"; break;
            case OpCode.TENSOR_SUB: opName = "TENSOR_SUB"; asmOp = "subl"; break;
            case OpCode.TENSOR_MUL: opName = "TENSOR_MUL"; asmOp = "imull"; break;
            case OpCode.TENSOR_DIV: opName = "TENSOR_DIV"; asmOp = "idivl"; break;
        }

        const destOff = this.parseRBPOffset(instr.dest);
        const src1Off = this.parseRBPOffset(instr.src1);
        const src2Off = this.parseRBPOffset(instr.src2);
        const bytes = instr.intVal;
        const count = bytes / 4;

        this.comment(`${opName} ${instr.dest} = ${instr.src1} op ${instr.src2} (${bytes} bytes, ${count} elements)`);

        const loopLabel = `.Ltensor_${this.tensorLoopCounter++}`;

        this.indent(`leaq    ${this.varMem(destOff)}, %rdi`);
        this.indent(`leaq    ${this.varMem(src1Off)}, %rsi`);
        this.indent(`leaq    ${this.varMem(src2Off)}, %rdx`);
        this.indent(`movq    $${count}, %rcx`);

        this.label(loopLabel);

        if (instr.opcode === OpCode.TENSOR_DIV) {
            this.indent("movl    (%rsi), %eax");
            this.indent("cltd");
            this.indent("idivl   (%rdx)");
            this.indent("movl    %eax, (%rdi)");
        } else {
            this.indent("movl    (%rsi), %eax");
            this.indent(`${asmOp}   (%rdx), %eax`);
            this.indent("movl    %eax, (%rdi)");
        }

        this.indent("addq    $4, %rdi");
        this.indent("addq    $4, %rsi");
        this.indent("addq    $4, %rdx");
        this.indent("decq    %rcx");
        this.indent(`jnz     ${loopLabel}`);
    }

    private escapeString(s: string): string {
        return s.replace(/\\/g, "\\\\")
                .replace(/"/g, "\\\"")
                .replace(/\n/g, "\\n")
                .replace(/\t/g, "\\t");
    }
}
