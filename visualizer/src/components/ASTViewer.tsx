import { useEffect, useCallback } from 'react';
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
  
  let typeColor = 'text-primary';
  if (type.includes('Decl')) typeColor = 'text-secondary-fixed';
  else if (type.includes('Expr')) typeColor = 'text-tertiary-fixed';

  return (
    <div className="no-line-card hover:ambient-bloom group overflow-hidden border border-white/[0.03] shadow-lg w-[250px] transition-transform duration-200">
      <Handle type="target" position={Position.Top} className="!bg-primary/40 border-none !w-1 !h-1" />
      
      {/* Header: Node Type */}
      <div className="bg-surface-container-high px-4 py-2 flex items-center justify-between gap-4 border-b border-white/[0.02]">
        <span className="text-[10px] font-display font-bold uppercase tracking-[0.15em] text-on-surface-variant/80 truncate">
          {label}
        </span>
        {type && (
          <span className={`text-[9px] font-display font-black tracking-tighter uppercase shrink-0 ${typeColor}`}>
            {type}
          </span>
        )}
      </div>

      {/* Body: Key-Value Properties (Inter) */}
      <div className="bg-surface-dim p-4 flex flex-col gap-2">
        {Object.entries(properties || {}).length > 0 ? (
          Object.entries(properties).map(([key, val]) => (
            <div key={key} className="flex flex-col gap-0.5">
               <span className="text-[8px] font-display font-bold text-on-surface-variant/40 uppercase tracking-widest">{key}</span>
               <span className="text-[11px] font-body text-primary-dim leading-snug break-all">
                {truncate(String(val), 80)}
               </span>
            </div>
          ))
        ) : (
          <div className="text-[10px] text-on-surface-variant/30 italic font-display uppercase tracking-widest text-center py-2">
            {isObject ? 'Structural Container' : 'No Attributes'}
          </div>
        )}
      </div>

      {isObject && <Handle type="source" position={Position.Bottom} className="!bg-secondary/40 border-none !w-1 !h-1" />}
    </div>
  );
};

const nodeTypes = {
  custom: ASTNodeContent,
};

// -- Main Viewer Content -----------------------------------------------------
interface ASTViewerContentProps {
  ast: any;
  expandToggleSeq: number;
}

function ASTViewerContent({ ast, expandToggleSeq }: ASTViewerContentProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  const updateGraph = useCallback(() => {
    if (!ast) return;
    const { nodes: newNodes, edges: newEdges } = transformAST(ast);
    setNodes(newNodes);
    setEdges(newEdges);
    
    // Slight delay to ensure React Flow has registered the nodes before fitting
    setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 50);
  }, [ast, setNodes, setEdges, fitView]);

  useEffect(() => {
    updateGraph();
  }, [ast, expandToggleSeq, updateGraph]);

  return (
    <div className="w-full h-full celestial-bg relative">
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
        <Background color="rgba(144, 143, 158, 0.05)" gap={24} size={1} />
        <Controls showInteractive={false} className="!bg-[#1c1d2b] !border-white/5 !fill-white/60" />
      </ReactFlow>

      {/* Manual Reset Button HUD */}
      <div className="absolute bottom-6 right-10 z-10">
          <button 
              onClick={() => fitView({ duration: 800 })}
              className="glass-panel px-5 py-2 rounded-full border border-white/5 text-[10px] font-display font-bold text-primary hover:text-primary-container transition-all uppercase tracking-[0.2em] shadow-2xl"
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
