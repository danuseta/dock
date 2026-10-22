import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, X } from 'lucide-react';
import { Dialog, IconButton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatSize } from '../composer/composerLogic';
import { Markdown } from '../Markdown';
import type { ChatAttachment } from '../messages';
import { attachmentHref } from './attachmentUrl';
import { CSV_ROW_LIMIT, csvRows, hasSource, viewKind } from './attachmentView';

type Loaded = { id: string; url: string; text: string | null } | { id: string; error: string };

/** Fetches the file once as a blob, so the server's download header does not apply inside DOCK. */
function useAttachmentBlob(attachment: ChatAttachment): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const { id } = attachment;
  const kind = viewKind(attachment);
  useEffect(() => {
    let url = '';
    let gone = false;
    fetch(attachmentHref(id), { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        return response.blob();
      })
      .then(async (blob) => {
        const text = kind === 'image' || kind === 'pdf' ? null : await blob.text();
        url = URL.createObjectURL(kind === 'pdf' ? new Blob([blob], { type: 'application/pdf' }) : blob);
        if (gone) URL.revokeObjectURL(url);
        else setLoaded({ id, url, text });
      })
      .catch((error: unknown) => {
        if (!gone) setLoaded({ id, error: error instanceof Error ? error.message : 'unknown error' });
      });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind]);
  return loaded?.id === id ? loaded : null;
}

const Body: React.FC<{ attachment: ChatAttachment; loaded: Loaded | null; source: boolean }> = ({ attachment, loaded, source }) => {
  const kind = viewKind(attachment);
  if (!loaded) return <div className="grid h-full place-items-center text-sm text-muted-foreground" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" /><span className="sr-only">Opening the file</span></div>;
  if ('error' in loaded) return <p className="p-4 text-pretty text-sm text-status-conflict" role="alert">The file could not be opened: {loaded.error}</p>;
  const text = loaded.text ?? '';
  if (source || kind === 'text') return <pre className="m-0 min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[0.76rem] leading-relaxed text-secondary-foreground">{text}</pre>;
  if (kind === 'image') return <div className="grid min-h-full place-items-center p-4"><img src={loaded.url} alt={attachment.name} className="max-h-[calc(100dvh-10rem)] max-w-full object-contain" /></div>;
  if (kind === 'pdf') return <iframe title={attachment.name} src={loaded.url} className="block h-full w-full border-0 bg-white" />;
  if (kind === 'html') return <iframe title={attachment.name} srcDoc={text} sandbox="allow-scripts" className="block h-full w-full border-0 bg-white" />;
  if (kind === 'markdown') return <div className="max-w-[72ch] p-5 text-[0.86rem] leading-relaxed"><Markdown text={text} /></div>;
  const rows = csvRows(text);
  return (
    <div className="p-3">
      <table className="border-collapse font-mono text-[0.74rem]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={cn(index === 0 && 'bg-surface-1 text-muted-foreground')}>
              {row.map((cell, column) => <td key={column} className="border border-border px-2.5 py-1 align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= CSV_ROW_LIMIT && <p className="mt-2 text-xs text-muted-foreground">First {CSV_ROW_LIMIT} rows. Save the file to see the rest.</p>}
    </div>
  );
};

interface AttachmentViewerProps {
  attachments: ChatAttachment[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** One file of a message over the session; the arrows step through the other files of the same message. */
export const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ attachments, index, onIndex, onClose }) => {
  const [source, setSource] = useState(false);
  const attachment = attachments[index];
  const kind = viewKind(attachment);
  const loaded = useAttachmentBlob(attachment);
  const many = attachments.length > 1;
  const step = (delta: number) => {
    setSource(false);
    onIndex((index + delta + attachments.length) % attachments.length);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!many) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  };

  return (
    <Dialog open onClose={onClose} labelledBy="attachment-viewer-name" className="h-dvh w-[min(980px,100%)] max-[760px]:p-0">
      <div className="flex h-full max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-md border border-border-glow bg-surface-0 max-[760px]:max-h-dvh max-[760px]:rounded-none max-[760px]:border-0" onKeyDown={onKeyDown}>
        <div className="flex min-w-0 flex-none items-center gap-1.5 border-b border-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 max-[760px]:flex-wrap">
          <h2 id="attachment-viewer-name" className="min-w-0 flex-1 truncate font-mono text-[0.78rem] font-semibold max-[760px]:basis-full">{attachment.name}</h2>
          <span className="flex-none font-mono text-[0.68rem] text-muted-foreground max-[760px]:hidden">{formatSize(attachment.size)}</span>
          {hasSource(kind) && (
            <div className="flex flex-none rounded-sm border border-border p-0.5" role="group" aria-label="Show as">
              {([[false, 'Preview'], [true, 'Source']] as const).map(([value, label]) => (
                <button key={label} type="button" className={cn('h-6 rounded-xs px-2 font-display text-[0.7rem] font-semibold text-secondary-foreground max-[900px]:h-9', source === value && 'bg-accent text-black')} aria-pressed={source === value} onClick={() => setSource(value)}>{label}</button>
              ))}
            </div>
          )}
          {many && <IconButton variant="ghost" aria-label="Previous file" className="max-[900px]:size-11" onClick={() => step(-1)}><ChevronLeft size={15} aria-hidden="true" /></IconButton>}
          {many && <IconButton variant="ghost" aria-label="Next file" className="max-[900px]:size-11" onClick={() => step(1)}><ChevronRight size={15} aria-hidden="true" /></IconButton>}
          <a href={loaded && 'url' in loaded ? loaded.url : attachmentHref(attachment.id)} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab" className="inline-grid size-8 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-1 hover:text-foreground max-[900px]:size-11"><ExternalLink size={14} aria-hidden="true" /></a>
          <a href={attachmentHref(attachment.id)} download={attachment.name} aria-label="Download" title="Download" className="inline-grid size-8 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-1 hover:text-foreground max-[900px]:size-11"><Download size={14} aria-hidden="true" /></a>
          <IconButton variant="ghost" aria-label="Close" className="max-[900px]:size-11" onClick={onClose}><X size={15} aria-hidden="true" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-1/40">
          <Body attachment={attachment} loaded={loaded} source={source} />
        </div>
        {many && <p className="flex-none border-t border-border px-3 py-1.5 font-mono text-[0.66rem] text-muted-foreground tabular-nums">{index + 1} of {attachments.length}</p>}
      </div>
    </Dialog>
  );
};
