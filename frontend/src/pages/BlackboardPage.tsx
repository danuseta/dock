import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ArrowLeft, BookA, ChevronDown, ChevronRight, ClipboardList, Download, Eye, File, FileCheck2, FileSignature, Folder, FolderOpen, GitPullRequest, Image as ImageIcon, Info, List, Lock, MapPin, HelpCircle, Route, Scale, ScrollText, Video } from 'lucide-react';
import { Button, Checkbox, Input, Page } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { GET_DASHBOARD, GET_ORCHESTRATION, GET_ORCHESTRATIONS, GET_RUN_THINKING, GET_SPRINT_DRAFT, GET_TICKET_DETAIL_CORE, GET_TICKET_READINESS, GET_TICKET_SUMMARY } from '../graphql/queries';
import { usePullPatches } from '../lib/usePullPatches';
import { draftStoryboard } from '../lib/contractLinks';
import type { SprintDraft } from '../agents/planning';
import { ThinkingList } from '../agents/ThinkingList';
import { filterRows, rowsMarkdown, type RowFilter, type ThinkingRow } from '../agents/thinking';
import { stageLabel, type AgentRun, type AgentTimeline } from '../agents/runs';
import { repoName } from '../changes/href';
import type { SummaryFacts } from '../components/ticket/useReadiness';
import { coverageText, useAcTrace, withIndonesian, type AcRef } from '../lib/acTrace';
import { cn } from '../lib/cn';
import { CONTRACT_ENTRY, KAMUS_ENTRY, KAMUS_FILE, LOG_ENTRY, TRACE_ENTRY, boardTree, contractFiles, fetchFiles, fetchRootText, fetchText, fetchTickets, fileUrl, formatSize, groupFiles, isPullEntry, pullEntry, pullRepo, sprintGroups, withoutComments, type BlackboardFile, type BlackboardKind, type BlackboardTicket, type BoardFilter } from '../lib/blackboard';
import { AcMap } from './blackboard/AcMap';
import { CodeChanges } from './blackboard/CodeChanges';
import { ContractView } from './blackboard/ContractView';
import { ExecLog } from './blackboard/ExecLog';

interface RunInfo { key: string; title: string | null; stage: string; kind?: string | null }

const FILE_ICON: Record<string, React.ElementType> = { 'NOW.md': MapPin, 'review.md': FileCheck2, 'decisions.md': Scale, 'issues.md': HelpCircle, 'status.md': List };
const iconFor = (file: BlackboardFile) => FILE_ICON[file.path] ?? (file.kind === 'image' ? ImageIcon : file.kind === 'video' ? Video : File);

const STAGE_TONE: Record<string, string> = {
  done: 'bg-status-merged-bg text-status-merged',
  evidence: 'bg-status-warn/10 text-status-warn',
  blocked: 'bg-status-conflict-bg text-status-conflict',
};

const when = (iso: string) => {
  const at = new Date(iso);
  const today = new Date();
  return at.toDateString() === today.toDateString()
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const readQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return { key: params.get('key'), file: params.get('file'), path: params.get('path') };
};

const writeQuery = (key: string | null, file: string | null) => {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  if (file) params.set('file', file);
  const search = params.toString();
  window.history.replaceState({}, '', `/blackboard${search ? `?${search}` : ''}`);
};

