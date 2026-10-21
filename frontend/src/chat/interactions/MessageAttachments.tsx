import React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatSize } from '../composer/composerLogic';
import { isImageAttachment, type ChatAttachment } from '../messages';
import { attachmentHref } from './attachmentUrl';

/** Files of a message: on the right under your own message, on the left under an agent's. */
export const MessageAttachments: React.FC<{ attachments: ChatAttachment[]; align?: 'left' | 'right' }> = ({ attachments, align = 'right' }) => {
  if (attachments.length === 0) return null;
  return (
    <ul className={cn('mt-1 flex max-w-full flex-wrap gap-2', align === 'right' && 'justify-end')} aria-label="Attachments">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="min-w-0 max-w-full">
          {isImageAttachment(attachment) ? (
            <a href={attachmentHref(attachment.id)} target="_blank" rel="noopener noreferrer" className="block rounded-xs border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label={`Open image ${attachment.name}`}>
              <img src={attachmentHref(attachment.id)} alt={attachment.name} loading="lazy" className="block max-h-36 max-w-full rounded-xs object-contain" />
            </a>
          ) : attachment.state === 'deleted' ? (
            <span className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] text-muted-foreground">
              <FileText size={13} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{attachment.name}</span><span className="flex-none">no longer stored</span>
            </span>
          ) : (
            <a href={attachmentHref(attachment.id)} download={attachment.name} className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xs border border-border px-2 font-mono text-[0.68rem] text-secondary-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <FileText size={13} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{attachment.name}</span><span className="flex-none text-muted-foreground">{formatSize(attachment.size)}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
};
