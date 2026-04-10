import { useState, useCallback, useEffect } from 'react';
import { SourceEditor } from './components/SourceEditor';
import { compile } from './pipeline';
import { loadAetherWasm } from './pipeline/wasmLoader';
import { ASTViewer } from './components/ASTViewer';

const DEFAULT_CODE = `// Aether-Lang: Integrated Pipeline Demo
let x: int = 10 + 20;
let y: int = x + 5;
let threshold: float = 0.5;

// AI Orchestration Stage
let input: tensor<f32, [1, 784]>;
prediction := infer(input, "mnist_model_v2");

// Remote Execution Stage
remote("10.0.0.101") {
    let cloud_status: int = 200;
    if (x > 15) {
        x = x - 10;
    }
}
`;

type Stage = 'Lexical Analyzer' | 'Syntax Analyzer' | 'Semantic Analyzer' | 'Intermediate Code Generator' | 'Optimized Intermediate Code' | 'Assembly Code';
const STAGES: Stage[] = [
  'Lexical Analyzer', 
  'Syntax Analyzer', 
  'Semantic Analyzer', 
  'Intermediate Code Generator', 
  'Optimized Intermediate Code', 
  'Assembly Code'
];

const STAGE_ICONS: Record<Stage, string> = {
  'Lexical Analyzer': 'code',
  'Syntax Analyzer': 'account_tree',
  'Semantic Analyzer': 'schema',
  'Intermediate Code Generator': 'terminal',
  'Optimized Intermediate Code': 'auto_awesome',
  'Assembly Code': 'memory'
};

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  const [lastResult, setLastResult] = useState<any>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [astExpandToggle, setAstExpandToggle] = useState<number>(0);
  const [astIsExpanded, setAstIsExpanded] = useState<boolean>(true);
  
  // Resizing state
  const [logsHeight, setLogsHeight] = useState(140);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const onResize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newHeight = window.innerHeight - e.clientY - 48; // accounting for padding/navbar
      setLogsHeight(Math.max(80, Math.min(newHeight, window.innerHeight * 0.6)));
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', onResize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', onResize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', onResize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, onResize, stopResizing]);

  const [wasmInstance, setWasmInstance] = useState<any>(null);
  const [isWasmLoading, setIsWasmLoading] = useState(true);

  useEffect(() => {
    loadAetherWasm()
      .then((instance: any) => {
        setWasmInstance(instance);
        setIsWasmLoading(false);
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] SUCCESS: Aether-Lang WASM Backend initialized.`]);
      })
      .catch((err: any) => {
        setIsWasmLoading(false);
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ERROR: Failed to load WASM backend: ${err.message}`]);
      });
  }, []);

  const activeStage = STAGES[activeStageIdx];

  const handleCompile = useCallback(async () => {
    if (!wasmInstance) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ERROR: WASM backend is not ready.`]);
      return;
    }

    setIsCompiling(true);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] INFO: Starting compilation pipeline...`]);
    
    try {
      // Stage 1-3: Lexing, Parsing, Semantic (Frontend)
      const res = compile(code);
      const nextResult: any = { ...res };
      
      if (res.gateOpen) {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] INFO: Frontend stages succeeded. Invoking WASM backend...`]);
        
        // Prepare payload for WASM
        const payload = JSON.stringify({
          _gate: { proceed: true },
          _stats: { totalFrameSize: res.totalFrameSize },
          ast: res.analyzedAst
        });

        console.log("[WASM_DEBUG] OUTGOING Payload:", payload);

        // Invoke C++ Backend via WASM
        const responseJson = wasmInstance.compile_to_asm(payload);
        console.log("[WASM_DEBUG] RAW Response String:", responseJson);

        const response = JSON.parse(responseJson);
        console.log("[WASM_DEBUG] PARSED Response Object:", response);

        if (response.error) {
          throw new Error(`C++ Backend Error: ${response.error}`);
        }

        // Map results from WASM back to UI
        nextResult.rawAst = res.rawAst;
        nextResult.analyzedAst = res.analyzedAst;
        nextResult.rawTac = response.rawTac;
        nextResult.optTac = response.optTac;
        nextResult.asm = response.asm;
        
        if (response.optStats) {
            nextResult.optStats = response.optStats;
            setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] DEBUG: C++ Optimizer: CF:${response.optStats.constantsFolded}, DCE:${response.optStats.deadCodeRemoved}`]);
        }

        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] SUCCESS: Full AST-to-Assembly pipeline completed in Wasm.`]);
        setLastResult(nextResult);
        setActiveStageIdx(5); // Auto-jump to Assembly Code
      } else {
        // Handle Frontend failure
        const hasLexErrors = res.bag.diagnostics.some(d => d.message.toLowerCase().includes("token") || d.message.toLowerCase().includes("illegal"));
        const hasParseErrors = res.bag.diagnostics.some(d => d.message.toLowerCase().includes("expected") || d.message.toLowerCase().includes("syntax"));
        
        let failIdx = 2; // Default to Semantic
        if (hasLexErrors) failIdx = 0;
        else if (hasParseErrors) failIdx = 1;

        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ERROR: Compilation halted at stage ${STAGES[failIdx]}.`]);
        setLastResult(nextResult);
        setActiveStageIdx(failIdx);
      }
    } catch (err: any) {
      setLastResult({
        error: err.message,
        bag: { hasErrors: true, diagnostics: [{ line: 0, message: `CRITICAL: ${err.message}` }] }
      });
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`]);
    } finally {
      setIsCompiling(false);
    }
  }, [code, wasmInstance]);

  const renderActiveStageData = () => {
    if (!lastResult) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant font-mono">
            <p>Ready to compile.</p>
        </div>
      );
    }

    const stageHasError = lastResult.bag?.hasErrors && (
        (activeStage === 'Lexical Analyzer' && lastResult.bag.diagnostics.some((d:any) => d.message.toLowerCase().includes("token") || d.message.toLowerCase().includes("illegal"))) ||
        (activeStage === 'Syntax Analyzer' && lastResult.bag.diagnostics.some((d:any) => d.message.toLowerCase().includes("expected") || d.message.toLowerCase().includes("syntax"))) ||
        (activeStage === 'Semantic Analyzer' && !lastResult.gateOpen)
    );

    const errorBanner = stageHasError ? (
        <div className="bg-error/10 border-b border-error/20 p-4 mb-2 flex items-start gap-4">
            <span className="material-symbols-outlined text-error text-xl">report</span>
            <div className="flex-1">
                <p className="text-error font-bold text-xs uppercase tracking-widest">Stage Error detected</p>
                <p className="text-on-surface-variant text-[10px] opacity-80">The backend development was halted. See diagnostics for details.</p>
            </div>
        </div>
    ) : null;

    if (!lastResult.gateOpen && activeStageIdx > 2) {
       return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-error font-mono p-8 text-center">
            <span className="material-symbols-outlined text-4xl mb-2">cancel</span>
            <p className="font-bold">Backend Halted</p>
            <p className="text-xs opacity-60">Please fix Front-end errors to view {activeStage}.</p>
        </div>
       )
    }

    switch (activeStage) {
      case 'Lexical Analyzer':
        return (
          <div className="absolute inset-0 flex flex-col font-mono text-sm overflow-hidden text-primary-dim">
             {errorBanner}
             <div className="flex-1 overflow-auto p-6 scrollbar-hide">
                 {lastResult.tokens?.map((t: any, i: number) => (
                    <div key={i} className="flex gap-4 hover:bg-surface-container-highest/40 p-1.5 rounded transition-colors group">
                        <span className="text-outline w-12 text-right opacity-60 group-hover:opacity-100 transition-opacity">{t.loc.line}:{t.loc.column}</span>
                        <span className="text-secondary font-bold w-40 text-center">[{t.type}]</span>
                        <span className="text-on-surface group-hover:text-primary transition-colors">"{t.lexeme}"</span>
                    </div>
                 ))}
             </div>
          </div>
        );
      case 'Syntax Analyzer':
        return (
          <div className="absolute inset-0 flex flex-col text-primary-fixed">
             {errorBanner}
             <div className="flex-1 relative overflow-auto">
                <ASTViewer ast={lastResult.rawAst} expandToggleSeq={astExpandToggle} isExpanded={astIsExpanded} />
             </div>
          </div>
        );
      case 'Semantic Analyzer':
        return (
          <div className="absolute inset-0 flex flex-col text-secondary">
             {errorBanner}
             <div className="flex-1 relative overflow-auto">
                <ASTViewer ast={lastResult.analyzedAst} expandToggleSeq={astExpandToggle} isExpanded={astIsExpanded} />
             </div>
          </div>
        );
      case 'Intermediate Code Generator':
        return (
          <div className="absolute inset-0 p-6 font-mono text-sm overflow-auto text-tertiary scrollbar-hide">
             <pre>{lastResult.rawTac}</pre>
          </div>
        );
      case 'Optimized Intermediate Code':
        return (
          <div className="absolute inset-0 flex flex-col font-mono text-sm overflow-hidden text-secondary-fixed">
             <div className="px-6 py-2 bg-surface-container-highest/20 border-b border-outline-variant/10 flex justify-between items-center shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#ab99c0]">Aggressive Constant Folding Results</span>
                {lastResult.optStats && (
                    <span className="text-[9px] opacity-70">
                        Folds: {lastResult.optStats.constantsFolded} | DCE: {lastResult.optStats.deadCodeRemoved}
                    </span>
                )}
             </div>
             <div className="flex-1 p-6 overflow-auto scrollbar-hide">
                <pre>{lastResult.optTac}</pre>
             </div>
          </div>
        );
      case 'Assembly Code':
        return (
          <div className="absolute inset-0 p-6 font-mono text-sm overflow-auto text-on-surface scrollbar-hide">
             <pre>{lastResult.asm}</pre>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="flex min-h-screen w-full font-body bg-surface text-on-surface overflow-x-hidden">
        {/* Navigation Island - Floating Tactile Pill */}
        <header className="fixed top-4 left-1/2 -translate-x-1/2 w-[95%] max-w-[1400px] z-50 pointer-events-none">
            <div className="w-full bg-white/70 backdrop-blur-xl rounded-full clay-card px-8 py-3 flex justify-between items-center pointer-events-auto border border-white/40 shadow-2xl">
                <div className="flex items-center gap-6">
                    <h1 className="text-sm font-black text-primary uppercase tracking-[0.2em]">Tactile Logic Engine</h1>
                    
                    {/* Stage Pills - Tight Horizontal Center */}
                    <div className="hidden md:flex items-center gap-1 p-1 rounded-full bg-[#e7eff4] inner-shadow-recessed ml-8 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05)]">
                        {STAGES.map((stage, idx) => {
                            const isActive = activeStageIdx === idx;
                            const hasCompiledData = lastResult !== null;
                            const disabled = !hasCompiledData && idx > 0;

                            return (
                                <button 
                                    key={stage}
                                    onClick={() => setActiveStageIdx(idx)}
                                    disabled={disabled}
                                    title={stage}
                                    className={`flex items-center justify-center p-2.5 transition-all duration-400 rounded-full shrink-0
                                      ${isActive 
                                        ? 'bg-primary text-white shadow-lg scale-110' 
                                        : 'text-on-surface-variant/40 hover:text-primary'
                                      }
                                      ${disabled ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}
                                    `}
                                >
                                    <span className="material-symbols-outlined text-[18px]">{STAGE_ICONS[stage]}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="hidden lg:flex items-center gap-2 mr-6 text-[10px] uppercase font-bold tracking-widest text-outline-variant">
                        <span>L: {activeStage.split(' ')[0]}</span>
                        <span className="opacity-20">/</span>
                        <span>Arch: x64_86</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-outline-variant hover:text-primary transition-colors cursor-pointer text-xl">settings</span>
                        <span className="material-symbols-outlined text-outline-variant hover:text-primary transition-colors cursor-pointer text-xl">help_outline</span>
                        <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-[10px] font-bold text-primary inner-shadow-clay ml-2">AD</div>
                    </div>
                </div>
            </div>
        </header>

        {/* Floating Compilation FAB */}
        <button 
            onClick={handleCompile}
            disabled={isCompiling || isWasmLoading}
            className="fixed bottom-32 right-12 z-40 bg-primary text-white px-10 py-5 rounded-full clay-card font-bold shadow-2xl hover:scale-110 active:scale-95 transition-all flex items-center gap-4 disabled:opacity-50 cursor-pointer group"
        >
            {isCompiling || isWasmLoading ? (
                <div className="w-5 h-5 rounded-full border-3 border-white/60 border-t-transparent animate-spin"></div>
            ) : <span className="material-symbols-outlined text-2xl font-black group-hover:rotate-12 transition-transform">bolt</span>}
            <span className="tracking-[0.2em] text-sm">{isWasmLoading ? "SYNCING..." : "COMPILE SOURCE"}</span>
        </button>

        {/* Main Canvas - 12-Column Editorial Grid */}
        <main className="flex-1 w-full max-w-[1700px] mx-auto pt-28 pb-32 px-8 flex flex-col gap-8">
            
            <div className="grid grid-cols-12 gap-8 w-full flex-1 min-h-[600px]">
                {/* Source Editor Panel - Left Island */}
                <section className="col-span-12 lg:col-span-6 flex flex-col clay-card bg-white rounded-2xl overflow-hidden ring-1 ring-black/[0.02]">
                    <div className="px-8 py-5 flex items-center justify-between border-b border-black/[0.03] bg-surface-bright/50">
                        <span className="text-[10px] uppercase font-black tracking-[0.25em] text-primary/60">Input Architecture // Main.ae</span>
                        <span className="text-[9px] text-outline-variant font-mono">LEXEND-UTF8</span>
                    </div>
                    <div className="flex-1 relative">
                        <SourceEditor
                          defaultValue={DEFAULT_CODE}
                          onChange={setCode}
                        />
                    </div>
                </section>
                
                {/* Visualization Panel - Right Island */}
                <section className="col-span-12 lg:col-span-6 flex flex-col clay-card bg-white rounded-2xl overflow-hidden ring-1 ring-black/[0.02]">
                    <div className="px-8 py-5 flex items-center justify-between border-b border-black/[0.03] bg-surface-bright/50">
                        <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${lastResult?.error ? 'bg-error' : 'bg-primary opacity-40'}`}></div>
                            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-primary">{activeStage}</span>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setAstIsExpanded(true); setAstExpandToggle(t => t + 1); }} className="p-1.5 rounded-lg bg-surface-container-highest/30 text-primary hover:bg-primary hover:text-white transition-all shadow-sm">
                                <span className="material-symbols-outlined text-lg">unfold_more</span>
                            </button>
                            <button onClick={() => { setAstIsExpanded(false); setAstExpandToggle(t => t + 1); }} className="p-1.5 rounded-lg bg-surface-container-highest/30 text-primary hover:bg-primary hover:text-white transition-all shadow-sm">
                                <span className="material-symbols-outlined text-lg">unfold_less</span>
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 bg-[#f6fafd] relative overflow-hidden">
                        {/* Tactile Data Grid Pattern */}
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4c645b 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
                        {renderActiveStageData()}
                    </div>
                </section>

                {/* Diagnostics Hub - Full Width Footer */}
                <section className="col-span-12 flex flex-col clay-card bg-[#d9e4ea]/30 rounded-2xl overflow-hidden min-h-[160px]">
                    <div className="px-8 py-4 flex items-center justify-between border-b border-black/[0.03]">
                        <div className="flex items-center gap-6">
                            <span className="text-[10px] uppercase tracking-[0.3em] font-black text-primary/40">Diagnostics Pipeline</span>
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${lastResult ? (lastResult.error ? 'bg-error animate-pulse' : 'bg-primary') : 'bg-outline-variant'}`}></span>
                                <span className="text-[9px] font-black uppercase tracking-widest text-primary">
                                    {lastResult ? (lastResult.error ? 'Stopped' : 'Verified') : 'Standby'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-6 text-[9px] font-bold text-outline-variant uppercase tracking-widest">
                            <span>Tokens: {lastResult?.tokens?.length || 0}</span>
                            <span>Memory: {wasmInstance ? 'WASM_INIT' : 'OFFLINE'}</span>
                        </div>
                    </div>
                    <div className="flex-1 p-6 font-mono text-[11px] leading-relaxed overflow-y-auto bg-white/40">
                        {logs.map((log, i) => {
                           let colorClass = "text-on-surface-variant/60";
                           if (log.includes("INFO")) colorClass = "text-[#4c645b]";
                           else if (log.includes("DEBUG")) colorClass = "text-secondary";
                           else if (log.includes("ERROR")) colorClass = "text-error font-bold";
                           
                           return <p key={i} className={`mb-1 ${colorClass}`}>{log}</p>;
                        })}
                        {lastResult?.bag?.diagnostics?.map((diag: any, i: number) => (
                           <p key={`diag-${i}`} className="text-error font-bold ml-4 mb-1">► [L{diag.line}:{diag.column}] {diag.message}</p>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    </div>
  )
}

export default App;
