import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

/**
 * Transforms a nested AST object into a React Flow graph structure.
 * Uses dagre to compute Top-Down (TB) layout.
 */
export function transformAST(ast: any): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let counter = 0;

  function traverse(data: any, name: string, parentId?: string) {
    if (data === null || data === undefined) return;

    const id = `node-${counter++}`;
    const nodeType = !Array.isArray(data) && data.type ? data.type : '';
    
    // Label logic: Property Name + Type or Value
    let label = name || 'PROGRAM';
    let value = '';

    if (typeof data !== 'object') {
      value = String(data);
    }

    nodes.push({
      id,
      data: { 
        label, 
        type: nodeType, 
        value,
        isObject: typeof data === 'object' && data !== null
      },
      position: { x: 0, y: 0 }, // Will be set by dagre
      type: 'custom'
    });

    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${id}`,
        source: parentId,
        target: id,
        animated: true,
        style: { stroke: 'rgba(233, 213, 255, 0.2)' }
      });
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data).filter(k => k !== 'loc' && k !== 'type');
      for (const key of keys) {
        traverse(data[key], Array.isArray(data) ? '' : key, id);
      }
    }
  }

  traverse(ast, 'PROGRAM');

  // Dagre Layout Calculation
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(node => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  // Apply dagre positions to React Flow nodes
  const layoutedNodes = nodes.map(node => {
    const nodeWithPos = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPos.x - NODE_WIDTH / 2,
        y: nodeWithPos.y - NODE_HEIGHT / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}
