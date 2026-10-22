import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatSize } from '../composer/composerLogic';
import { isImageAttachment, type ChatAttachment } from '../messages';
import { attachmentHref } from './attachmentUrl';
import { AttachmentViewer } from './AttachmentViewer';
import { viewKind } from './attachmentView';

const fileClass = 'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] text-secondary-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

/** Files of a message: on the right under your own message, on the left under an agent's. A click opens them in the viewer. */
export const MessageAttachments: React.FC<{ attachments: ChatAttachment[]; align?: 'left' | 'right' }> = ({ attachments, align = 'right' }) => {
  const [open, setOpen] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  const viewable = attachments.filter((attachment) => viewKind(attachment) !== null);
  const openFile = (attachment: ChatAttachment) => setOpen(viewable.indexOf(attachment));
  return (
    <>
      <ul className={cn('mt-1 flex max-w-full flex-wrap gap-2', align === 'right' && 'justify-end')} aria-label="Attachments">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="min-w-0 max-w-full">
            {isImageAttachment(attachment) ? (
              <button type="button" className="block cursor-zoom-in rounded-xs border border-border p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label={`Open image ${attachment.name}`} onClick={() => openFile(attachment)}>
                <img src={attachmentHref(attachment.id)} alt={attachment.name} loading="lazy" className="block max-h-36 max-w-full rounded-xs object-contain" />
              </button>
            ) : attachment.state === 'deleted' ? (
              <span className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] text-muted-foreground">
                <FileText size={13} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{attachment.name}</span><span className="flex-none">no longer stored</span>
              </span>
            ) : viewKind(attachment) ? (
              <button type="button" className={cn(fileClass, 'text-left')} aria-label={`Open ${attachment.name}`} onClick={() => openFile(attachment)}>
                <FileText size={13} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{attachment.name}</span><span className="flex-none text-muted-foreground">{formatSize(attachment.size)}</span>
              </button>
            ) : (
              <a href={attachmentHref(attachment.id)} download={attachment.name} className={fileClass}>
                <FileText size={13} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{attachment.name}</span><span className="flex-none text-muted-foreground">{formatSize(attachment.size)}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      {open !== null && viewable[open] && <AttachmentViewer attachments={viewable} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
};
