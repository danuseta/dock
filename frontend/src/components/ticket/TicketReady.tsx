import React, { useState } from 'react';
import { AlertCircle, ArrowRight, ArrowRightLeft, CheckCheck, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, ExternalLink, GitFork, Hammer, History, Hourglass, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ReadinessItem, TicketLinkRow, TicketReadiness } from '../../lib/ticketDetail';
import type { SummaryFacts } from './useReadiness';

const tone = (ready: TicketReadiness) => (ready.done === ready.total ? 'bg-status-merged-bg text-status-merged' : 'bg-status-warn-bg text-status-warn');

/** "Siap dikerjain n/7" on a TODO card; hovering it lists what is missing. */
export const ReadinessChip: React.FC<{ ready: TicketReadiness }> = ({ ready }) => (
  <span className="group/ready relative flex flex-col gap-1">
    <span className={cn('inline-flex w-fit items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[0.68rem] font-bold', tone(ready))} title={ready.missing.map((item) => item.text).join('\n') || undefined}>
      <ClipboardCheck size={11} aria-hidden="true" />Siap dikerjain {ready.done}/{ready.total}
    </span>
    {ready.missing.length > 0 && (
      <span className="hidden flex-col gap-0.5 rounded-xs border border-border bg-surface-0 px-2 py-1.5 text-[0.72rem] text-muted-foreground group-hover/ready:flex" role="list" aria-label="Yang masih kurang">
        {ready.missing.map((item) => <span key={item.id} role="listitem" className="flex gap-1.5"><AlertCircle size={12} className="mt-0.5 flex-none text-status-warn" aria-hidden="true" />{item.text}</span>)}
      </span>
    )}
  </span>
);

