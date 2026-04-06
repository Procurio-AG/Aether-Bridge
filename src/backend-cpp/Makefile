# ============================================================================
# Aether-Lang — C++ Backend Build System
# ============================================================================
# Usage:
#   make          — build the backend
#   make run      — build + run against output/bridge.json
#   make clean    — remove build artifacts
# ============================================================================

CXX       := g++
CXXFLAGS  := -std=c++17 -Wall -Wextra -O2
INCLUDES  := -Iinclude

SRC       := src/main.cpp
TARGET    := aether_backend
BRIDGE    := ../../output/bridge.json
OUT_DIR   := ../../output

.PHONY: all run clean

all: $(TARGET)

$(TARGET): $(SRC) include/ast_node.h include/ir_instruction.h include/ir_generator.h include/optimizer.h include/emitter.h
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $(SRC)
	@echo "  Built: $(TARGET)"

run: $(TARGET)
	@echo ""
	./$(TARGET) $(BRIDGE)

clean:
	rm -f $(TARGET)
	@echo "  Cleaned."
