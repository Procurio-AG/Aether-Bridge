/**
 * WASM Loader Utility for Aether-Lang
 * Bypasses Vite's interception logic by using Blob URLs for dynamic imports.
 */

export async function loadAetherWasm() {
    const JS_PATH = '/wasm_wrapper.js';
    const WASM_PATH = '/wasm_wrapper.wasm';

    try {
        // 1. Fetch the glue code as text
        const response = await fetch(JS_PATH);
        if (!response.ok) throw new Error(`Failed to fetch WASM glue code: ${response.statusText}`);
        const glueCode = await response.text();

        // 2. Create a Blob URL to bypass Vite's ?import transformation
        const blob = new Blob([glueCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        // 3. Import the module from the Blob URL
        const module = await import(/* @vite-ignore */ blobUrl);
        const initModule = module.default;

        // 4. Initialize the Emscripten module
        const instance = await initModule({
            print: (text: string) => console.log(`[Aether-WASM] ${text}`),
            printErr: (text: string) => console.error(`[Aether-WASM Error] ${text}`),
            locateFile: (path: string) => {
                // Ensure the .wasm file is fetched from the root public directory
                return path.endsWith('.wasm') ? WASM_PATH : path;
            }
        });

        // 5. Cleanup the Blob URL
        URL.revokeObjectURL(blobUrl);

        return instance;
    } catch (error) {
        console.error("Critical failure loading Aether-Lang WASM backend:", error);
        throw error;
    }
}
