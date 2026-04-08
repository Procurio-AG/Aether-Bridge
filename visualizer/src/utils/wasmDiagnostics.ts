/**
 * WASM Diagnostic Suite for Aether-Lang
 * Designed to pinpoint initialization failures in a Vite/React environment.
 */

export async function runWasmDiagnostics() {
    console.log("------- WASM DIAGNOSTIC START -------");
    
    const JS_PATH = '/wasm_wrapper.js';
    const WASM_PATH = '/wasm_wrapper.wasm';

    // 1. Check Asset Availability
    try {
        console.log(`[Diagnostic] Attempting to fetch JS glue code from ${JS_PATH}...`);
        const jsResponse = await fetch(JS_PATH);
        console.log(`[Status] JS Fetch: ${jsResponse.status} ${jsResponse.statusText}`);
        console.log(`[Status] JS Content-Type: ${jsResponse.headers.get('Content-Type')}`);
        
        console.log(`[Diagnostic] Attempting to fetch binary WASM from ${WASM_PATH}...`);
        const wasmResponse = await fetch(WASM_PATH);
        console.log(`[Status] WASM Fetch: ${wasmResponse.status} ${wasmResponse.statusText}`);
        console.log(`[Status] WASM Content-Type: ${wasmResponse.headers.get('Content-Type')}`);
    } catch (e) {
        console.error("[Fail] Network/Fetch error during asset probe:", e);
    }

    // 2. Attempt Module Import
    let initModule: any;
    try {
        console.log("[Diagnostic] Attempting dynamic import of glue code...");
        // @vite-ignore is used because Vite cannot statically analyze strings for public assets
        const module = await import(/* @vite-ignore */ JS_PATH);
        initModule = module.default;
        console.log("[Success] Glue code imported. Type of default export:", typeof initModule);
        
        if (typeof initModule !== 'function') {
           console.warn("[Warning] Expected default export to be a function (Emscripten MODULARIZE). Found:", typeof initModule);
        }
    } catch (e: any) {
        console.error("[Fail] Import stage failed:", e);
        console.error("[Stack] ", e.stack);
        return;
    }

    // 3. Attempt Emscripten Initialization
    try {
        console.log("[Diagnostic] Calling initialization function with print overrides...");
        const instance = await initModule({
            print: (text: string) => console.log(`[WASM STDOUT] ${text}`),
            printErr: (text: string) => console.error(`[WASM STDERR] ${text}`),
            // Explicitly hint where the WASM file is if the glue logic defaults fail
            locateFile: (path: string) => {
                console.log(`[Diagnostic] Glue code requested file: ${path}`);
                if (path.endsWith('.wasm')) {
                    console.log(`[Diagnostic] Mapping ${path} -> ${WASM_PATH}`);
                    return WASM_PATH;
                }
                return path;
            }
        });

        console.log("[Success] WASM Instance created and initialized.");
        console.log("[Diagnostic] Checking for 'compile_to_asm' export...");
        
        if (instance.compile_to_asm) {
            console.log("[Success] 'compile_to_asm' is present and callable.");
            return instance;
        } else {
            console.error("[Fail] 'compile_to_asm' not found in instance. Available keys:", Object.keys(instance));
        }
    } catch (e: any) {
        console.error("[Fail] Initialization stage crashed:", e);
        console.error("[Stack] ", e.stack);
    }

    console.log("------- WASM DIAGNOSTIC END -------");
}
