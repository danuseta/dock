import React, { useEffect, useState } from 'react';
import { ExternalLink, FileSignature, Figma, Image as ImageIcon } from 'lucide-react';
import { Markdown } from '../../chat/Markdown';
import type { AgentRun } from '../../agents/runs';
import type { SummaryFacts } from '../../components/ticket/useReadiness';
import { cn } from '../../lib/cn';
import { NOTHING_YET, hasCode, type AcTrace } from '../../lib/acTrace';
import { contractFiles, fetchText, withoutComments, type BlackboardFile } from '../../lib/blackboard';
import { isPlayableVideo } from '../../lib/demoVideos';
import type { DraftStoryboard } from '../../lib/contractLinks';

const heading = 'mt-4 mb-1 font-display text-[0.95rem] font-bold text-foreground first:mt-0';

/**
 * Kontrak: what the ticket is for, its pull requests, the definition of done from Tiket → kode, the limits from the
 * brief, and the contract page sous saved on the board. Party is read only; empty means sous calls every agent as today.
 */
export const ContractView: React.FC<{ ticket: string; files: BlackboardFile[]; run: AgentRun | null; summary: SummaryFacts | null; trace: AcTrace | null; demoUrl?: string | null; figmaUrl?: string | null; storyboard?: DraftStoryboard | null }> = ({ ticket, files, run, summary, trace, demoUrl = null, figmaUrl = null, storyboard = null }) => {
  const saved = contractFiles(files)[0] ?? null;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!saved) return undefined;
    let gone = false;
    fetchText(ticket, saved.path).then((body) => { if (!gone) setText(body); }, () => { if (!gone) setText(''); });
    return () => { gone = true; };
  }, [ticket, saved?.path]);
  const pulls = run?.pullRequests?.length ? run.pullRequests.map((pr) => `${pr.repo}#${pr.number}`) : trace?.pulls.map((pull) => pull.label) ?? [];

  return (
    <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground max-[760px]:px-3">
      <div className="mb-3 flex flex-wrap items-center gap-2"><FileSignature size={15} aria-hidden="true" className="text-sky-200" /><b className="font-display text-foreground">Kontrak {ticket}</b></div>
      <p className={heading}>Tujuan</p>
      <p className="text-pretty">{summary?.made || NOTHING_YET}</p>
      <p className={heading}>Tiket dan branch</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>Tiket: {ticket}</li>
        <li>Pull request: {pulls.length ? pulls.join(', ') : NOTHING_YET}</li>
        <li>Kontrak: {saved ? <code className="rounded-xs bg-surface-2 px-1 font-mono text-[0.76rem]">{saved.path}</code> : NOTHING_YET}</li>
      </ul>
      <p className={heading}>Definition of done</p>
      {trace?.readable
        ? (
          <ul className="space-y-1">
            {trace.lines.map((line) => (
              <li key={line.n} className="flex items-start gap-1.5">
                <span className={cn('mt-[5px] inline-block size-[11px] flex-none rounded-[3px] border', hasCode(line) ? 'border-status-merged bg-status-merged' : 'border-border-glow')} aria-hidden="true" />
                <span className="text-pretty"><span className="sr-only">{hasCode(line) ? 'Ada kode: ' : 'Belum: '}</span><b className="font-mono text-[0.74rem] text-foreground">{line.label}</b> {line.textId || line.text || NOTHING_YET}</span>
              </li>
            ))}
          </ul>
        )
        : <p>{NOTHING_YET}</p>}
      <p className="text-xs text-muted-foreground">Dicentang dari Tiket → kode. Baris AC di Jira dan file AC di blackboard nggak diubah.</p>
      <p className={heading}>Batasan</p>
      {run?.brief ? <p className="whitespace-pre-wrap break-words">{run.brief}</p> : <p>{NOTHING_YET}</p>}
      <p className={heading}>Party <span className="ml-1 rounded-xs bg-sky-300/10 px-1.5 py-px font-mono text-[0.62rem] text-sky-200">opsional</span></p>
      <p className="text-xs text-muted-foreground">Kosong: semua agent sous-ticket-runner dipanggil kayak biasa, checkpoint ikut System Settings.</p>
      {(demoUrl || figmaUrl || storyboard) && (
        <>
          <p className={heading}>Demo dan desain</p>
          {demoUrl && (isPlayableVideo(demoUrl)
            ? <video className="my-1 block max-h-[420px] w-full rounded-sm bg-black" src={demoUrl} controls preload="metadata" aria-label={`Demo ${ticket}`} />
            : <a href={demoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono text-xs text-accent hover:underline"><ExternalLink size={12} aria-hidden="true" /><span className="truncate">Demo · {demoUrl.replace(/^https?:\/\//, '')}</span></a>)}
          {figmaUrl && <a href={figmaUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 font-mono text-xs text-accent hover:underline"><Figma size={12} aria-hidden="true" />Figma Link (Jira)</a>}
          {storyboard && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <ImageIcon size={12} aria-hidden="true" className="text-sky-200" />Storyboard {storyboard.epic} v{storyboard.version}{storyboard.frames ? ` · ${storyboard.frames} frame` : ''} di draft sprint
              {storyboard.htmlUrl && <a href={storyboard.htmlUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">buka</a>}
            </p>
          )}
        </>
      )}
      <p className={heading}>Halaman kontrak</p>
      {!saved
        ? <p>{NOTHING_YET}</p>
        : text === null
          ? <p className="text-muted-foreground" role="status">Loading {saved.path}...</p>
          : text
            ? <div className="rounded-sm border border-border bg-surface-0 px-3 py-2 [&_table]:my-2 [&_table]:w-full [&_td]:border-b [&_td]:border-border [&_td]:py-1 [&_td]:pr-3 [&_th]:text-left"><Markdown text={withoutComments(text)} /></div>
            : <p>{NOTHING_YET}</p>}
    </div>
  );
};
