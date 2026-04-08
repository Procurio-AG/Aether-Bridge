# ============================================================================
# Aether-Lang — C++ Backend Build System
# ============================================================================
# Usage:
#   make          — build the backend
#   make run      — build + run against output/bridge.json
#   make clean    — remove build artifacts
# ============================================================================

# ============================================================================

CXX       := g++
WASM_CXX  := emcc
CXXFLAGS  := -std=c++17 -Wall -Wextra -O2
INCLUDES  := -Iinclude

SRC       := src/main.cpp
WASM_SRC  := src/wasm_wrapper.cpp
TARGET    := aether_backend
WASM_OUT  := ../../visualizer/public/wasm_wrapper.js

BRIDGE    := ../../output/bridge.json
OUT_DIR   := ../../output

.PHONY: all run clean wasm

all: $(TARGET)

$(TARGET): $(SRC) include/ast_node.h include/ir_instruction.h include/ir_generator.h include/optimizer.h include/emitter.h
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $(SRC)
	@echo "  Built: $(TARGET)"

wasm: $(WASM_SRC) include/ast_node.h include/ir_instruction.h include/ir_generator.h include/optimizer.h include/emitter.h
	$(WASM_CXX) $(CXXFLAGS) $(INCLUDES) --bind \
		-s MODULARIZE=1 -s EXPORT_ES6=1 -s ALLOW_MEMORY_GROWTH=1 \
		-O3 -o $(WASM_OUT) $(WASM_SRC)
	@echo "  Built WASM artifacts in: ../../visualizer/public/"

run: $(TARGET)
	@echo ""
	./$(TARGET) $(BRIDGE)

clean:
	rm -f $(TARGET)
	rm -f ../../visualizer/public/wasm_wrapper.js ../../visualizer/public/wasm_wrapper.wasm
	@echo "  Cleaned."

