import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

const NODE_WIDTH = 250;
const NODE_HEIGHT = 80;

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
    let properties: Record<string, string> = {};

    if (typeof data !== 'object') {
      properties['VALUE'] = String(data);
    } else {
      // For objects, extract prime primitive properties for the 'Perfect Node' view
      Object.entries(data).forEach(([k, v]) => {
        if (k !== 'loc' && k !== 'type' && typeof v !== 'object') {
          properties[k.toUpperCase()] = String(v);
        }
      });
    }

    nodes.push({
      id,
      data: { 
        label, 
        type: nodeType, 
        properties,
        isObject: typeof data === 'object' && data !== null
      },
      position: { x: 0, y: 0 },
      type: 'custom'
    });

    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${id}`,
        source: parentId,
        target: id,
        animated: true,
        style: { stroke: 'rgba(169, 180, 185, 0.3)', strokeWidth: 2 }
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
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(node => {
    const propCount = Object.keys(node.data.properties || {}).length;
    const dynamicHeight = 60 + (propCount * 25);
    // Store height in data for component use if needed, but primarily for dagre
    node.data.height = dynamicHeight;
    g.setNode(node.id, { width: NODE_WIDTH, height: dynamicHeight });
  });

  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  // Apply dagre positions to React Flow nodes
  const layoutedNodes = nodes.map(node => {
    const nodeWithPos = g.node(node.id);
    const nodeHeight = node.data.height;
    return {
      ...node,
      position: {
        x: nodeWithPos.x - NODE_WIDTH / 2,
        y: nodeWithPos.y - nodeHeight / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}
