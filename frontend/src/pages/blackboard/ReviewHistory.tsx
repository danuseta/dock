import { ExternalLink } from 'lucide-react';
import { Badge, Button, Textarea } from '../../components/ui';
import type { BadgeVariant } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';
import { DISCORD_LABEL, imageLine, isPending, markerSummary, splitMarker, type HistoryRow, type ReviewRound } from '../../lib/reviewRounds';

const DISCORD_TONE: Record<string, BadgeVariant> = { pending: 'warn', sending: 'warn', sent: 'success', cancelled: 'neutral', failed: 'danger', skipped: 'neutral' };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface ReviewHistoryProps {
  rows: HistoryRow[];
  busy: boolean;
  editing: { id: string; text: string } | null;
  onCancel: (row: HistoryRow) => void;
  onEdit: (row: HistoryRow) => void;
  onText: (text: string) => void;
  onSave: (row: HistoryRow) => void;
  onClose: () => void;
}

/** The rounds of a ticket in order. A post or reply that has not gone out yet can be cancelled or edited until its time comes. */
export const ReviewHistoryTable = ({ rows, busy, editing, onCancel, onEdit, onText, onSave, onClose }: ReviewHistoryProps) => (
  <div className="overflow-x-auto rounded-md border border-border">
    <table className="w-full min-w-[640px] border-collapse text-left text-xs">
      <thead>
        <tr className="bg-surface-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">
          <th className="px-3 py-2 font-bold">Round</th>
          <th className="px-3 py-2 font-bold">Time</th>
          <th className="px-3 py-2 font-bold">Who</th>
          <th className="px-3 py-2 font-bold">Summary</th>
          <th className="px-3 py-2 font-bold">Discord</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.kind}-${row.id}`} className="border-t border-border align-top">
            <td className="px-3 py-2 font-mono tabular-nums">{row.round ?? '—'}</td>
            <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground"><time dateTime={row.at}>{time(row.at)}</time></td>
            <td className="px-3 py-2 text-secondary-foreground">{row.who}</td>
            <td className="px-3 py-2 text-foreground">
              {row.text}
              {row.mode && <Badge variant={row.mode === 'light' ? 'accent' : 'neutral'} className="ml-2 px-1.5 py-0 text-[0.6rem] uppercase">{row.mode}</Badge>}
            </td>
            <td className="px-3 py-2">
              {row.discord ? (
                <div className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={DISCORD_TONE[row.discord] ?? 'neutral'} className="px-1.5 py-0 text-[0.62rem]">{DISCORD_LABEL[row.discord] ?? row.discord}</Badge>
                    {isPending(row) && editing?.id !== row.id && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => onCancel(row)}>Cancel post</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => onEdit(row)}>Edit</Button>
                      </>
                    )}
                  </span>
                  {row.discordDetail && <span className="text-muted-foreground">{row.discordDetail}</span>}
                  {editing?.id === row.id ? (
                    <div className="flex flex-col gap-1.5">
                      <Textarea aria-label="Post text" className="min-h-[120px] font-mono text-xs" value={editing.text} onChange={(event) => onText(event.target.value)} />
                      {splitMarker(row.discordText ?? '').marker && <span className="font-mono text-muted-foreground">{splitMarker(row.discordText ?? '').marker}</span>}
                      <span className="text-muted-foreground">The marker line is added by DOCK and stays as it is.</span>
                      <span className="flex gap-2">
                        <Button size="sm" variant="primary" className="h-7 px-2" disabled={busy || editing.text.trim() === ''} onClick={() => onSave(row)}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClose}>Close</Button>
                      </span>
                    </div>
                  ) : row.discordText && (
                    <>
                      <span className="line-clamp-2 max-w-[320px] whitespace-pre-wrap text-secondary-foreground">{splitMarker(row.discordText).body}</span>
                      {splitMarker(row.discordText).marker && <span className="font-mono text-[0.68rem] text-muted-foreground">{markerSummary(splitMarker(row.discordText).marker)}</span>}
                    </>
                  )}
                  {isPending(row) && row.discordImages.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Post images">
                      {row.discordImages.map((image) => <li key={image.n} className="max-w-[320px] break-words font-mono text-[0.68rem] text-secondary-foreground">{imageLine(image)}</li>)}
                    </ul>
                  )}
                </div>
              ) : <span className="text-muted-foreground">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The findings of the newest round a teammate's DOCK sent, with the runner that took them. */
export const LatestFindings = ({ round }: { round: ReviewRound }) => (
  <section className="rounded-md border border-border bg-surface-0 p-4" aria-label="Latest round findings">
    <p className="mb-1 flex flex-wrap items-center gap-2 font-display text-sm font-bold">
      Latest round
      <Badge variant={round.mode === 'light' ? 'accent' : 'neutral'} className="px-1.5 py-0 text-[0.62rem] uppercase">{round.mode ?? 'mode unknown'}</Badge>
      <Badge className="px-1.5 py-0 text-[0.62rem]">{round.status}</Badge>
    </p>
    <p className="m-0 text-pretty text-sm text-secondary-foreground">{round.summary}</p>
    {round.threadUrl && <a href={round.threadUrl} target="_blank" rel="noreferrer" className={cn('mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline')}>Open thread<ExternalLink size={11} aria-hidden="true" /></a>}
  </section>
);
