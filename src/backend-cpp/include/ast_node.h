// ============================================================================
// Aether-Lang — C++ AST Node Definitions
// ============================================================================
// Reconstructs the AST from bridge.json using nlohmann/json.
// These structs mirror the TypeScript frontend's AST nodes.
// The Symbol Table is NOT rebuilt — we trust the _offset metadata.
// ============================================================================

#pragma once

#include <string>
#include <vector>
#include <memory>
#include <variant>
#include <nlohmann/json.hpp>

namespace aether {

using json = nlohmann::json;

// ── Source Range ────────────────────────────────────────────────────────────
struct SourceRange {
    int line   = 0;
    int column = 0;
};

// ── Memory Metadata (Stage 3 output) ───────────────────────────────────────
struct MemoryMeta {
    int offset    = 0;   // Stack offset in bytes from base pointer
    int byteSize  = 0;   // Total byte size
    int scope     = 0;   // Lexical scope depth
};

// ── Forward declarations ───────────────────────────────────────────────────
struct Expression;
struct Statement;

using ExprPtr = std::shared_ptr<Expression>;
using StmtPtr = std::shared_ptr<Statement>;

// ── Type Nodes ─────────────────────────────────────────────────────────────

struct SimpleType {
    std::string name;  // "int" or "float"
};

struct TensorType {
    std::string baseType;         // "f32" or "i32"
    std::vector<int> dimensions;  // e.g. {784, 256}
};

using TypeNode = std::variant<SimpleType, TensorType>;

// ── Expression Nodes ───────────────────────────────────────────────────────

struct IntLiteral    { int value;         SourceRange range; };
struct FloatLiteral  { double value;      SourceRange range; };
struct Identifier    { std::string name;  SourceRange range; };

struct BinaryExpr {
    std::string op;  // "+", "-", "*", "/"
    ExprPtr left;
    ExprPtr right;
    SourceRange range;
};

struct ComparisonExpr {
    std::string op;  // "==", "!=", "<", ">", "<=", ">="
    ExprPtr left;
    ExprPtr right;
    SourceRange range;
};

struct ParenExpr {
    ExprPtr expr;
    SourceRange range;
};

struct Expression {
    std::string type;
    // Payload — only one is valid, determined by `type`
    IntLiteral    intLit;
    FloatLiteral  floatLit;
    Identifier    ident;
    BinaryExpr    binExpr;
    ComparisonExpr cmpExpr;
    ParenExpr     parenExpr;
};

// ── Statement Nodes ────────────────────────────────────────────────────────

struct VarDecl {
    std::string name;
    TypeNode    varType;
    ExprPtr     init;       // nullptr if no initialiser
    MemoryMeta  meta;
    SourceRange range;
};

struct Assignment {
    std::string name;
    ExprPtr     value;
    SourceRange range;
};

struct AiCall {
    std::string target;
    std::string source;
    std::string modelRef;
    SourceRange range;
};

struct CloudBlock {
    std::string ipAddress;
    std::vector<StmtPtr> body;
    SourceRange range;
};

struct IfStatement {
    ExprPtr condition;
    std::vector<StmtPtr> consequent;
    std::vector<StmtPtr> alternate;  // empty if no else
    SourceRange range;
};

struct Statement {
    std::string type;
    VarDecl     varDecl;
    Assignment  assignment;
    AiCall      aiCall;
    CloudBlock  cloudBlock;
    IfStatement ifStmt;
};

// ── Program (root) ─────────────────────────────────────────────────────────

struct Program {
    std::vector<StmtPtr> body;
    SourceRange range;
    int totalFrameSize = 0;
};

// ── Bridge Metadata ────────────────────────────────────────────────────────

struct BridgeGate {
    int  lexErrors       = 0;
    int  parseErrors     = 0;
    int  analyzerErrors  = 0;
    int  totalErrors     = 0;
    bool proceed         = false;
};

// ============================================================================
//  JSON → AST Parsing
// ============================================================================

inline SourceRange parseRange(const json& j) {
    SourceRange r;
    if (j.contains("range")) {
        r.line   = j["range"].value("line", 0);
        r.column = j["range"].value("column", 0);
    }
    return r;
}

inline MemoryMeta parseMeta(const json& j) {
    MemoryMeta m;
    if (j.contains("meta")) {
        const auto& meta = j["meta"];
        m.offset   = meta.value("_offset", 0);
        m.byteSize = meta.value("_byteSize", 0);
        m.scope    = meta.value("_scope", 0);
    }
    return m;
}

inline TypeNode parseTypeNode(const json& j) {
    std::string t = j.value("type", "");
    if (t == "TensorType") {
        TensorType tt;
        tt.baseType = j.value("baseType", "f32");
        if (j.contains("dimensions")) {
            for (const auto& d : j["dimensions"]) {
                tt.dimensions.push_back(d.get<int>());
            }
        }
        return tt;
    }
    SimpleType st;
    st.name = j.value("name", "int");
    return st;
}

// Forward declaration
inline ExprPtr parseExpression(const json& j);

inline ExprPtr parseExpression(const json& j) {
    if (j.is_null()) return nullptr;

    auto expr = std::make_shared<Expression>();
    expr->type = j.value("type", "");

    if (expr->type == "IntLiteral") {
        expr->intLit.value = j.value("value", 0);
        expr->intLit.range = parseRange(j);
    }
    else if (expr->type == "FloatLiteral") {
        expr->floatLit.value = j.value("value", 0.0);
        expr->floatLit.range = parseRange(j);
    }
    else if (expr->type == "Identifier") {
        expr->ident.name  = j.value("name", "");
        expr->ident.range = parseRange(j);
    }
    else if (expr->type == "BinaryExpr") {
        expr->binExpr.op    = j.value("operator", "+");
        expr->binExpr.left  = parseExpression(j["left"]);
        expr->binExpr.right = parseExpression(j["right"]);
        expr->binExpr.range = parseRange(j);
    }
    else if (expr->type == "ComparisonExpr") {
        expr->cmpExpr.op    = j.value("operator", "==");
        expr->cmpExpr.left  = parseExpression(j["left"]);
        expr->cmpExpr.right = parseExpression(j["right"]);
        expr->cmpExpr.range = parseRange(j);
    }
    else if (expr->type == "ParenExpr") {
        expr->parenExpr.expr  = parseExpression(j["expr"]);
        expr->parenExpr.range = parseRange(j);
    }

    return expr;
}

// Forward declaration
inline StmtPtr parseStatement(const json& j);

inline std::vector<StmtPtr> parseStatements(const json& arr) {
    std::vector<StmtPtr> stmts;
    for (const auto& s : arr) {
        stmts.push_back(parseStatement(s));
    }
    return stmts;
}

inline StmtPtr parseStatement(const json& j) {
    auto stmt = std::make_shared<Statement>();
    stmt->type = j.value("type", "");

    if (stmt->type == "VarDecl") {
        stmt->varDecl.name    = j.value("name", "");
        stmt->varDecl.varType = parseTypeNode(j["varType"]);
        stmt->varDecl.init    = j.contains("init") && !j["init"].is_null()
                                ? parseExpression(j["init"]) : nullptr;
        stmt->varDecl.meta    = parseMeta(j);
        stmt->varDecl.range   = parseRange(j);
    }
    else if (stmt->type == "Assignment") {
        stmt->assignment.name  = j.value("name", "");
        stmt->assignment.value = parseExpression(j["value"]);
        stmt->assignment.range = parseRange(j);
    }
    else if (stmt->type == "AiCall") {
        stmt->aiCall.target   = j.value("target", "");
        stmt->aiCall.source   = j.value("source", "");
        stmt->aiCall.modelRef = j.value("modelRef", "");
        stmt->aiCall.range    = parseRange(j);
    }
    else if (stmt->type == "CloudBlock") {
        stmt->cloudBlock.ipAddress = j.value("ipAddress", "");
        stmt->cloudBlock.body      = parseStatements(j["body"]);
        stmt->cloudBlock.range     = parseRange(j);
    }
    else if (stmt->type == "IfStatement") {
        stmt->ifStmt.condition  = parseExpression(j["condition"]);
        stmt->ifStmt.consequent = parseStatements(j["consequent"]);
        if (j.contains("alternate") && !j["alternate"].is_null()) {
            stmt->ifStmt.alternate = parseStatements(j["alternate"]);
        }
        stmt->ifStmt.range = parseRange(j);
    }

    return stmt;
}

inline Program parseBridgeAST(const json& bridge) {
    Program prog;

    // Parse gate
    if (bridge.contains("_gate")) {
        const auto& gate = bridge["_gate"];
        if (!gate.value("proceed", false)) {
            throw std::runtime_error("Bridge gate is CLOSED — cannot proceed.");
        }
    }

    // Parse stats
    if (bridge.contains("_stats")) {
        prog.totalFrameSize = bridge["_stats"].value("totalFrameSize", 0);
    }

    // Parse AST
    const auto& ast = bridge["ast"];
    prog.body  = parseStatements(ast["body"]);
    prog.range = parseRange(ast);

    return prog;
}

} // namespace aether
