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
    <div className="flex h-screen w-full font-body bg-surface text-on-surface overflow-hidden">
        {/* Main Workspace */}
        <main className="flex-1 flex flex-col min-w-0 relative">
            {/* TopAppBar - Now includes Stage Selection */}
            <header className="bg-[#0c0d18] flex flex-col w-full shrink-0 border-b border-outline-variant/10 shadow-2xl z-20">
                <div className="flex justify-between items-center px-8 py-3">
                    <div className="flex items-center gap-6">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#e9d5ff] to-[#ab99c0] font-headline tracking-tighter">Aether</h1>
                        
                        {/* Integrated Stage Selection */}
                        <div className="flex items-center gap-1 py-1 px-1 rounded-full bg-surface-container-highest/20 border border-white/5 ml-4 overflow-x-auto scrollbar-hide max-w-[40vw] sm:max-w-none">
                            {STAGES.map((stage, idx) => {
                                const isActive = activeStageIdx === idx;
                                const hasCompiledData = lastResult !== null;
                                const disabled = !hasCompiledData || (lastResult.error && idx > 0);

                                return (
                                    <button 
                                        key={stage}
                                        onClick={() => setActiveStageIdx(idx)}
                                        disabled={disabled}
                                        className={`flex items-center gap-2 px-3 py-1.5 transition-all duration-150 rounded-full border border-transparent shrink-0
                                          ${isActive 
                                            ? 'bg-[#e9d5ff]/10 text-[#e9d5ff] border-[#e9d5ff]/30 shadow-[0_0_15px_rgba(233,213,255,0.05)]' 
                                            : 'text-on-surface-variant/60 hover:text-[#e9d5ff]'
                                          }
                                          ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                                        `}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">{STAGE_ICONS[stage]}</span>
                                        <span className="font-mono text-[9px] uppercase tracking-tighter font-bold whitespace-nowrap">{stage}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex items-center gap-4 py-1 px-3 rounded-full bg-surface-container-highest/10 border border-white/5 mr-4">
                            <div className="flex items-center gap-2 pr-4 border-r border-white/10">
                                <span className="text-[9px] text-on-surface-variant font-label uppercase tracking-widest font-bold">Arch</span>
                                <span className="text-[10px] font-mono text-secondary-fixed">x86-64</span>
                            </div>
                            <div className="flex items-center gap-2 pl-2">
                                <span className="text-[9px] text-on-surface-variant font-label uppercase tracking-widest font-bold">Stack</span>
                                <span className="text-[10px] font-mono text-primary-fixed">{lastResult?.totalFrameSize ?? 0} B</span>
                            </div>
                        </div>

                        <button 
                            onClick={handleCompile}
                            disabled={isCompiling || isWasmLoading}
                            className="bg-gradient-to-r from-[#e9d5ff] to-[#ab99c0] text-on-primary-container font-bold px-6 py-1.5 rounded-full text-xs shadow-[0_0_30px_rgba(233,213,255,0.15)] hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer active:scale-95"
                        >
                            {isCompiling || isWasmLoading ? (
                                <><div className="w-3.5 h-3.5 rounded-full border-2 border-on-primary-container border-t-transparent animate-spin"></div></>
                            ) : <span className="material-symbols-outlined text-sm">bolt</span>}
                            <span>{isWasmLoading ? "INITIALIZING..." : "COMPILE"}</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Dynamic Content Canvas */}
            <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
                {/* Bento Grid - Upper Section */}
                <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden">
                    
                    {/* Source Editor Panel */}
                    <section className="col-span-12 lg:col-span-6 flex flex-col bg-surface-container-high rounded-xl overflow-hidden shadow-2xl border border-white/5">
                        <div className="px-5 py-3 flex items-center justify-between bg-surface-container-highest/50">
                            <span className="font-label text-[10px] uppercase tracking-wider text-primary">Source: Main.ae</span>
                            <span className="material-symbols-outlined text-on-surface-variant text-sm">edit_note</span>
                        </div>
                        <div className="flex-1 relative bg-[#0c0d18]/50">
                            <SourceEditor
                              defaultValue={DEFAULT_CODE}
                              onChange={setCode}
                            />
                        </div>
                    </section>

                    {/* Visualization Panel */}
                    <section className="col-span-12 lg:col-span-6 bg-surface-container rounded-xl overflow-hidden relative flex flex-col border border-white/5">
                        <div className="px-5 py-3 flex items-center justify-between border-b border-outline-variant/5">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${lastResult?.error ? 'bg-error' : 'bg-secondary'}`}></div>
                                <span className="font-headline font-bold text-sm tracking-tight">{STAGE_ICONS[activeStage].toUpperCase()} - {activeStage.toUpperCase()} VIEW</span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => { setAstIsExpanded(true); setAstExpandToggle(t => t + 1); }} className="p-1.5 rounded bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Expand All AST Branches">
                                    <span className="material-symbols-outlined text-lg">unfold_more</span>
                                </button>
                                <button onClick={() => { setAstIsExpanded(false); setAstExpandToggle(t => t + 1); }} className="p-1.5 rounded bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Collapse All AST Branches">
                                    <span className="material-symbols-outlined text-lg">unfold_less</span>
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex-1 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-surface-container-high/50 via-surface-container to-surface-container relative overflow-hidden">
                            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#464753 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}></div>
                            {renderActiveStageData()}
                        </div>
                    </section>
                </div>

                {/* Resizer Handle */}
                <div 
                    onMouseDown={startResizing}
                    className={`h-1.5 w-full cursor-row-resize transition-colors shrink-0 flex items-center justify-center group
                        ${isResizing ? 'bg-primary' : 'bg-transparent hover:bg-primary/40'}
                    `}
                >
                    <div className="w-12 h-1 rounded-full bg-outline-variant/30 group-hover:bg-primary/60 transition-colors"></div>
                </div>

                {/* Compilation Logs Footer - Now Resizable */}
                <section 
                    style={{ height: `${logsHeight}px` }}
                    className="bg-surface-container-low border-t border-outline-variant/10 flex flex-col overflow-hidden shrink-0 relative"
                >
                    <div className="px-4 py-1.5 flex items-center justify-between bg-surface-container/50 border-b border-outline-variant/5">
                        <div className="flex items-center gap-3">
                            <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Diagnostics & Logs</span>
                            <div className="flex items-center gap-2">
                                <span className={`flex h-1.5 w-1.5 rounded-full ${lastResult ? (lastResult.error ? 'bg-error' : 'bg-secondary') : 'bg-outline-variant'}`}></span>
                                <span className={`text-[9px] font-mono font-bold ${lastResult ? (lastResult.error ? 'text-error' : 'text-secondary') : 'text-outline-variant'}`}>
                                    {lastResult ? (lastResult.error ? 'FAILED' : 'SUCCESS') : 'IDLE'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-[9px] font-mono text-outline-variant">
                            <span className={lastResult?.bag?.hasErrors ? "text-error font-bold" : ""}>ERR: {lastResult?.bag?.hasErrors ? lastResult.bag.diagnostics.length : 0}</span>
                            <span className="material-symbols-outlined text-xs cursor-pointer hover:text-on-surface">filter_list</span>
                        </div>
                    </div>
                    <div className="flex-1 p-3 font-mono text-[10px] leading-relaxed overflow-y-auto bg-surface-container-lowest/20 flex flex-col gap-0.5">
                        {logs.map((log, i) => {
                           let colorClass = "text-on-surface-variant/50";
                           if (log.includes("INFO")) colorClass = "text-secondary";
                           else if (log.includes("DEBUG")) colorClass = "text-primary";
                           else if (log.includes("TRACE")) colorClass = "text-tertiary";
                           else if (log.includes("ERROR")) colorClass = "text-error font-bold";
                           
                           return <p key={i} className={colorClass}>{log}</p>;
                        })}
                        {lastResult?.bag?.diagnostics?.map((diag: any, i: number) => (
                           <p key={`diag-${i}`} className="text-error font-bold ml-3">► [L{diag.line}:{diag.column}] {diag.message}</p>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    </div>
  )
}

export default App;
