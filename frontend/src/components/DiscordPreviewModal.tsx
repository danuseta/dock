import React, { useState, useEffect } from 'react';
import { MessageSquare, X, Send, Hash, PlusSquare, Info } from 'lucide-react';
import { Button, Card, Dialog, IconButton, Input, Textarea } from './ui';
import { buildDiscordForumTitle, renderDiscordMessageTemplate } from '../lib/discordTemplate';

interface PullRequestItem { id?: string; title?: string; url?: string; repo?: string; status?: string; type?: string; headBranch?: string; baseBranch?: string }
interface DiscordPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (customMessage: string, threadId?: string, threadName?: string) => Promise<void>;
  ticket: { key: string; title: string; url?: string };
  relatedTickets?: Array<{ key: string; title: string; url?: string }>;
  pullRequests: PullRequestItem[];
  demoUrl?: string;
  messageTemplate?: string;
  loading: boolean;
}

export const DiscordPreviewModal: React.FC<DiscordPreviewModalProps> = ({ isOpen, onClose, onConfirm, ticket, relatedTickets, pullRequests, demoUrl, messageTemplate, loading }) => {
  const [message, setMessage] = useState('');
  const [threadId, setThreadId] = useState('');
  const [threadName, setThreadName] = useState('');
  const [showThreadInfo, setShowThreadInfo] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMessage(renderDiscordMessageTemplate(messageTemplate, { ticket, relatedTickets, pullRequests, demoUrl }));
    setThreadId('');
    setThreadName('');
  }, [isOpen, ticket, relatedTickets, pullRequests, demoUrl, messageTemplate]);

  const handleSubmit = async () => onConfirm(message, threadId.trim() || undefined, threadName.trim() || undefined);

  return (
    <Dialog open={isOpen} onClose={onClose} dismissible={!loading} labelledBy="discord-preview-title">
      <Card className="flex max-h-[calc(100dvh-2rem)] w-[760px] max-w-full flex-col overflow-y-auto border-status-discord p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3"><div className="flex items-center gap-2"><MessageSquare size={22} className="text-status-discord" aria-hidden="true" /><h2 id="discord-preview-title" className="font-mono text-xl font-bold text-status-discord">Discord Broadcast Preview</h2></div><IconButton variant="ghost" className="size-8 rounded-full" onClick={onClose} disabled={loading} aria-label="Close Discord preview"><X size={16} aria-hidden="true" /></IconButton></div>
        <p className="mb-4 text-pretty text-sm text-secondary-foreground">Review and customize the Markdown summary before sending it to your Discord server.</p>

        <label className="mb-5 block"><span className="mb-2 block font-mono text-xs text-muted-foreground uppercase">Message Content (Markdown Supported)</span><Textarea className="min-h-[200px] bg-surface-0 font-mono leading-6" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} disabled={loading} /><span className="mt-1 block text-right font-mono text-[0.68rem] text-muted-foreground tabular-nums">{message.length}/2000</span></label>

        <section className="mb-6 rounded-sm border border-border bg-surface-1 p-4" aria-labelledby="discord-destination-title">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Hash size={18} className="text-accent" aria-hidden="true" /><h3 id="discord-destination-title" className="font-mono text-sm font-bold">Post to a Specific Thread or Forum (Optional)</h3></div><Button size="sm" onClick={() => setShowThreadInfo(!showThreadInfo)} aria-expanded={showThreadInfo} aria-controls="discord-thread-guide"><Info size={13} aria-hidden="true" />{showThreadInfo ? 'Hide Guide' : 'How does this work?'}</Button></div>
          <div id="discord-thread-guide" hidden={!showThreadInfo} className="mb-3 rounded-sm border-l-[3px] border-status-discord bg-surface-2 p-3 text-[0.8125rem] text-secondary-foreground"><p className="mb-1.5 font-bold">Discord thread delivery:</p><ul className="list-disc space-y-1 pl-5"><li><strong>Existing Thread ID:</strong> sends to an existing thread or forum post. In Discord Developer Mode, right-click the thread and choose Copy Channel ID.</li><li><strong>New Forum Thread Title:</strong> creates a new thread when the webhook targets a Forum Channel.</li></ul></div>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <label><span className="mb-1 flex items-center gap-1 font-mono text-xs text-muted-foreground"><Hash size={12} aria-hidden="true" />Existing Thread ID (Optional)</span><Input className="font-mono text-xs" placeholder="e.g. 123456789012345678" value={threadId} onChange={(event) => setThreadId(event.target.value)} disabled={loading || threadName.length > 0} /></label>
            <label><span className="mb-1 flex items-center gap-1 font-mono text-xs text-muted-foreground"><PlusSquare size={12} aria-hidden="true" />New Forum Post Title</span><Input className="font-mono text-xs" placeholder={buildDiscordForumTitle(ticket)} value={threadName} maxLength={100} onChange={(event) => setThreadName(event.target.value)} disabled={loading || threadId.length > 0} /><span className="mt-1 block text-pretty text-[0.7rem] text-muted-foreground">Leave blank to auto-create this title when the webhook points to a Forum channel.</span></label>
          </div>
        </section>

        <div className="mt-auto flex justify-end gap-3 border-t border-border pt-3"><Button onClick={onClose} disabled={loading}>Cancel</Button><Button className="border-status-discord bg-status-discord text-white hover:bg-status-discord/80" onClick={handleSubmit} disabled={loading}><Send size={16} aria-hidden="true" />{loading ? 'Broadcasting...' : 'Confirm & Post to Discord'}</Button></div>
      </Card>
    </Dialog>
  );
};
