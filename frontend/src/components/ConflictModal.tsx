import React from 'react';
import { AlertTriangle, X, Code } from 'lucide-react';
import { Button, Card, Dialog, IconButton } from './ui';

interface ConflictModalProps { isOpen: boolean; onClose: () => void; message: string }

export const ConflictModal: React.FC<ConflictModalProps> = ({ isOpen, onClose, message }) => {
  return (
    <Dialog open={isOpen} onClose={onClose} labelledBy="conflict-modal-title">
      <Card className="w-[720px] max-w-full border-status-conflict/50 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2"><AlertTriangle size={20} className="text-status-conflict" aria-hidden="true" /><h2 id="conflict-modal-title" className="font-mono text-xl text-status-conflict">Merge Conflict Detected</h2></div>
          <IconButton variant="ghost" className="size-8 rounded-full" onClick={onClose} aria-label="Close merge conflict dialog"><X size={16} aria-hidden="true" /></IconButton>
        </div>
        <p className="mb-4 text-pretty text-sm text-secondary-foreground">The following files have merge conflicts that prevent automatic merging:</p>
        <div className="max-h-[300px] overflow-x-auto rounded-sm border border-border bg-surface-0 p-4 font-mono text-[0.8125rem] leading-relaxed">
          {message || <><div className="font-bold text-status-conflict">CONFLICT (content): Merge conflict in src/services/stripe.ts</div><div className="mt-2 text-muted-foreground">&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD<br /><span className="text-status-open">+ const apiKey = process.env.STRIPE_KEY;</span><br />=======<br /><span className="text-status-conflict">- const apiKey = config.stripe.secretKey;</span><br />&gt;&gt;&gt;&gt;&gt;&gt;&gt; feature/stripe-webhook</div></>}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><span className="font-mono text-sm text-muted-foreground">Run `git merge` locally to resolve</span><div className="flex gap-2"><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={onClose}><Code size={16} aria-hidden="true" />Resolve in IDE</Button></div></div>
      </Card>
    </Dialog>
  );
};
