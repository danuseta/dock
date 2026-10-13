import React from 'react';
import { FileText, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatSize } from './composerLogic';
import type { AttachmentItem } from './useAttachments';

interface AttachmentTrayProps {
  items: AttachmentItem[];
  notice: string;
  limitText?: string;
  limitId?: string;
  disabled?: boolean;
  onRemove: (key: string) => void;
}

export const AttachmentTray: React.FC<AttachmentTrayProps> = ({ items, notice, limitText = '', limitId, disabled = false, onRemove }) => (
  <>
    {items.length > 0 && (
      <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
        {items.map((item) => (
          <li key={item.key} className={cn('flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-sm border bg-surface-1 py-1 pr-1 pl-1.5', item.state === 'error' ? 'border-status-conflict' : 'border-border')}>
            {item.previewUrl ? (
              <img src={item.previewUrl} alt="" className="size-8 flex-none rounded-xs object-cover" />
            ) : (
              <FileText size={18} className="flex-none text-muted-foreground" aria-hidden="true" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="max-w-[10rem] truncate text-xs text-foreground">{item.name}</span>
              {item.state === 'error' ? (
                <span className="max-w-[14rem] break-words text-[0.66rem] text-status-conflict" role="alert">{item.error}</span>
              ) : item.state === 'uploading' ? (
                <span className="flex items-center gap-1.5">
                  <progress className="h-1 w-16 accent-[var(--color-accent)]" max={1} value={item.progress} aria-label={`Uploading ${item.name}`} />
                  <span className="font-mono text-[0.62rem] text-muted-foreground">{Math.round(item.progress * 100)}%</span>
                </span>
              ) : (
                <span className="font-mono text-[0.62rem] text-muted-foreground">{formatSize(item.size)}</span>
              )}
            </span>
            <button
              type="button"
              className="inline-flex size-11 flex-none items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Remove ${item.name}`}
              disabled={disabled}
              onClick={() => onRemove(item.key)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    )}
    {limitText && <p id={limitId} className="font-mono text-[0.68rem] text-muted-foreground" role="status">{limitText}</p>}
    {notice && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">{notice}</p>}
  </>
);
