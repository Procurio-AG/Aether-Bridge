import { useState, useEffect, useRef, useCallback } from 'react';

interface ASTNodeProps {
    data: any;
    name: string;
    depth: number;
    defaultExpanded?: boolean;
}

const isObject = (val: any) => val !== null && typeof val === 'object';

const ASTNode = ({ data, name, depth, defaultExpanded = true }: ASTNodeProps) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
        setExpanded(defaultExpanded);
    }, [defaultExpanded]);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    if (!isObject(data)) {
        // Pure visual primitive (No quotes, no commas)
        let valColor = 'text-[#93c5fd]';
        if (typeof data === 'string') valColor = 'text-[#c3ecd7]';
        else if (typeof data === 'boolean') valColor = 'text-[#fca5a5]';

        return (
            <div className="flex font-mono text-[11px] leading-5 hover:bg-white/5 pr-2 rounded group relative whitespace-nowrap">
                {depth > 0 && <div className="absolute left-[-14px] top-0 bottom-0 w-[1px] bg-outline-variant/10"></div>}
                {depth > 0 && <div className="absolute left-[-14px] top-[10px] w-2.5 h-[1px] bg-outline-variant/10"></div>}

                <span className="text-[#e9d5ff]/40 font-bold mr-2 select-none uppercase text-[9px] tracking-widest">{name}</span>
                <span className={`${valColor} font-medium`}>{String(data)}</span>
            </div>
        );
    }

    const isArray = Array.isArray(data);
    const keys = Object.keys(data).filter(k => k !== 'loc' && k !== 'type'); 
    const isEmpty = keys.length === 0;
    
    const nodeType = !isArray && data.type ? data.type : '';
    let nodeColor = 'text-primary-dim';
    if (nodeType.includes('Decl')) nodeColor = 'text-secondary-fixed';
    else if (nodeType.includes('Expr')) nodeColor = 'text-tertiary-fixed';
    else if (nodeType === 'Program') nodeColor = 'text-primary font-black';

    return (
        <div className="font-mono text-[11px] leading-6 relative">
            {depth > 0 && <div className="absolute left-[-14px] top-0 bottom-0 w-[1px] bg-outline-variant/10"></div>}
            {depth > 0 && <div className="absolute left-[-14px] top-[12px] w-2.5 h-[1px] bg-outline-variant/10"></div>}

            <div 
                className="flex items-center cursor-pointer hover:bg-white/10 inline-flex pr-3 rounded transition-all group select-none"
                onClick={handleToggle}
            >
                <div className={`w-4 h-4 flex items-center justify-center mr-1 ${expanded ? 'text-primary' : 'text-outline-variant'}`}>
                    <span className="material-symbols-outlined text-[14px]">
                        {expanded ? 'expand_more' : 'chevron_right'}
                    </span>
                </div>
                
                {name && <span className="text-[#e9d5ff]/60 font-bold mr-2 uppercase text-[9px] tracking-widest">{name}</span>}
                
                {nodeType && (
                    <span className={`px-2 py-0.5 rounded bg-white/5 border border-white/5 ${nodeColor} text-[10px] font-black tracking-widest uppercase shadow-sm`}>
                        {nodeType}
                    </span>
                )}

                {!expanded && (
                    <span className="text-outline-variant/30 ml-2 italic text-[9px]">collapsed</span>
                )}
            </div>
            
            {expanded && !isEmpty && (
                <div className="pl-5 relative">
                    {keys.map((key) => (
                        <ASTNode 
                            key={key} 
                            name={isArray ? "" : key} 
                            data={data[key as keyof typeof data]} 
                            depth={depth + 1}
                            defaultExpanded={defaultExpanded}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export interface ASTViewerProps {
    ast: any;
    expandToggleSeq: number; 
    isExpanded: boolean;     
}

export function ASTViewer({ ast, expandToggleSeq, isExpanded }: ASTViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 40, y: 40 });
    const [scale, setScale] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = -e.deltaY * 0.001;
            const newScale = Math.min(Math.max(0.1, scale + delta), 3);
            setScale(newScale);
        } else {
            setPos(prev => ({
                x: prev.x - e.deltaX,
                y: prev.y - e.deltaY
            }));
        }
    }, [scale]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) { // Left click
            setIsDragging(true);
            setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setPos({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => setIsDragging(false);

    const resetView = () => {
        setPos({ x: 40, y: 40 });
        setScale(1);
    };

    if (!ast) return (
        <div className="h-full flex items-center justify-center opacity-20 italic text-xs">
            No active AST structure.
        </div>
    );
    
    return (
        <div 
            ref={containerRef}
            className={`w-full h-full bg-[#0c0d18]/40 relative overflow-hidden select-none outline-none
                ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
            `}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            tabIndex={0}
        >
            {/* Grid Pattern Background */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
                 style={{ 
                    backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', 
                    backgroundSize: `${24 * scale}px ${24 * scale}px`,
                    backgroundPosition: `${pos.x}px ${pos.y}px`
                 }} 
            />

            {/* Transform Layer */}
            <div 
                style={{ 
                    transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                    transformOrigin: '0 0'
                }}
                className="absolute transition-transform duration-75 ease-out"
            >
                <ASTNode 
                    key={expandToggleSeq} 
                    data={ast} 
                    name="PROGRAM" 
                    depth={0}
                    defaultExpanded={isExpanded} 
                />
            </div>

            {/* UI Overlays */}
            <div className="absolute bottom-6 right-6 flex items-center gap-3">
                <div className="bg-surface-container-highest/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-4 shadow-2xl">
                    <span className="text-[10px] font-mono text-on-surface-variant font-bold uppercase tracking-tighter">Zoom: {Math.round(scale * 100)}%</span>
                    <div className="w-[1px] h-3 bg-white/10" />
                    <button 
                        onClick={resetView}
                        className="text-[10px] font-bold text-primary hover:text-primary-fixed transition-colors uppercase tracking-widest"
                    >
                        Reset View
                    </button>
                </div>
            </div>

            {/* Zoom Instructions */}
            <div className="absolute top-6 right-6 opacity-30">
                <p className="text-[9px] font-mono uppercase tracking-widest text-right">
                    Ctrl + Scroll to Zoom<br/>Drag to Pan
                </p>
            </div>
        </div>
    );
}
