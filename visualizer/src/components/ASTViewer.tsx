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
const ASTNode = ({ data }: NodeProps) => {
  const { label, type, value, isObject } = data;
  
  let nodeColor = 'border-outline-variant/20';
  let typeColor = 'text-primary-dim';
  
  if (type.includes('Decl')) typeColor = 'text-secondary-fixed';
  else if (type.includes('Expr')) typeColor = 'text-tertiary-fixed';
  else if (type === 'Program') typeColor = 'text-primary font-black';

  return (
    <div className={`px-4 py-2 rounded-lg bg-[#0c0d18] border ${nodeColor} shadow-2xl min-w-[150px] font-mono`}>
      <Handle type="target" position={Position.Top} className="!bg-primary/40 border-none !w-1.5 !h-1.5" />
      
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[9px] uppercase font-bold tracking-widest text-on-surface-variant/60">{label}</span>
          {type && (
            <span className={`text-[8px] font-black tracking-tighter uppercase px-1.5 py-0.5 rounded bg-white/5 ${typeColor}`}>
              {type}
            </span>
          )}
        </div>
        
        {value && (
          <div className="text-[11px] text-[#c3ecd7] font-medium break-all mt-1">
            {value}
          </div>
        )}
      </div>

      {isObject && <Handle type="source" position={Position.Bottom} className="!bg-secondary/40 border-none !w-1.5 !h-1.5" />}
    </div>
  );
};

const nodeTypes = {
  custom: ASTNode,
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
    <div className="w-full h-full bg-[#0c0d18]/40 relative">
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
        <Background color="rgba(255,255,255,0.05)" gap={20} size={1} />
        <Controls showInteractive={false} className="!bg-[#1c1d2b] !border-outline-variant/20 !fill-white/60" />
      </ReactFlow>

      {/* Manual Reset Button HUD */}
      <div className="absolute bottom-6 right-20 z-10">
          <button 
              onClick={() => fitView({ duration: 800 })}
              className="bg-surface-container-highest/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-[10px] font-bold text-primary hover:text-primary-fixed transition-all uppercase tracking-widest shadow-2xl"
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
