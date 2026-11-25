import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from './ui';
import { cn } from '../lib/cn';
import { githubQuotaText, type GitHubQuota } from '../lib/githubQuota';

export const GitHubQuotaBadge: React.FC<{ quota?: GitHubQuota | null; className?: string }> = ({ quota, className }) => {
  const text = githubQuotaText(quota);
  if (!text) return null;
  return (
    <Badge role="status" variant={quota?.limited ? 'danger' : 'warn'} className={cn('gap-1.5 whitespace-normal text-pretty text-[0.68rem]', className)}>
      <AlertTriangle size={12} className="flex-none" aria-hidden="true" />
      {text}
    </Badge>
  );
};