const FixButton: React.FC<{ item: ReadinessItem; onNavigate: (path: string) => void }> = ({ item, onNavigate }) => {
  if (!item.fix || !item.href) return null;
  const className = 'inline-flex h-7 flex-none items-center gap-1 rounded-sm px-2 text-xs font-semibold text-accent hover:bg-surface-2 max-[760px]:h-11';
  if (/^https?:/.test(item.href)) return <a href={item.href} target="_blank" rel="noreferrer" className={className}>{item.fix}<ExternalLink size={12} aria-hidden="true" /></a>;
  const go = () => (item.href!.startsWith('#') ? document.getElementById(item.href!.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : onNavigate(item.href!));
  return <button type="button" className={className} onClick={go}>{item.fix}<ArrowRight size={12} aria-hidden="true" /></button>;
};

/** G2 under the ticket title: the seven items, each missing one with a link to where it gets fixed. */
export const ReadinessCard: React.FC<{ ready: TicketReadiness; startOpen: boolean; onNavigate: (path: string) => void }> = ({ ready, startOpen, onNavigate }) => {
  const [open, setOpen] = useState(startOpen);
  return (
    <section aria-label="Siap dikerjain" className="rounded-md border border-border bg-surface-1 px-3.5 py-3">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <h2 className="flex items-center gap-1.5 font-display text-sm font-bold"><ClipboardCheck size={14} className="text-sky-200" aria-hidden="true" />Siap dikerjain</h2>
        <span className={cn('rounded-xs px-1.5 py-0.5 font-mono text-[0.68rem] font-bold', tone(ready))}>{ready.done} dari {ready.total}</span>
        <span className="text-xs text-muted-foreground">cuma info, status tetap bisa dipindah</span>
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}</span>
      </button>
      <div className="mt-2 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${ready.total}, minmax(0, 1fr))` }} aria-hidden="true">
        {ready.items.map((item) => <i key={item.id} className={cn('h-1.5 rounded-pill', item.ok ? 'bg-status-merged' : 'bg-status-warn-bg')} />)}
      </div>
      {open && (
        <ul className="mt-1">
          {ready.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 border-t border-border py-2 first:border-t-0">
              {item.ok ? <CheckCircle2 size={15} className="mt-0.5 flex-none text-status-merged" aria-hidden="true" /> : <AlertCircle size={15} className="mt-0.5 flex-none text-status-warn" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', item.ok ? 'text-secondary-foreground' : 'text-foreground')}>{item.text}</p>
                {item.detail && <p className="text-pretty text-xs text-muted-foreground">{item.detail}</p>}
              </div>
              {!item.ok && <FixButton item={item} onNavigate={onNavigate} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const dateText = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** "Intinya" above Description and AC: what it builds, what is checked here, what is not, what it waits for; or before / after. */
export const SummaryBlock: React.FC<{ summary: SummaryFacts; jiraUrl?: string | null }> = ({ summary, jiraUrl }) => {
  const [view, setView] = useState<'three' | 'ba'>('three');
  const row = (Icon: typeof Hammer, toneClass: string, label: string, text: string) => (
    <div className="flex items-start gap-2.5 border-t border-border py-2 first:border-t-0 first:pt-0.5">
      <span className={cn('grid size-7 flex-none place-items-center rounded-[7px]', toneClass)}><Icon size={14} aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="text-pretty text-sm text-foreground">{text}</p>
      </div>
    </div>
  );
  const seg = (id: 'three' | 'ba', label: string) => (
    <button type="button" aria-pressed={view === id} onClick={() => setView(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold max-[760px]:h-11', view === id ? 'bg-accent text-black' : 'text-secondary-foreground hover:text-foreground')}>{label}</button>
  );
  return (
    <section aria-label="Intinya" className="rounded-md border border-border bg-surface-1 px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-bold"><Sparkles size={14} className="text-sky-200" aria-hidden="true" />Intinya</h2>
        <span className="inline-flex rounded-sm border border-border bg-surface-0 p-0.5" role="group" aria-label="Tampilan ringkasan">{seg('three', 'Tiga baris')}{seg('ba', 'Sebelum / sesudah')}</span>
        {!summary.current && <span className="inline-flex items-center gap-1 rounded-xs bg-status-warn-bg px-1.5 py-0.5 font-mono text-[0.66rem] font-semibold text-status-warn"><History size={11} aria-hidden="true" />AC berubah sesudah ringkasan ditulis</span>}
        <span className="ml-auto flex flex-wrap items-center gap-x-2 font-mono text-[0.62rem] text-muted-foreground">
          {summary.acChangedAt && <span>AC terakhir berubah {dateText(summary.acChangedAt)}</span>}
          {jiraUrl && <a href={jiraUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">AC asli di Jira<ExternalLink size={11} aria-hidden="true" /></a>}
        </span>
      </div>
      {view === 'ba' ? (
        <div className="grid grid-cols-2 gap-2.5 max-[700px]:grid-cols-1">
          <div className="rounded-sm border border-border bg-surface-0 px-3 py-2.5"><p className="mb-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Sekarang</p><p className="text-pretty text-sm text-foreground">{summary.before}</p></div>
          <div className="rounded-sm border border-status-merged/40 bg-surface-0 px-3 py-2.5"><p className="mb-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-status-merged">Setelah tiket ini</p><p className="text-pretty text-sm text-foreground">{summary.after}</p></div>
        </div>
      ) : (
        <>
          {row(Hammer, 'bg-sky-300/10 text-sky-200', 'Bikin apa', summary.made)}
          {row(CheckCheck, 'bg-status-merged-bg text-status-merged', 'Dicek di sini', summary.checked)}
          {row(ArrowRightLeft, 'bg-surface-2 text-muted-foreground', 'Bukan di sini', summary.notHere || 'Nggak ada')}
          {row(Hourglass, 'bg-surface-2 text-muted-foreground', 'Nunggu tiket lain', summary.waitsOn.length ? summary.waitsOn.join(', ') : 'Nggak nunggu tiket lain')}
        </>
      )}
    </section>
  );
};

const NODE_W = 200;
const NODE_H = 40;

/** The map behind "Nyambung ke N tiket": Reference on the left, Blocks and undecided mentions on the right. */
const LinksSvg: React.FC<{ ticketKey: string; links: TicketLinkRow[] }> = ({ ticketKey, links }) => {
  const left = links.filter((link) => link.kind === 'reference');
  const right = links.filter((link) => link.kind !== 'reference');
  const height = Math.max(left.length * 52 + 20, right.length * 60 + 40, 140);
  const cx = 450;
  const cy = height / 2;
  const short = (text: string | null) => (text && text.length > 30 ? `${text.slice(0, 30)}…` : text ?? '');
  const node = (x: number, y: number, link: TicketLinkRow) => (
    <g key={link.key}>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx="8" fill="var(--color-surface-0)" stroke={link.kind === 'blocks' ? 'var(--color-status-warn)' : link.kind === 'open' ? 'var(--color-status-warn)' : 'var(--color-border-glow)'} strokeDasharray={link.kind === 'blocks' ? undefined : '5 4'} />
      <text x={x + 10} y={y + 17} fill="var(--color-foreground)" style={{ font: '700 12px var(--font-mono)' }}>{link.key}</text>
      <text x={x + 10} y={y + 32} fill="var(--color-muted-foreground)" style={{ font: '500 11px var(--font-body)' }}>{short(link.text)}</text>
      {link.kind !== 'reference' && <text x={x + NODE_W - 8} y={y + 17} textAnchor="end" fill="var(--color-status-warn)" style={{ font: '700 9.5px var(--font-mono)' }}>{link.kind === 'blocks' ? 'BLOCKS' : 'BELUM JELAS'}</text>}
    </g>
  );
  return (
    <svg className="block h-auto w-full min-w-[720px]" viewBox={`0 0 900 ${height}`} role="img" aria-label={`Peta tiket yang nyambung ke ${ticketKey}`}>
      <defs><marker id={`arrow-${ticketKey}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-status-warn)" /></marker></defs>
      {left.map((link, index) => {
        const y = 20 + index * 52;
        return <React.Fragment key={link.key}><line x1={30 + NODE_W} y1={y + NODE_H / 2} x2={cx - 95} y2={cy} stroke="var(--color-muted-foreground)" strokeWidth="1.3" strokeDasharray="5 5" />{node(30, y, link)}</React.Fragment>;
      })}
      {right.map((link, index) => {
        const y = 30 + index * 60;
        return (
          <React.Fragment key={link.key}>
            {link.kind === 'blocks'
              ? <line x1={cx + 95} y1={cy} x2={664} y2={y + NODE_H / 2} stroke="var(--color-status-warn)" strokeWidth="3" markerEnd={`url(#arrow-${ticketKey})`} />
              : <line x1={cx + 95} y1={cy} x2={670} y2={y + NODE_H / 2} stroke="var(--color-status-warn)" strokeOpacity="0.7" strokeWidth="1.6" strokeDasharray="6 5" />}
            {node(670, y, link)}
          </React.Fragment>
        );
      })}
      <rect x={cx - 95} y={cy - 24} width="190" height="48" rx="10" fill="var(--color-surface-2)" stroke="var(--color-accent)" strokeWidth="1.5" />
      <text x={cx} y={cy + 5} textAnchor="middle" fill="var(--color-foreground)" style={{ font: '800 15px var(--font-mono)' }}>{ticketKey}</text>
    </svg>
  );
};

/** Folded "Nyambung ke N tiket" under Intinya; opens the map. */
export const LinksMap: React.FC<{ ticketKey: string; links: TicketLinkRow[]; onNavigate: (path: string) => void }> = ({ ticketKey, links, onNavigate }) => {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('map') === 'open');
  if (!links.length) return null;
  const count = (kind: TicketLinkRow['kind']) => links.filter((link) => link.kind === kind).length;
  const chip = (text: string, warn = false) => <span className={cn('rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]', warn ? 'border-status-warn text-status-warn' : 'border-border text-muted-foreground')}>{text}</span>;
  const unclear = links.filter((link) => link.kind === 'open');
  return (
    <section aria-label="Nyambung ke tiket lain" className="rounded-md border border-border bg-surface-1 px-3.5 py-2.5">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <GitFork size={14} className="text-sky-200" aria-hidden="true" />
        <b className="font-display">Nyambung ke {links.length} tiket</b>
        {count('reference') > 0 && chip(`${count('reference')} cuma disebut`)}
        {count('blocks') > 0 && chip(`${count('blocks')} ditunggu`, true)}
        {unclear.length > 0 && chip(`${unclear.length} tanpa link Blocks`, true)}
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent">{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}{open ? 'tutup peta' : 'buka peta'}</span>
      </button>
      {open && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-6 border-t-2 border-dashed border-muted-foreground" aria-hidden="true" />pindah ke Reference</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-6 border-t-[3px] border-status-warn" aria-hidden="true" />ditunggu (link Blocks)</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-6 border-t-2 border-dashed border-status-warn" aria-hidden="true" />belum diputusin</span>
          </div>
          <div className="mt-2 overflow-x-auto"><LinksSvg ticketKey={ticketKey} links={links} /></div>
          {unclear.length > 0 && (
            <div className="mt-2 flex flex-wrap items-start gap-2.5 rounded-sm border border-status-warn/40 bg-status-warn-bg px-3 py-2 text-sm">
              <AlertCircle size={15} className="mt-0.5 text-status-warn" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <b className="font-display">{unclear.length} rujukan belum diputusin</b>
                <p className="text-pretty text-xs text-secondary-foreground">{unclear.map((link) => link.key).join(', ')} disebut di AC tanpa link Blocks. Kalau ditunggu, pilih Dependency. Kalau cuma info, pindahin barisnya ke Reference.</p>
              </div>
              <button type="button" className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-semibold text-accent hover:bg-surface-2 max-[760px]:h-11" onClick={() => onNavigate('/planning?tab=draft&panel=ac')}>Buka AC check<ArrowRight size={12} aria-hidden="true" /></button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
