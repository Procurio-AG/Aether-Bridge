# Aether-Lang Visualizer: Design System & Technical Spec

This document defines the **Celestial Terminal** design system and the technical communication protocols for the Aether-Lang compiler pipeline. It serves as the primary context for Google Stitch UI generation and improvement.

---

## 1. Design Philosophy: "Celestial Terminal"

**Objective**: Create a premium, IDE-like experience that feels high-fidelity, professional, and "alive."

### Visual Tokens
- **Surface Palette**: 
  - `Base`: `#0f131c` (Deep Space)
  - `Surface-Dim`: `#1c1f29` (Low-contrast glass)
  - `Accent-Glow`: `rgba(129, 140, 248, 0.25)` (Ambient indigo)
- **Typography Pairing**:
  - **Display**: `Space Grotesk` (700-wght) for headers, stage titles, and primary labels.
  - **Body**: `Inter` (400, 500) for UI controls, property lists, and diagnostics.
  - **Code**: `JetBrains Mono` for source code, TAC, and Assembly outputs.
- **Surface Treatments**:
  - **Borderless High-Fidelity**: Use `backdrop-filter: blur(12px)` and `border: 1px solid rgba(255,255,255,0.03)` instead of thick borders.
  - **Ambient Bloom**: Subtle outer glows on active panels to indicate focus.
  - **Bento Grid**: A structured but airy layout using varied panel sizes.

---

## 2. Compiler Pipeline Specification

The visualizer follows a 6-stage pipeline split across a TypeScript Frontend and a C++/WASM Backend.

### Stage 1: Lexical Analyzer (Frontend)
- **Input**: `string` (UTF-8 Source Code).
- **Output**: `Token[]` JSON array.
- **Web Rendering**: High-density Token List with metadata (Type, Lexeme, Location).

### Stage 2: Syntax Analyzer (Frontend)
- **Input**: `Token[]`.
- **Output**: `ProgramNode` (Raw Abstract Syntax Tree).
- **Web Rendering**: Hierarchical Tree Graph (ReactFlow) showing child pointers.

### Stage 3: Semantic Analyzer (Frontend)
- **Input**: `ProgramNode` (Raw AST).
- **Output**: `ProgramNode` (Augmented AST). 
  - *Attributes Added*: `resolvedType`, `isConstant`, `isLValue`.
- **Web Rendering**: Augmented Tree Graph with type-badges (e.g., `INT`, `FLOAT`).

### Stage 4: Intermediate Code Generator (Backend)
- **Input (via WASM Bridge)**: `ProgramNode` (Augmented).
- **Output**: `string` (Three-Address Code).
- **Web Rendering**: Syntax-highlighted monospaced code block.

### Stage 5: Optimized IR (Backend)
- **Input**: `Raw TAC string`.
- **Output**: `Optimized TAC string` + `OptStats` (Object).
- **Web Rendering**: Dual-panel view or highlighted difference view showing Constant Folding and DCE results.

### Stage 6: Assembly Code (Backend)
- **Input**: `Optimized TAC string`.
- **Output**: `string` (x86-64 NASM Assembly).
- **Web Rendering**: Final executable assembly listing with address offsets.

---

## 3. WASM Backend Bridge Protocol

The Frontend communicates with the C++ Backend via a single JSON-encoded string bridge.

### Outgoing Payload (Web -> Backend)
```json
{
  "_gate": { "proceed": true },
  "_stats": { "totalFrameSize": 64 },
  "ast": { ...analyzedAstContent... }
}
```

### Incoming Response (Backend -> Web)
```json
{
  "rawTac": "...",
  "optTac": "...",
  "asm": "...",
  "optStats": {
    "constantsFolded": 5,
    "deadCodeRemoved": 2
  },
  "error": null || "string message"
}
```

---

## 4. UI Rendering Components

| Component | Target Stage | Visual Requirement |
| :--- | :--- | :--- |
| **Monaco Editor** | Input / Assembly | Transparent background, custom 'Celestial' theme. |
| **ReactFlow** | AST / Analyzed AST | Custom 'Borderless' nodes, 'Ambient' connection lines. |
| **Diagnostic Log** | System Feedback | Semantic priority (Error: Red-Glow, Success: Primary-Dim). |
| **Stage Navigator** | Pipeline Control | Pill-shaped navigation with micro-animations on active index. |
