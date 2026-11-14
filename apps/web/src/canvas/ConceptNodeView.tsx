import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ConceptNode } from '@mindmapper/shared';

export interface ConceptData extends Record<string, unknown> {
  node: ConceptNode;
  selected: boolean;
  onPath: boolean;
  visited: boolean;
  anchor: boolean;
  hidden: number;
  questions: number;
}
export type ConceptFlowNode = Node<ConceptData, 'concept'>;

const STATE_TEXT: Record<ConceptNode['status'], string> = {
  stub: '',
  generating: 'Writing…',
  ready: '',
  error: 'Could not write this',
};

export function ConceptNodeView({ data }: NodeProps<ConceptFlowNode>) {
  const { node, selected, onPath, visited, anchor, hidden, questions } = data;
  const sub = STATE_TEXT[node.status] || node.summary;
  const cls = ['cnode', node.status, selected && 'selected', onPath && 'on-path', !visited && 'unvisited'].filter(Boolean).join(' ');
  const label = [node.title, node.status === 'stub' ? 'not explained yet' : node.status, node.summary].filter(Boolean).join('. ');
  return (
    <div className={cls} role="button" aria-label={label} aria-pressed={selected} title={node.title}>
      <Handle type="target" position={Position.Left} className="hdl" isConnectable={false} />
      <div className="badge">
        {anchor && <span className="anchor" title="Anchor">⚓</span>}
        {questions > 0 && <span title="Questions">{questions}?</span>}
        {hidden > 0 && <span title="Hidden descendants">+{hidden}</span>}
      </div>
      <div className="t" style={{ paddingRight: anchor || questions || hidden ? 34 : 0 }}>
        {node.status === 'error' && '⚠ '}
        {node.title}
      </div>
      {sub && <div className="s">{sub}</div>}
      <Handle type="source" position={Position.Right} className="hdl" isConnectable={false} />
      {/* Cross-links join left side to left side, which draws a clean C-shaped arc between stacked nodes. */}
      <Handle id="xs" type="source" position={Position.Left} className="hdl" isConnectable={false} />
      <Handle id="xt" type="target" position={Position.Left} className="hdl" isConnectable={false} />
    </div>
  );
}
