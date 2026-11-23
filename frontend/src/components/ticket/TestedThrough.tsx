import React from 'react';
import { FlaskConical } from 'lucide-react';

/** "Tested through QRD-n": a BE ticket whose QA follows the FE ticket of its Jira "Test" link. Nothing when it has none. */
export const TestedThroughChip: React.FC<{ keys?: string[] | null }> = ({ keys }) => (keys?.length ? (
  <span className="inline-flex w-fit items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold text-secondary-foreground" title="QA tests this BE ticket through its FE ticket">
    <FlaskConical size={11} aria-hidden="true" />Tested through {keys.join(', ')}
  </span>
) : null);
