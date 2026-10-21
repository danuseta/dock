import React from 'react';
import { Check, Loader2, Lock, Minus, X } from 'lucide-react';
import { cn } from '../../lib/cn';

const TONE: Record<string, string> = {
  running: 'text-secondary-foreground',
  ok: 'text-status-merged',
  error: 'text-status-conflict',
  denied: 'text-amber-200',
  stopped: 'text-muted-foreground',
};

export const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 12 }) => {
  const className = cn('mt-[0.2rem] flex-none', TONE[status] ?? 'text-muted-foreground');
  if (status === 'running') return <Loader2 size={size} className={cn(className, 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />;
  if (status === 'ok') return <Check size={size} className={className} aria-hidden="true" />;
  if (status === 'error') return <X size={size} className={className} aria-hidden="true" />;
  if (status === 'denied') return <Lock size={size} className={className} aria-hidden="true" />;
  return <Minus size={size} className={className} aria-hidden="true" />;
};