/** One file: rendered markdown, plain text, an image, a video, or a gallery for a folder of images. */
const FileView: React.FC<{ ticket: string; file: BlackboardFile | null; folder: { name: string; files: BlackboardFile[] } | null; onPick: (path: string) => void }> = ({ ticket, file, folder, onPick }) => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    setError(null);
    if (!file || file.kind !== 'text') return undefined;
    let gone = false;
    fetchText(ticket, file.path).then((body) => { if (!gone) setText(body); }, (failure: Error) => { if (!gone) setError(failure.message); });
    return () => { gone = true; };
  }, [ticket, file]);

  if (folder) {
    const images = folder.files.filter((entry) => entry.kind === 'image');
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
        {folder.files.map((entry) => (
          <button key={entry.path} type="button" onClick={() => onPick(entry.path)} className="overflow-hidden rounded-sm border border-border bg-surface-0 text-left hover:border-border-glow">
            {entry.kind === 'image'
              ? <img src={fileUrl(ticket, entry.path)} alt={entry.path} loading="lazy" className="aspect-[16/10] w-full bg-surface-1 object-cover object-top" />
              : <span className="grid aspect-[16/10] place-items-center bg-surface-1 text-muted-foreground"><File size={20} aria-hidden="true" /></span>}
            <span className="block truncate px-2 py-1.5 font-mono text-[0.66rem] text-secondary-foreground">{entry.path.slice(folder.name.length + 1)}</span>
          </button>
        ))}
        {images.length === 0 && folder.files.length === 0 && <p className="text-sm text-muted-foreground">This folder is empty.</p>}
      </div>
    );
  }
  if (!file) return <p className="p-6 text-sm text-muted-foreground">Pick a file to read it.</p>;
  if (file.kind === 'image') return <div className="grid place-items-center p-4"><img src={fileUrl(ticket, file.path)} alt={file.path} className="max-h-[calc(100dvh-16rem)] max-w-full rounded-xs object-contain" /></div>;
  if (file.kind === 'video') return <div className="p-4"><video src={fileUrl(ticket, file.path)} controls className="max-h-[calc(100dvh-16rem)] w-full rounded-xs bg-black" /></div>;
  if (file.kind === 'other') return <p className="p-6 text-sm text-muted-foreground">This file type is not shown here. Download it to open it.</p>;
  if (error) return <p className="p-6 text-sm text-status-conflict" role="alert">{error}</p>;
  if (text === null) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading {file.path}...</p>;
  return (
    <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground">
      {file.generated && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xs border border-dashed border-border px-2.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground">
          <Info size={12} aria-hidden="true" />Rendered from the ledger by status.cjs. Do not edit it; change the ledger with status.cjs.
        </p>
      )}
      {file.path.endsWith('.md')
        ? <div className="[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b [&_th]:border-border-glow [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground"><Markdown text={withoutComments(text)} /></div>
        : <pre className="whitespace-pre-wrap font-mono text-[0.74rem] [overflow-wrap:anywhere]">{text}</pre>}
    </div>
  );
};



/** The execution log of the ticket's run on this DOCK: stages, gates, agents, tools and the owner's actions, newest first. */
const LOG_FILTERS: Array<[RowFilter, string]> = [['all', 'All'], ['owner', 'Owner'], ['agents', 'Agents'], ['git', 'Git / PR'], ['problems', 'Problems']];

