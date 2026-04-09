import { useState, useEffect } from 'react';

interface ASTNodeProps {
    data: any;
    name: string;
    isLast: boolean;
    depth: number;
    defaultExpanded?: boolean;
}

const isObject = (val: any) => val !== null && typeof val === 'object';

const ASTNode = ({ data, name, isLast, depth, defaultExpanded = true }: ASTNodeProps) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
        setExpanded(defaultExpanded);
    }, [defaultExpanded]);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    if (!isObject(data)) {
        // Primitive value styling
        let valColor = 'text-[#93c5fd]'; // default: numbers (Sky Blue)
        if (typeof data === 'string') valColor = 'text-[#c3ecd7]'; // strings (Mint Green)
        else if (typeof data === 'boolean') valColor = 'text-[#fca5a5]'; // booleans (Coral)

        return (
            <div className="flex font-mono text-xs leading-5 hover:bg-white/5 pr-2 rounded group relative">
                {/* Vertical line connector */}
                {depth > 0 && <div className="absolute left-[-14px] top-0 bottom-0 w-[1px] bg-outline-variant/20"></div>}
                {/* Horizontal line connector */}
                {depth > 0 && <div className="absolute left-[-14px] top-[10px] w-2.5 h-[1px] bg-outline-variant/20"></div>}

                <span className="text-[#e9d5ff]/60 font-bold mr-2 select-none">{name}:</span>
                <span className={`${valColor} break-all`}>{JSON.stringify(data)}</span>
                {!isLast && <span className="text-outline-variant opacity-40">,</span>}
            </div>
        );
    }

    const isArray = Array.isArray(data);
    const keys = Object.keys(data).filter(k => k !== 'loc'); // Filter out location data for cleaner tree
    const isEmpty = keys.length === 0;

    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';
    
    // Premium Node Highlighting
    const nodeType = !isArray && data.type ? data.type : '';
    let nodeColor = 'text-primary-dim';
    if (nodeType.includes('Decl')) nodeColor = 'text-secondary-fixed';
    else if (nodeType.includes('Expr')) nodeColor = 'text-tertiary-fixed';
    else if (nodeType === 'Program') nodeColor = 'text-primary font-black';

    return (
        <div className="font-mono text-xs leading-5 relative">
            {/* Vertical branching lines */}
            {depth > 0 && <div className="absolute left-[-14px] top-0 bottom-0 w-[1px] bg-outline-variant/20"></div>}
            {/* Horizontal connection line */}
            {depth > 0 && <div className="absolute left-[-14px] top-[10px] w-2.5 h-[1px] bg-outline-variant/20"></div>}

            <div 
                className="flex items-center cursor-pointer hover:bg-white/10 inline-flex pr-3 rounded transition-all group"
                onClick={handleToggle}
            >
                <div className={`w-4 h-4 flex items-center justify-center mr-1 ${expanded ? 'text-primary' : 'text-outline-variant'}`}>
                    <span className="material-symbols-outlined text-[14px]">
                        {expanded ? 'expand_more' : 'chevron_right'}
                    </span>
                </div>
                {name && <span className="text-[#e9d5ff]/80 font-bold mr-2 select-none">{name}:</span>}
                <span className="text-outline-variant/60">{bracketOpen}</span>
                
                {nodeType && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded bg-white/5 border border-white/5 ${nodeColor} text-[9px] font-black tracking-widest uppercase`}>
                        {nodeType}
                    </span>
                )}

                {!expanded && (
                    <>
                       <span className="text-outline-variant mx-1">...</span>
                       <span className="text-outline-variant/60">{bracketClose}</span>
                       {!isLast && <span className="text-outline-variant opacity-40">,</span>}
                    </>
                )}
            </div>
            
            {expanded && !isEmpty && (
                <div className="pl-5 relative">
                    {/* Recursive children */}
                    {keys.map((key, i) => (
                        <ASTNode 
                            key={key} 
                            name={isArray ? i.toString() : key} 
                            data={data[key as keyof typeof data]} 
                            isLast={i === keys.length - 1} 
                            depth={depth + 1}
                            defaultExpanded={defaultExpanded}
                        />
                    ))}
                </div>
            )}
            
            {expanded && (
                <div className="flex">
                    <span className="text-outline-variant/60">{bracketClose}</span>
                    {!isLast && <span className="text-outline-variant opacity-40">,</span>}
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
    if (!ast) return (
        <div className="h-full flex items-center justify-center opacity-20 italic text-xs">
            No AST structure available.
        </div>
    );
    
    return (
        <div className="p-8 overflow-auto h-full scrollbar-hide select-text">
            <ASTNode 
                key={expandToggleSeq} 
                data={ast} 
                name="Program" 
                isLast={true} 
                depth={0}
                defaultExpanded={isExpanded} 
            />
            {/* Legend or Footer */}
            <div className="mt-8 pt-4 border-t border-white/5 flex gap-4 opacity-40">
                <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-secondary-fixed"></div>
                    <span className="text-[8px] uppercase font-bold tracking-widest">Declarations</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed"></div>
                    <span className="text-[8px] uppercase font-bold tracking-widest">Expressions</span>
                </div>
            </div>
        </div>
    );
}
