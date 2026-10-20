import React from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import type { AgentRun } from '../../agents/runs';

/** The parent ticket whose open pull requests this ticket's pull requests are based on, with a link per repo. */
export const StackedOnBadge: React.FC<{ stack: NonNullable<AgentRun['stackedOn']> }> = ({ stack }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 rounded-xs border border-status-draft/30 bg-status-draft-bg px-2 py-0.5 text-status-draft" title="Its pull requests are based on the parent's open ones: the parent merges first">
    <GitBranch size={12} aria-hidden="true" />Stacked on {stack.key}
    {(['be', 'fe'] as const).map((repo) => stack[repo] && (
      <a key={repo} href={stack[repo]!.pr} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold hover:underline" title={stack[repo]!.branch ? `Based on ${stack[repo]!.branch}` : undefined}>
        {repo.toUpperCase()} #{stack[repo]!.pr.split('/').pop()}<ExternalLink size={10} aria-hidden="true" />
      </a>
    ))}
  </span>
);
