// ============================================================================
// Aether-Lang — WebAssembly Wrapper
// ============================================================================
// This file serves as the safe bridge between the React visualizer and the
// C++ backend metrics. It uses Emscripten's Embind for safer string handling.
// ============================================================================

#include <string>
#include <emscripten/bind.h>

#include "ast_node.h"
#include "ir_instruction.h"
#include "ir_generator.h"
#include "optimizer.h"
#include "emitter.h"

using namespace emscripten;

/**
 * Main compilation entry point for the browser.
 * Accepts a JSON serialized AST from the TypeScript frontend and returns
 * a serialized JSON result containing assembly and formatted IR.
 */
std::string aether_compile(std::string bridge_json_str) {
    try {
        // 1. Parse JSON string using nlohmann/json
        aether::json bridge = aether::json::parse(bridge_json_str);

        // 2. Reconstruct AST
        // Uses the existing logic that handles '_gate' and memory offsets.
        aether::Program program = aether::parseBridgeAST(bridge);

        // 3. Stage 4: IR Generation (Three-Address Code)
        aether::IRGenerator generator;
        auto rawTAC = generator.generate(program);

        // 4. Stage 5: Optimization
        aether::Optimizer optimizer;
        auto optTAC = optimizer.optimize(rawTAC);

        // 5. Stage 6: x86-64 Assembly Emission
        aether::X86Emitter emitter;
        std::string asmOutput = emitter.emit(optTAC);

        // 6. Package Results into JSON
        aether::json result;
        result["asm"]      = asmOutput;
        result["rawTac"]   = aether::formatTAC(rawTAC, "RAW TAC");
        result["optTac"]   = aether::formatTAC(optTAC, "OPTIMIZED TAC");
        result["optStats"] = {
            {"constantsFolded", optimizer.stats().constantsFolded},
            {"deadCodeRemoved", optimizer.stats().deadCodeRemoved}
        };
        result["success"]  = true;

        return result.dump();
    } catch (const std::exception& e) {
        // Capture any backend failures (JSON parse errors, unreachable nodes, etc.)
        aether::json errorResult;
        errorResult["success"] = false;
        errorResult["error"]   = e.what();
        return errorResult.dump();
    }
}

// Emscripten Binding Registration
EMSCRIPTEN_BINDINGS(aether_module) {
    function("compile_to_asm", &aether_compile);
}
