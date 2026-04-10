import { useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  useNodesState, 
  useEdgesState,
  Handle,
  Position,
  NodeProps,
  useReactFlow,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { transformAST } from '../utils/astToGraph';

// -- Custom Node Component ---------------------------------------------------
const truncate = (val: string, len: number) => {
  if (val.length <= len) return val;
  return val.slice(0, len) + '...';
};

const ASTNodeContent = ({ data }: NodeProps) => {
  const { label, type, properties, isObject } = data;
  
  let typeColor = 'text-[#4c645b]';
  if (type.includes('Decl')) typeColor = 'text-[#65597c]';
  else if (type.includes('Expr')) typeColor = 'text-[#50616d]';

  return (
    <div className="group overflow-hidden w-[250px] rounded-[24px] bg-[#d9e4ea] transition-all duration-300 transform-gpu hover:scale-[1.03] shadow-[0_20px_40px_rgba(42,52,57,0.1),inset_4px_4px_8px_rgba(255,255,255,0.6),inset_-4px_-4px_8px_rgba(169,180,185,0.4)] border-none">
      <Handle type="target" position={Position.Top} className="!bg-[#4c645b]/40 border-none !w-1 !h-1" />
      
      {/* Header: Node Type */}
      <div className="px-5 py-3 flex items-center justify-between gap-4 border-b border-[#2a3439]/5 bg-white/10">
        <span className="text-[10px] font-display font-bold uppercase tracking-[0.15em] text-[#2a3439]/70 truncate">
          {label}
        </span>
        {type && (
          <span className={`text-[9px] font-display font-black tracking-tighter uppercase shrink-0 ${typeColor}`}>
            {type}
          </span>
        )}
      </div>

      {/* Body: Key-Value Properties (Inter) */}
      <div className="p-5 flex flex-col gap-2.5">
        {Object.entries(properties || {}).length > 0 ? (
          Object.entries(properties).map(([key, val]) => (
            <div key={key} className="flex flex-col gap-0.5">
               <span className="text-[8px] font-display font-bold text-[#566166]/50 uppercase tracking-widest">{key}</span>
               <span className="text-[11px] font-body text-[#2a3439] leading-snug break-all font-medium">
                {truncate(String(val), 80)}
               </span>
            </div>
          ))
        ) : (
          <div className="text-[10px] text-[#566166]/40 italic font-display uppercase tracking-widest text-center py-2">
            {isObject ? 'Structural Island' : 'Terminal Node'}
          </div>
        )}
      </div>

      {isObject && <Handle type="source" position={Position.Bottom} className="!bg-[#65597c]/40 border-none !w-1 !h-1" />}
    </div>
  );
};

// -- Main Viewer Content -----------------------------------------------------
function ASTViewerContent({ ast, expandToggleSeq }: { ast: any; expandToggleSeq: number }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  // Memoize node types to prevent expensive remounts during pan/zoom
  const nodeTypes = useMemo(() => ({
    custom: ASTNodeContent,
  }), []);

  const updateGraph = useCallback(() => {
    if (!ast) return;
    const { nodes: newNodes, edges: newEdges } = transformAST(ast);
    setNodes(newNodes);
    setEdges(newEdges);
    
    // Smooth transition to new graph
    setTimeout(() => fitView({ duration: 800, padding: 0.1 }), 50);
  }, [ast, setNodes, setEdges, fitView]);

  useEffect(() => {
    updateGraph();
  }, [ast, expandToggleSeq, updateGraph]);

  return (
    <div className="w-full h-full bg-[#f6fafd] relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="scrollbar-hide"
        minZoom={0.1}
        maxZoom={4}
      >
        <Background color="rgba(42, 52, 57, 0.05)" gap={24} size={1} />
        <Controls showInteractive={false} className="!bg-white/80 !border-[#2a3439]/5 !fill-[#2a3439]/60 !shadow-lg rounded-lg overflow-hidden" />
      </ReactFlow>

      {/* Manual Reset Button HUD */}
      <div className="absolute bottom-6 right-10 z-10">
          <button 
              onClick={() => fitView({ duration: 800 })}
              className="bg-white/90 backdrop-blur-md px-6 py-2.5 rounded-full border border-[#2a3439]/5 text-[10px] font-display font-bold text-[#4c645b] hover:text-[#4c645b]/80 hover:scale-105 transition-all uppercase tracking-[0.2em] shadow-xl"
          >
              Reset View
          </button>
      </div>
    </div>
  );
}

// -- Wrapper Component -------------------------------------------------------
export interface ASTViewerProps {
    ast: any;
    expandToggleSeq: number; 
    isExpanded: boolean;     
}

export function ASTViewer({ ast, expandToggleSeq }: ASTViewerProps) {
    if (!ast) return (
        <div className="h-full flex items-center justify-center opacity-20 italic text-xs font-mono tracking-widest">
            NO ACTIVE AST STRUCTURE FOUND
        </div>
    );
    
    return (
        <ReactFlowProvider>
            <ASTViewerContent ast={ast} expandToggleSeq={expandToggleSeq} />
        </ReactFlowProvider>
    );
}