/** The ticket's audit log: every agent's asks, decisions and actions, the owner's answers, git and PR steps, across every round. */
const LogView: React.FC<{ ticket: string }> = ({ ticket }) => {
  const [filter, setFilter] = useState<RowFilter>('all');
  const { data, loading, error } = useQuery<{ runThinking: ThinkingRow[] }>(GET_RUN_THINKING, { variables: { key: ticket }, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  if (error && !data) return <p className="p-6 text-sm text-status-conflict" role="alert">{error.message}</p>;
  if (!data && loading) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading the log...</p>;
  const all = data?.runThinking ?? [];
  if (all.length === 0) return <p className="p-6 text-sm text-muted-foreground">No run recorded for this ticket on this DOCK, or it has no log yet.</p>;
  const rows = filterRows(all, filter, null);
  const exportMarkdown = () => {
    const blob = new Blob([rowsMarkdown(ticket, rows)], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${ticket}-log${filter === 'all' ? '' : `-${filter}`}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="inline-flex flex-wrap rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="Log filter">
          {LOG_FILTERS.map(([id, label]) => {
            const count = filterRows(all, id, null).length;
            return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold text-secondary-foreground max-[760px]:h-11', filter === id && 'bg-accent text-black')}>{label} <span className="font-mono font-medium opacity-70">{count}</span></button>;
          })}
        </div>
        <Button size="sm" className="ml-auto" onClick={exportMarkdown}><Download size={13} aria-hidden="true" />Export .md</Button>
      </div>
      <div className="bg-surface-0 px-4 pb-4">
        <ThinkingList runKey={ticket} rows={rows} allRows={all} empty="Nothing matches this filter." />
      </div>
    </div>
  );
};

/** The agents' per-ticket blackboard on this workspace, read-only: tickets per sprint, one ticket's folders, and one entry at a time. */
const BlackboardPage: React.FC<{ onNavigate?: (path: string) => void; onTicketClick?: (key: string) => void }> = ({ onNavigate, onTicketClick }) => {
  const [initial] = useState(readQuery);
  const [tickets, setTickets] = useState<BlackboardTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<string | null>(initial.key);
  const [files, setFiles] = useState<BlackboardFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.file);
  const [focus, setFocus] = useState<string | null>(initial.path);
  const [kamus, setKamus] = useState<string | null | undefined>(undefined);
  const { data } = useQuery<{ orchestrations: RunInfo[] }>(GET_ORCHESTRATIONS, { fetchPolicy: 'cache-and-network' });
  const runs = useMemo(() => new Map((data?.orchestrations ?? []).map((run) => [run.key.toUpperCase(), run])), [data]);
  const { data: board } = useQuery(GET_DASHBOARD, { fetchPolicy: 'cache-only', returnPartialData: true });
  const jiraSprint = useMemo(() => new Map<string, string>((board?.dashboard ?? []).flatMap((group: { tickets?: Array<{ key: string; sprintName?: string | null }> }) => group.tickets ?? []).filter((ticket: { sprintName?: string | null }) => ticket.sprintName && ticket.sprintName !== 'No Sprint').map((ticket: { key: string; sprintName: string }) => [ticket.key.toUpperCase(), ticket.sprintName])), [board]);
  const { data: detail } = useQuery<{ orchestration: AgentRun & { timeline?: AgentTimeline | null } | null }>(GET_ORCHESTRATION, { variables: { key: picked ?? '' }, skip: !picked, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  const run = picked && detail?.orchestration?.key?.toUpperCase() === picked.toUpperCase() ? detail.orchestration : null;
  const { data: summaryData } = useQuery<{ ticketSummary: SummaryFacts | null }>(GET_TICKET_SUMMARY, { variables: { key: picked ?? '' }, skip: !picked, fetchPolicy: 'cache-first' });
  const summary = summaryData?.ticketSummary?.key === picked ? summaryData?.ticketSummary ?? null : null;
  const rawTrace = useAcTrace(picked, Boolean(picked));
  const trace = useMemo(() => (rawTrace ? withIndonesian(rawTrace, summary) : null), [rawTrace, summary]);

  useEffect(() => {
    fetchTickets().then(setTickets, (failure: Error) => setError(failure.message));
    fetchRootText(KAMUS_FILE).then(setKamus);
  }, []);

  useEffect(() => {
    setFiles(null);
    if (!picked) return undefined;
    let gone = false;
    fetchFiles(picked).then((found) => { if (!gone) setFiles(found ?? []); }, (failure: Error) => { if (!gone) setError(failure.message); });
    return () => { gone = true; };
  }, [picked]);

  useEffect(() => { writeQuery(picked, selected); }, [picked, selected]);

  const kindOf = (ticket: BlackboardTicket): BlackboardKind => {
    const kind = runs.get(ticket.key)?.kind;
    return kind === 'review' ? 'review' : kind ? 'task' : ticket.kind ?? 'task';
  };
  const sprintOf = (ticket: BlackboardTicket) => ticket.sprint ?? jiraSprint.get(ticket.key) ?? null;
  const shown = (tickets ?? []).filter((ticket) => {
    const run = runs.get(ticket.key);
    if (hideDone && run?.stage === 'done') return false;
    const needle = query.trim().toLowerCase();
    return !needle || ticket.key.toLowerCase().includes(needle) || (run?.title ?? '').toLowerCase().includes(needle);
  });
  const sprints = sprintGroups(shown, filter, sprintOf, kindOf);
  const tree = boardTree(files ?? []);
  const groups = groupFiles(files ?? []);
  const file = (files ?? []).find((entry) => entry.path === selected) ?? null;
  const folder = selected && !file ? groups.find((group) => group.folder === selected) ?? null : null;
  const pickTicket = (key: string) => { setPicked(key); setSelected('NOW.md'); setFocus(null); };
  const pick = (entry: string) => { setSelected(entry); setFocus(null); };
  const repos = [...new Set([...(run?.pullRequests ?? []).map((pr) => repoName(pr.repo)), ...(trace?.pulls ?? []).map((pull) => repoName(pull.url))])];
  const patches = usePullPatches(picked, repos, selected === TRACE_ENTRY);
  const onContract = Boolean(picked) && selected === CONTRACT_ENTRY;
  const { data: jira } = useQuery(GET_TICKET_DETAIL_CORE, { variables: { key: picked ?? '' }, skip: !onContract, fetchPolicy: 'cache-first' });
  const jiraTicket = jira?.ticketDetail?.key?.toUpperCase() === picked?.toUpperCase() ? jira?.ticketDetail : null;
  const { data: readiness } = useQuery<{ ticketReadiness: { tickets: Array<{ key: string; sprint: string | null }> } }>(GET_TICKET_READINESS, { variables: { keys: [picked ?? ''], refs: [] }, skip: !onContract, fetchPolicy: 'cache-first' });
  const draftSprint = readiness?.ticketReadiness?.tickets.find((item) => item.key === picked)?.sprint ?? null;
  const { data: draftData } = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: draftSprint ?? '' }, skip: !onContract || !draftSprint, fetchPolicy: 'cache-first' });
  const storyboard = picked ? draftStoryboard(draftData?.sprintDraft, picked) : null;
  const openRef = (ref: AcRef) => {
    const pull = trace?.pulls.find((item) => item.side === ref.side) ?? (trace?.pulls.length === 1 ? trace.pulls[0] : null);
    setSelected(pullEntry(pull ? repoName(pull.url) : repos[0] ?? null));
    setFocus(ref.path);
  };
  const pickedTicket = (tickets ?? []).find((ticket) => ticket.key === picked) ?? null;
  const pickedRun = picked ? runs.get(picked) : undefined;
  const title = selected === LOG_ENTRY ? 'Log eksekusi' : selected === TRACE_ENTRY ? 'Tiket → kode' : selected === CONTRACT_ENTRY ? 'Kontrak' : selected === KAMUS_ENTRY ? KAMUS_FILE : isPullEntry(selected) ? `Perubahan kode${pullRepo(selected) ? ` · ${pullRepo(selected)}` : ''}` : selected ?? '';
  const entry = (id: string, Icon: React.ElementType, label: React.ReactNode, meta: React.ReactNode, depth = 1) => (
    <button key={id} type="button" onClick={() => pick(id)} aria-current={selected === id ? 'true' : undefined} style={{ paddingLeft: `${10 + depth * 14}px` }} className={cn('flex w-full items-center gap-2 border-0 bg-transparent py-1.5 pr-3.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1 max-[760px]:min-h-11', selected === id && 'bg-surface-1 text-foreground')}>
      <Icon size={14} aria-hidden="true" className="flex-none" /><span className="truncate">{label}</span><span className="ml-auto flex-none font-mono text-[0.6rem] text-muted-foreground">{meta}</span>
    </button>
  );
  const dir = (name: string) => <p className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1 font-mono text-[0.66rem] font-bold text-foreground"><FolderOpen size={13} aria-hidden="true" className="text-sky-200" />{name}/</p>;
  const folderEntry = (group: { folder: string; files: BlackboardFile[] }) => entry(group.folder, group.files.every((item) => item.kind === 'image') ? ImageIcon : Folder, group.folder, group.files.length);

  return (
    <Page width="full" className="max-[760px]:pb-28">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Blackboard</h1>
          <p className="mt-1 text-xs text-muted-foreground">The agents' working board per ticket: contract, log, Tiket → kode, code changes, decisions, review notes and evidence. Read-only.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-border px-2 py-1 text-[0.68rem] text-muted-foreground"><Lock size={12} aria-hidden="true" />Read-only</span>
      </header>
      {error && <p className="mb-4 text-xs text-status-conflict" role="alert">{error}</p>}

      <div className="grid min-h-[640px] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[760px]:grid-cols-1">
        {!picked ? (
          <section className={cn('flex min-w-0 flex-col border-r border-border bg-surface-0', selected && 'max-[760px]:hidden')} aria-label="Tickets">
            <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
              <Input type="search" aria-label="Search tickets" className="h-8 text-xs max-[760px]:h-11" placeholder="Search key or title" value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex overflow-hidden rounded-xs border border-border-glow font-mono text-[0.66rem]" role="group" aria-label="Board type">
                  {([['all', 'Semua'], ['task', 'Task'], ['review', 'Review']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('px-2 py-1 max-[760px]:min-h-11', filter === id ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')}>{label}</button>)}
                </span>
                <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground max-[760px]:min-h-11 max-[760px]:text-xs"><Checkbox checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />Hide done</label>
              </div>
            </div>
            <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto px-2 pb-2 max-[760px]:max-h-none">
              <h3 className="flex items-center justify-between px-2 pt-3 pb-1 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">Root <span className="tabular-nums">1</span></h3>
              <button type="button" onClick={() => pick(KAMUS_ENTRY)} aria-current={selected === KAMUS_ENTRY ? 'true' : undefined} className={cn('mb-0.5 flex w-full items-center gap-2 rounded-xs border border-transparent px-2.5 py-1.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1 max-[760px]:min-h-11', selected === KAMUS_ENTRY && 'border-border-glow bg-surface-1 text-foreground')}>
                <BookA size={14} aria-hidden="true" className="flex-none text-sky-200" /><span className="truncate font-mono">{KAMUS_FILE}</span><span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">{kamus === null ? 'belum ada' : 'kamus'}</span>
              </button>
              {tickets === null && !error && <p className="px-2 py-6 text-sm text-muted-foreground" role="status">Loading tickets...</p>}
              {tickets !== null && sprints.length === 0 && <p className="px-2 py-6 text-sm text-muted-foreground">{tickets.length === 0 ? 'No ticket has a blackboard yet.' : filter === 'all' ? 'No ticket matches.' : `No ${filter === 'task' ? 'Task' : 'Review'} tickets.`}</p>}
              {sprints.map((group) => (
                <section key={group.sprint} aria-label={group.sprint}>
                  <button type="button" aria-expanded={!closed[group.sprint]} onClick={() => setClosed((state) => ({ ...state, [group.sprint]: !state[group.sprint] }))} className="flex w-full items-center gap-1.5 border-0 bg-transparent px-2 pt-3 pb-1 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground max-[760px]:min-h-11">
                    {closed[group.sprint] ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{group.sprint}<span className="ml-auto tabular-nums">{group.tickets.length}</span>
                  </button>
                  {!closed[group.sprint] && group.tickets.map((ticket) => {
                    const run = runs.get(ticket.key);
                    return (
                      <button key={`${ticket.epic ?? ''}/${ticket.key}`} type="button" onClick={() => pickTicket(ticket.key)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 rounded-xs border-0 bg-transparent px-2.5 py-2 text-left hover:bg-surface-1">
                        <span className="flex items-center gap-1.5 font-mono text-xs font-bold">{kindOf(ticket) === 'review' && <Eye size={12} aria-label="Review" className="text-sky-200" />}{ticket.key}</span>
                        {run ? <span className={cn('self-start rounded-xs px-1.5 py-px font-mono text-[0.6rem] font-bold max-[760px]:text-xs', STAGE_TONE[run.stage] ?? 'bg-surface-2 text-secondary-foreground')}>{stageLabel(run.stage)}</span> : <span />}
                        <span className="col-span-2 truncate text-[0.72rem] text-secondary-foreground max-[760px]:line-clamp-2 max-[760px]:whitespace-normal">{run?.title ?? (ticket.epic ? `in ${ticket.epic}` : 'No run on this DOCK')}</span>
                        <span className="col-span-2 font-mono text-[0.6rem] text-muted-foreground max-[760px]:text-xs">{ticket.files} files · {when(ticket.updatedAt)}</span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          </section>
        ) : (
          <section className={cn('flex min-w-0 flex-col border-r border-border bg-surface-0', selected && 'max-[760px]:hidden')} aria-label="Files">
            <div className="flex flex-col gap-1 border-b border-border px-3 py-2.5">
              <button type="button" onClick={() => { setPicked(null); setSelected(null); }} className="inline-flex items-center gap-1.5 self-start border-0 bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground max-[760px]:min-h-11"><ArrowLeft size={13} aria-hidden="true" />Semua tiket</button>
              <div className="flex flex-wrap items-center gap-2">
                <b className="font-mono text-sm text-accent">{picked}</b>
                {pickedRun && <span className={cn('rounded-xs px-1.5 py-px font-mono text-[0.6rem] font-bold', STAGE_TONE[pickedRun.stage] ?? 'bg-surface-2 text-secondary-foreground')}>{stageLabel(pickedRun.stage)}</span>}
                {pickedTicket && sprintOf(pickedTicket) && <span className="font-mono text-[0.62rem] text-muted-foreground">{sprintOf(pickedTicket)}</span>}
                {onTicketClick && <button type="button" onClick={() => onTicketClick(picked)} className="ml-auto border-0 bg-transparent p-0 text-[0.7rem] font-semibold text-accent hover:underline">Detail tiket</button>}
              </div>
              {pickedRun?.title && <p className="line-clamp-2 text-[0.74rem] text-secondary-foreground">{pickedRun.title}</p>}
            </div>
            <nav className="max-h-[calc(100dvh-16rem)] flex-1 overflow-y-auto py-1.5 max-[760px]:max-h-none" aria-label="Folders">
              {files === null && <p className="px-4 py-4 text-sm text-muted-foreground" role="status">Loading files...</p>}
              {dir('Dokumen')}
              {entry(CONTRACT_ENTRY, FileSignature, 'Kontrak', contractFiles(files ?? []).length ? 'md' : 'belum ada')}
              {entry(TRACE_ENTRY, Route, 'Tiket → kode', coverageText(trace))}
              <button type="button" onClick={() => setSelected(LOG_ENTRY)} aria-current={selected === LOG_ENTRY ? 'true' : undefined} style={{ paddingLeft: '24px' }} className={cn('flex w-full items-center gap-2 border-0 bg-transparent py-1.5 pr-3.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1 max-[760px]:min-h-11', selected === LOG_ENTRY && 'bg-surface-1 text-foreground')}>
                <ScrollText size={14} aria-hidden="true" className="flex-none" /><span>Log eksekusi</span><span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">{run?.failures?.length ? `${run.failures.length} gagal` : 'execution'}</span>
              </button>
              {tree.docs.map((item) => entry(item.path, iconFor(item), <>{item.path}{item.generated && <span className="ml-1.5 rounded-xs border border-border px-1 font-mono text-[0.54rem] text-muted-foreground">gen</span>}</>, formatSize(item.size)))}
              {tree.artifacts.length > 0 && <>{dir('Artifacts')}{tree.artifacts.map(folderEntry)}</>}
              {dir('Perubahan kode')}
              {(repos.length ? repos : [null]).map((repo) => entry(pullEntry(repo), GitPullRequest, repo ?? 'Pull request tiket ini', 'diff'))}
              {tree.other.map(folderEntry)}
            </nav>
          </section>
        )}

        <section className={cn('flex min-w-0 flex-col', !selected && 'max-[760px]:hidden')} aria-label="File">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.72rem]">
              <button type="button" onClick={() => setSelected(null)} className="hidden border-0 bg-transparent p-0 text-muted-foreground max-[760px]:inline-flex max-[760px]:min-h-11 max-[760px]:min-w-11 max-[760px]:items-center"><ArrowLeft size={12} aria-hidden="true" /></button>
              {picked && selected !== KAMUS_ENTRY && <span className="text-muted-foreground">{picked} /</span>}<span className="truncate">{title}</span>
            </span>
            <span className="flex items-center gap-3 font-mono text-[0.62rem] text-muted-foreground max-[760px]:text-xs">
              {file && <span>changed {when(file.updatedAt)}</span>}
              {file && picked && <a href={fileUrl(picked, file.path, true)} className="inline-flex items-center gap-1 text-secondary-foreground hover:text-foreground"><Download size={12} aria-hidden="true" />Download</a>}
            </span>
          </div>
          <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto max-[760px]:max-h-none">
            {selected === KAMUS_ENTRY
              ? (kamus === undefined
                ? <p className="p-6 text-sm text-muted-foreground" role="status">Loading {KAMUS_FILE}...</p>
                : kamus
                  ? <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground"><Markdown text={withoutComments(kamus)} /></div>
                  : <p className="p-6 text-sm text-muted-foreground">Kamus pengucapan belum ada. Taruh {KAMUS_FILE} di root blackboard.</p>)
              : picked && selected === LOG_ENTRY
              ? <><ExecLog ticket={picked} run={run} timeline={run?.timeline ?? null} /><LogView ticket={picked} /></>
              : picked && selected === TRACE_ENTRY
              ? <AcMap trace={trace} loading={rawTrace === null} files={patches} onOpenRef={openRef} />
              : picked && selected === CONTRACT_ENTRY
              ? <ContractView ticket={picked} files={files ?? []} run={run} summary={summary} trace={trace} demoUrl={jiraTicket?.demoLink?.url ?? null} figmaUrl={jiraTicket?.figmaUrl ?? null} storyboard={storyboard} />
              : picked && isPullEntry(selected)
              ? <div className="p-4"><CodeChanges key={selected} ticketKey={picked} repo={pullRepo(selected)} onRepo={(repo) => setSelected(pullEntry(repo))} trace={trace} focusPath={focus} onSettings={onNavigate ? () => onNavigate('/settings') : undefined} /></div>
              : picked
              ? <FileView ticket={picked} file={file} folder={folder ? { name: folder.folder, files: folder.files } : null} onPick={setSelected} />
              : (
                <div className="grid h-full min-h-[320px] place-items-center text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2"><ClipboardList size={28} aria-hidden="true" /><p className="text-sm">Pick a ticket to read its blackboard.</p></div>
                </div>
              )}
          </div>
        </section>
      </div>
    </Page>
  );
};

export default BlackboardPage;
