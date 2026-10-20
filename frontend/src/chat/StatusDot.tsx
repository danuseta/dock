import React from 'react';
import { cn } from '../lib/cn';
import { DOT_LABEL, type DotState } from './headerState';

const DOT_CLASS: Record<DotState, string> = {
  running: 'bg-status-merged',
  needs: 'bg-amber-300',
  delayed: 'border-2 border-amber-300',
  disconnected: 'bg-status-conflict',
  done: 'bg-muted-foreground',
};

export const StatusDot: React.FC<{ state: DotState; className?: string }> = ({ state, className }) => (
  <span className="inline-flex flex-none" role="img" aria-label={DOT_LABEL[state]} title={DOT_LABEL[state]}>
    <i className={cn('size-2.5 rounded-full', DOT_CLASS[state], className)} aria-hidden="true" />
  </span>
);
