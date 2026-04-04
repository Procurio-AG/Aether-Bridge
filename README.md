# Aether-Lang

A system-level Domain-Specific Language (DSL) focused on high-performance AI tensor orchestration and distributed cloud execution.

## 1. The High-Level Abstraction Gap

Modern AI development often relies on heavy frameworks like PyTorch that, while user-friendly, hide the fundamental costs of tensor memory allocation and network latency behind dense runtimes. **Aether-Lang** bridges this gap by introducing a system-level DSL that treats **Tensor Dimensions** and **Remote Procedure Calls (RPC)** as first-class, statically-verified primitives.

By targeting x86-64 assembly, Aether-Lang enables developers to validate hardware-constrained operations at compile-time. This ensures that memory overflows and incompatible network schemas are identified and resolved before any machine code is executed.

---

## 2. Compiler Architecture

Aether-Lang utilizes a distributed, multi-stage hybrid engine designed for safety and efficiency.

### Phase A: TypeScript Frontend (Stages 1-3)
Responsible for rapid lexical analysis, syntax parsing, and rigorous semantic validation.
- **Stage 1 (Lexical Analysis)**: Scans source text with 1-based line/column tracking.
- **Stage 2 (Syntax Analysis)**: Employs a recursive descent parser with "Panic Mode" error recovery to report multiple diagnostics in a single pass.
- **Stage 3 (Semantic Analysis)**: Validates symbol tables, performs tensor shape inference, and injects memory offsets directly into the AST.

**The Conditional Execution Gate**: Control only passes to the backend if the `DiagnosticBag` contains zero errors, enforcing a rigorous "Safety-First" model suited for mission-critical systems.

### Phase B: C++ Backend / WASM (Stages 4-6)
Compiled to WebAssembly (WASM) for industry-standard optimization and assembly generation.
- **Stage 4 (IR Generation)**: Lowers the JSON-serialized AST into Three-Address Code (TAC) without rebuilding symbol tables.
- **Stage 5 (Optimization)**: Performs dead-code elimination and constant folding on tensor operations.
- **Stage 6 (Code Generation)**: Maps optimized IR to x86-64 assembly using Control Flow Graphs (CFGs) for efficient branching.

---

## 3. Project Structure

```text
aether-lang/
|-- docs/                       # Specifications and academic rubrics
|-- samples/                    # Example .aeth programs
|   |-- test_valid.aeth         # Correct AI orchestration code
|   \-- test_invalid.aeth       # Edge cases for error recovery testing
|-- output/                     # Compiler outputs
|   |-- listing.txt             # Interleaved source/error diagnostics
|   \-- target.s                # Generated x86-64 assembly
|-- src/
|   |-- frontend-ts/            # Stage 1-3 (TypeScript)
|   |-- backend-cpp/            # Stage 4-6 (C++ / WASM)
|   \-- visualizer-ui/          # React-based AST inspection tool
|-- package.json                # Project dependencies
\-- tsconfig.json               # TypeScript configuration
```

---

## 4. EBNF Grammar Reference

The Aether-Lang grammar resolves common lexical ambiguities (such as float vs. IP address) while providing Turing-completeness for AI orchestration.

```ebnf
(* Root Structure *)
program         = { statement } ;
statement       = var_decl | assignment | ai_call | cloud_block | if_statement | ";" ;

(* Declarations & AI Orchestration *)
var_decl        = "let" identifier ":" type [ "=" expression ] ";" ;
tensor_type     = "tensor" "<" base_type "," "[" dimension_list "]" ">" ;
ai_call         = identifier ":=" "infer" "(" identifier "," model_ref ")" ";" ;
cloud_block     = "remote" "(" ip_address ")" "{" { statement } "}" ;

(* Control Flow *)
if_statement    = "if" "(" expression ")" "{" { statement } "}" [ "else" "{" { statement } "}" ] ;

(* Math & Lexical Primitives *)
expression      = term { ( "+" | "-" ) term } ;
float           = digit { digit } "." { digit } ;
string_literal  = { letter | digit | "_" | "-" | "." | "/" } ;
```

---

## 5. Getting Started

### Prerequisites
- Node.js (v20+)
- npm
- TypeScript & ts-node

### Installation
```bash
npm install
```

### Running the Lexer Test Suite
```bash
npm run test:lexer
```

---

## 6. License

This project is licensed under the Apache License, version 2.0. See the [LICENSE](LICENSE) file for the full text.
