import { useState, useEffect } from 'react';

interface ASTNodeProps {
    data: any;
    name: string;
    isLast: boolean;
    defaultExpanded?: boolean;
}

const isObject = (val: any) => val !== null && typeof val === 'object';

const ASTNode = ({ data, name, isLast, defaultExpanded = true }: ASTNodeProps) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
        setExpanded(defaultExpanded);
    }, [defaultExpanded]);

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    if (!isObject(data)) {
        // Primitive value
        let valColor = 'text-[#93c5fd]'; // numbers (Sky Blue)
        if (typeof data === 'string') valColor = 'text-[#c3ecd7]'; // strings (Mint Green)
        else if (typeof data === 'boolean') valColor = 'text-[#fca5a5]'; // booleans (Coral)

        return (
            <div className="flex font-mono text-sm leading-6">
                <span className="text-[#e9d5ff] font-bold mr-2">{name}:</span>
                <span className={valColor}>{JSON.stringify(data)}</span>
                {!isLast && <span className="text-outline-variant">,</span>}
            </div>
        );
    }

    const isArray = Array.isArray(data);
    const keys = Object.keys(data);
    const isEmpty = keys.length === 0;

    if (isEmpty) {
        return (
            <div className="flex font-mono text-sm leading-6">
                <span className="text-[#e9d5ff] font-bold mr-2">{name}:</span>
                <span className="text-outline-variant">{isArray ? '[]' : '{}'}</span>
                {!isLast && <span className="text-outline-variant">,</span>}
            </div>
        );
    }

    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';
    
    // special logic to highlight 'type' field in objects quickly
    const typeLabel = !isArray && data.type ? ` <${data.type}>` : '';

    return (
        <div className="font-mono text-sm leading-6">
            <div 
                className="flex items-center cursor-pointer hover:bg-surface-container-highest/30 inline-flex pr-2 rounded transition-colors"
                onClick={handleToggle}
            >
                <div className="w-4 h-4 flex items-center justify-center mr-1 text-outline-variant">
                    <span className="material-symbols-outlined text-[14px]">
                        {expanded ? 'expand_more' : 'chevron_right'}
                    </span>
                </div>
                {name && <span className="text-[#e9d5ff] font-bold mr-2">{name}:</span>}
                <span className="text-outline-variant">{bracketOpen}</span>
                {!expanded && (
                    <>
                       <span className="text-outline-variant mx-2">...</span>
                       <span className="text-outline-variant">{bracketClose}</span>
                       <span className="text-primary-dim ml-2 text-xs italic opacity-70">{typeLabel}</span>
                       {!isLast && <span className="text-outline-variant">,</span>}
                    </>
                )}
            </div>
            
            {expanded && (
                <div className="pl-6 border-l border-outline-variant/20 ml-2">
                    {keys.map((key, i) => (
                        <ASTNode 
                            key={key} 
                            name={isArray ? '' : key} 
                            data={data[key as keyof typeof data]} 
                            isLast={i === keys.length - 1} 
                            defaultExpanded={defaultExpanded}
                        />
                    ))}
                </div>
            )}
            
            {expanded && (
                <div className="flex">
                    <span className="text-outline-variant">{bracketClose}</span>
                    {!isLast && <span className="text-outline-variant">,</span>}
                </div>
            )}
        </div>
    );
};

export interface ASTViewerProps {
    ast: any;
    expandToggleSeq: number; // Increment to force expand/collapse
    isExpanded: boolean;     // Defines if the toggle sequence meant expand or collapse
}

export function ASTViewer({ ast, expandToggleSeq, isExpanded }: ASTViewerProps) {
    // We use expandToggleSeq as a key so that when the user clicks 'Expand All' or 'Collapse All',
    // the whole tree is forced to remount with the new default expanded state.
    // This is a simple but effective React hack for deep tree state reset.
    
    if (!ast) return null;
    
    return (
        <div className="p-4 overflow-auto h-full scrollbar-hide">
            <ASTNode 
                key={expandToggleSeq} 
                data={ast} 
                name="root" 
                isLast={true} 
                defaultExpanded={isExpanded} 
            />
        </div>
    );
}
