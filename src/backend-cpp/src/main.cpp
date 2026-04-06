// ============================================================================
// Aether-Lang — C++ Backend Entry Point
// ============================================================================
// Stage 4: JSON Ingestion → AST Reconstruction → IR Generation (TAC)
// Stage 5: Optimization (Constant Folding, DCE, Peephole)
// Stage 6: x86-64 Assembly Emission
//
// Usage:  ./aether_backend <path/to/bridge.json>
// Output: ir_output.txt, output.s
// ============================================================================

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <filesystem>

#include "ast_node.h"
#include "ir_instruction.h"
#include "ir_generator.h"
#include "optimizer.h"
#include "emitter.h"

namespace fs = std::filesystem;

int main(int argc, char* argv[]) {
    // ── Parse arguments ─────────────────────────────────────────────────
    std::string bridgePath = "output/bridge.json";
    if (argc > 1) {
        bridgePath = argv[1];
    }

    std::cout << "\n";
    std::cout << "======================================================================\n";
    std::cout << "  AETHER-LANG C++ BACKEND (Stage 4-6)\n";
    std::cout << "======================================================================\n\n";

    // ── Read bridge.json ────────────────────────────────────────────────
    std::cout << "  [1/6] Reading bridge.json from: " << bridgePath << "\n";

    std::ifstream inFile(bridgePath);
    if (!inFile.is_open()) {
        std::cerr << "  ERROR: Cannot open file: " << bridgePath << "\n";
        return 1;
    }

    std::string jsonStr((std::istreambuf_iterator<char>(inFile)),
                         std::istreambuf_iterator<char>());
    inFile.close();

    std::cout << "  [1/6] Read " << jsonStr.size() << " bytes\n";

    // ── Parse JSON ──────────────────────────────────────────────────────
    std::cout << "  [2/6] Parsing JSON...\n";

    aether::json bridge;
    try {
        bridge = aether::json::parse(jsonStr);
    } catch (const aether::json::parse_error& e) {
        std::cerr << "  ERROR: JSON parse error: " << e.what() << "\n";
        return 1;
    }

    // ── Check gate ──────────────────────────────────────────────────────
    if (bridge.contains("_gate")) {
        bool proceed = bridge["_gate"].value("proceed", false);
        int errors   = bridge["_gate"].value("totalErrors", -1);
        if (!proceed) {
            std::cerr << "  ERROR: Bridge gate is CLOSED (" << errors << " errors). Cannot proceed.\n";
            return 1;
        }
        std::cout << "  [2/6] Gate: OPEN (0 errors)\n";
    }

    // ── Reconstruct AST ─────────────────────────────────────────────────
    std::cout << "  [3/6] Reconstructing AST...\n";

    aether::Program program;
    try {
        program = aether::parseBridgeAST(bridge);
    } catch (const std::exception& e) {
        std::cerr << "  ERROR: AST reconstruction failed: " << e.what() << "\n";
        return 1;
    }

    std::cout << "  [3/6] AST: " << program.body.size() << " top-level statements, "
              << program.totalFrameSize << " bytes stack frame\n";

    // ── Stage 4: IR Generation ──────────────────────────────────────────
    std::cout << "  [4/6] Generating Three-Address Code (TAC)...\n";

    aether::IRGenerator generator;
    auto rawTAC = generator.generate(program);

    std::cout << "  [4/6] Generated " << rawTAC.size() << " instructions\n";

    // ── Stage 5: Optimization ───────────────────────────────────────────
    std::cout << "  [5/6] Optimizing...\n";

    aether::Optimizer optimizer;
    auto optTAC = optimizer.optimize(rawTAC);

    std::cout << "  [5/6] Optimized: " << rawTAC.size() << " -> " << optTAC.size()
              << " instructions\n";

    std::cout << "\n  Optimization Report:\n";
    std::cout << optimizer.stats().summary();

    // ── Stage 6: x86-64 Assembly Emission ───────────────────────────────
    std::cout << "\n  [6/6] Emitting x86-64 assembly...\n";

    aether::X86Emitter emitter;
    std::string asmOutput = emitter.emit(optTAC);

    // ── Write outputs ───────────────────────────────────────────────────
    // Derive output directory from bridge.json location
    std::string outDir = fs::path(bridgePath).parent_path().string();
    if (outDir.empty()) outDir = ".";
    if (!fs::exists(outDir)) fs::create_directories(outDir);

    // Write TAC
    {
        std::string rawOut = aether::formatTAC(rawTAC, "UNOPTIMIZED TAC");
        std::string optOut = aether::formatTAC(optTAC, "OPTIMIZED TAC");
        std::ofstream tacFile(outDir + "/ir_output.txt");
        if (tacFile.is_open()) {
            tacFile << rawOut << "\n" << optOut;
            tacFile.close();
        }
    }

    // Write assembly
    {
        std::string asmPath = outDir + "/output.s";
        std::ofstream asmFile(asmPath);
        if (asmFile.is_open()) {
            asmFile << asmOutput;
            asmFile.close();
            std::cout << "  [6/6] Assembly written to: " << asmPath
                      << " (" << asmOutput.size() << " bytes)\n";
        }
    }

    // ── Print assembly to console ───────────────────────────────────────
    std::cout << "\n";
    std::cout << "======================================================================\n";
    std::cout << "  GENERATED x86-64 ASSEMBLY\n";
    std::cout << "======================================================================\n\n";
    std::cout << asmOutput;
    std::cout << "\n======================================================================\n";
    std::cout << "  BACKEND COMPLETE (Stages 4-6)\n";
    std::cout << "======================================================================\n\n";

    return 0;
}
