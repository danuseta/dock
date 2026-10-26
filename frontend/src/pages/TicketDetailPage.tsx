import React, { useCallback, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  ClipboardList,
  ExternalLink,
  Figma,
  GitBranch,
  Link2,
  MessagesSquare,
  MoreVertical,
  RefreshCw,
  X,
} from 'lucide-react';
import { GET_DASHBOARD, GET_ORCHESTRATION, GET_TICKET_DETAIL_CORE, GET_TICKET_DETAIL_ENRICHMENT } from '../graphql/queries';
import { stageLabel, type AgentRun } from '../agents/runs';
import { machineOf } from '../chat/messages';
import { useAnswerTicket } from '../chat/useAnswerTicket';
import { useOpenForTicket } from '../chat/useOpenForTicket';
import { DependencyDialog } from '../components/ticket/DependencyDialog';
import { NeedsYouCard } from '../components/ticket/NeedsYouCard';
import { StackedOnBadge } from '../components/ticket/StackedOnBadge';
import { MENU_WIDTH, TicketMenu, type TicketMenuTarget } from '../components/ticket/TicketMenu';
import { useTicketWork } from '../components/ticket/useTicketWork';
import { APPROVE_REVIEW, SAVE_DEMO_LINK, SEND_TO_DISCORD, CHECK_CONFLICTS } from '../graphql/mutations';
import { PRBadge } from '../components/PRBadge';
import { ConflictModal } from '../components/ConflictModal';
import { DiscordPreviewModal } from '../components/DiscordPreviewModal';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Toast } from '../components/Toast';
import { Button, Card, ConfirmDialog, Input, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { monitorsOnly, useDockMode } from '../lib/dockMode';
import { CACHED_QUERY_OPTIONS, DETAIL_QUERY_OPTIONS, displayAssignee } from '../lib/queryPolicy';
import { NO_DESCRIPTION, RUN_STATE_LABEL, dependencyChoices, isLongDescription, jiraAcLines, needsYou, runState, type NeedItem } from '../lib/ticketDetail';
import { getPassLabels } from '../lib/ticketApprovals';
import { blackboardFileHref, blackboardHref, folderOf, useBlackboardFiles } from '../lib/blackboard';
import { nextWorkOrder } from '../lib/workOrder';

interface TicketDetailPageProps {
  ticketKey: string;
  onBack?: () => void;
  onNavigate: (path: string) => void;
}

const RUN_TONE: Record<ReturnType<typeof runState>, string> = {
  none: 'text-muted-foreground',
  waiting: 'text-status-warn',
  stalled: 'text-status-conflict',
  running: 'text-status-warn',
  pr: 'text-sky-200',
  finished: 'text-status-merged',
};

/** Acceptance criteria past this many start folded, like the description. */
const AC_FOLD = 3;

const AC_ICON = {
  PASS: <Check size={14} className="mt-0.5 text-status-merged" aria-hidden="true" />,
  FAIL: <X size={14} className="mt-0.5 text-status-conflict" aria-hidden="true" />,
};
const AC_TODO = <Circle size={10} className="mx-auto mt-1.5 text-muted-foreground" aria-hidden="true" />;

/** One text field of the Jira ticket, folded to three lines when it is long. */
const JiraField: React.FC<{ title: string; text: string }> = ({ title, text }) => {
  const [open, setOpen] = useState(false);
  const fold = isLongDescription(text, 3);
  return (
    <section className="min-w-0">
      <h2 className="mb-1.5 flex items-center gap-3 font-display text-sm font-bold">
        {title}
        {fold && <button type="button" className="text-xs font-semibold text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Show less' : 'Show all'}</button>}
      </h2>
      <div className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed text-secondary-foreground', fold && !open && 'line-clamp-3')}>{text}</div>
    </section>
  );
};

/** One label and value in the ticket's property list. */
const Property: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="py-1.5 text-xs text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-sm">{children}</dd>
  </>
);

const propertyButton = '-ml-2 rounded-xs border border-transparent px-2 py-1 text-left text-sm font-semibold hover:border-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:min-h-11';
const sectionTitle = 'mb-1.5 mt-4 border-t border-border pt-3 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketKey, onBack, onNavigate }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: coreData, loading: coreLoading, error: coreError, refetch: refetchCore } = useQuery(GET_TICKET_DETAIL_CORE, {
    ...DETAIL_QUERY_OPTIONS,
    variables: { key: ticketKey },
    pollInterval: 30000,
  });
  const { data: cachedDashboardData } = useQuery(GET_DASHBOARD, {
    fetchPolicy: 'cache-only',
    returnPartialData: true,
  });
  const cachedTickets = cachedDashboardData?.dashboard?.flatMap((group: any) => group.tickets || []) ?? [];
  const cachedTicket = cachedTickets.find((item: any) => item.key?.toUpperCase() === ticketKey.toUpperCase());
  const coreTicketFromResponse = coreData?.ticketDetail?.key?.toUpperCase() === ticketKey.toUpperCase()
    ? coreData.ticketDetail
    : undefined;
  const coreTicket = coreTicketFromResponse || (coreData?.ticketDetail === undefined ? cachedTicket : undefined);
  const { data: enrichmentData, loading: enrichmentLoading, error: enrichmentError, refetch: refetchEnrichment } = useQuery(GET_TICKET_DETAIL_ENRICHMENT, {
    ...DETAIL_QUERY_OPTIONS,
    variables: { key: ticketKey },
    skip: !coreTicket,
  });
  const [saveDemoLink] = useMutation(SAVE_DEMO_LINK);
  const [sendToDiscord, { loading: sendingDiscord }] = useMutation(SEND_TO_DISCORD);
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const [approveReview, { loading: approving }] = useMutation(APPROVE_REVIEW, { refetchQueries: ['GetOrchestration', 'GetTicketDetailCore'] });
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approval, setApproval] = useState<Array<{ name: string; ok: boolean; detail: string }> | null>(null);
  const work = useTicketWork(['GetTicketDetailCore']);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [showDependency, setShowDependency] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [editingDemo, setEditingDemo] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [workOrder, setWorkOrder] = useState('');
  const [menu, setMenu] = useState<TicketMenuTarget | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [acOpen, setAcOpen] = useState(false);
  const [jiraAcOpen, setJiraAcOpen] = useState(false);
  const { data: runData } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, pollInterval: 30000 });
  const run: AgentRun | null = runData?.orchestration?.key?.toUpperCase() === ticketKey.toUpperCase() ? runData.orchestration : null;
  const { openForTicket, opening: openingSession, error: sessionError } = useOpenForTicket();
  const { answer, sending: answering } = useAnswerTicket();
  const monitoring = monitorsOnly(useDockMode());
  const blackboardFiles = useBlackboardFiles(ticketKey, !monitoring);
  const closeMenu = useCallback(() => setMenu(null), []);

  const renderBackButton = () => onBack ? (
    <button onClick={onBack} className="inline-flex min-h-6 max-[760px]:min-h-11 items-center gap-2 font-mono text-[0.82rem] font-semibold text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Dashboard</span>
      <span className="opacity-40">/</span>
      <span className="text-foreground">{ticketKey}</span>
    </button>
  ) : null;

  const enrichedTicket = enrichmentData?.ticketDetail?.key?.toUpperCase() === ticketKey.toUpperCase()
    ? enrichmentData.ticketDetail
    : undefined;
  // A free form card has no Jira issue: its page is built from the run alone.
  const ticket = coreTicket
    ? { ...coreTicket, ...(enrichedTicket || {}) }
    : run?.kind === 'card' ? { key: run.key, title: run.title, labels: [], pullRequests: [] as any[] } as any : undefined;

  if (coreLoading && !ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <LoadingSkeleton />
    </Page>
  );
  if (coreError && !ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <Card className="border-status-conflict text-status-conflict" role="alert">
        <p>Error loading ticket details: {coreError.message}</p>
        <Button className="mt-3" variant="primary" onClick={() => void refetchCore()}>Retry</Button>
      </Card>
    </Page>
  );

  if (!ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <Card>Ticket "{ticketKey}" not found in current workspace.</Card>
    </Page>
  );

  const refetchAll = async () => {
    await Promise.all([refetchCore(), refetchEnrichment()]);
  };

  const report = (message: string, type: 'success' | 'error') => setToast({ message, type });

  const handleSaveWorkOrder = async () => {
    setEditingOrder(false);
    if (!workOrder || (ticket.workOrderSource === 'dock' && String(ticket.workOrder) === workOrder)) return;
    try {
      report(await work.saveOrder(ticketKey, Number(workOrder)), 'success');
    } catch (err: any) {
      report(err.message || 'Failed to save the work order', 'error');
    }
  };

  const handleToggleManual = async (manual: boolean) => {
    if (manual === Boolean(ticket.workManual)) return;
    try {
      report(await work.setManual(ticketKey, manual), 'success');
    } catch (err: any) {
      report(err.message || 'Failed to update manual work', 'error');
    }
  };

  const handleInspect = async (owner: string, repo: string, pullNumber: number) => {
    try {
      const res = await checkConflicts({ variables: { owner, repo, pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) {
        setConflictMessage(res.data.checkConflicts.message || 'File conflict in target branch.');
        setShowConflictModal(true);
      } else {
        setToast({ message: 'No conflicts detected! Clean merge status.', type: 'success' });
      }
    } catch (err) {
      setToast({ message: 'Failed to inspect file conflicts', type: 'error' });
    }
  };

  const handleSaveDemo = async () => {
    if (!demoUrl) return;
    try {
      const saved = await saveDemoLink({ variables: { ticketKey, url: demoUrl } });
      if (saved.data?.saveDemoLink !== true) throw new Error('Demo recording link was not stored');
      await refetchEnrichment();
      setToast({ message: 'Demo recording link saved permanently!', type: 'success' });
      setDemoUrl('');
      setEditingDemo(false);
    } catch (err) {
      setToast({ message: 'Failed to save demo recording link', type: 'error' });
    }
  };

  const handleDiscordBroadcast = () => {
    setShowDiscordModal(true);
  };

  const handleConfirmDiscord = async (customMessage: string, threadId?: string, threadName?: string) => {
    try {
      const res = await sendToDiscord({ variables: { ticketKey, customMessage, threadId, threadName } });
      if (res.data?.sendToDiscord) {
        setToast({ message: 'Summary posted to Discord. Tickets before review moved to PR Review.', type: 'success' });
        setShowDiscordModal(false);
        await refetchAll();
      } else {
        setToast({ message: 'Failed to post summary to Discord', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Discord webhook transmission error', type: 'error' });
    }
  };

  const handleManualRefetch = async () => {
    setIsRefreshing(true);
    try {
      await refetchEnrichment();
      setToast({ message: 'Pull requests synchronized successfully!', type: 'success' });
    } catch (e) {
      setToast({ message: 'Failed to synchronize pull requests', type: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  };

  const needs = needsYou({ run, pullRequests: ticket.pullRequests });
  const handleNeed = (item: NeedItem) => {
    if (item.kind === 'question') void openForTicket(ticket.key);
    else if (item.kind === 'sous') onNavigate(`/decisions?ticket=${encodeURIComponent(ticket.key)}`);
    else if (item.kind === 'ac') {
      setAcOpen(true);
      document.getElementById('acceptance-criteria')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else {
      const pr = item.kind === 'conflict'
        ? ticket.pullRequests?.find((candidate: any) => `conflict-${candidate.id ?? candidate.repo}` === item.id)
        : ticket.pullRequests?.[0];
      if (item.kind === 'conflict' && pr) void handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number);
      else if (pr?.url) window.open(pr.url, '_blank', 'noreferrer');
    }
  };
  const description = ticket.description && ticket.description !== NO_DESCRIPTION ? ticket.description : null;
  const jiraAc = jiraAcLines(ticket.acceptanceCriteria);
  const blockedHere = monitoring ? 'This DOCK only monitors. Answer on the workspace DOCK.' : null;

  const handleApprove = async () => {
    try {
      const res = await approveReview({ variables: { ticketKey: ticket.key } });
      const steps = res.data?.approveReview ?? [];
      setApproval(steps);
      const failed = steps.filter((step: { ok: boolean }) => !step.ok).length;
      setToast({ message: failed ? `${failed} of ${steps.length} approval steps failed. See the list on the page.` : 'Approved: Jira Pass label added and the pull requests approved.', type: failed ? 'error' : 'success' });
    } catch (approveError) {
      setToast({ message: approveError instanceof Error ? approveError.message : 'The approval could not be sent', type: 'error' });
    } finally {
      setConfirmApprove(false);
    }
  };

  const state = runState(run);
  const acItems = run?.ac ?? [];
  const passLabels = getPassLabels(ticket.labels);
  const assignee = displayAssignee(ticket.assignee);
  const relation = coreData?.ticketRelationGroup;
  const enrichedRelation = enrichmentData?.ticketRelationGroup;
  const relationTickets = enrichedRelation?.tickets?.length ? enrichedRelation.tickets : [ticket];
  const isCombinedAnnouncement = relationTickets.length > 1;
  const primaryTicket = relationTickets.find((item: any) => item.key === relation?.primaryKey) || relationTickets[0];
  const announcementTicket = { key: primaryTicket.key, title: primaryTicket.title, url: primaryTicket.url };
  const announcementPullRequests = [...new Map(relationTickets
    .flatMap((item: any) => item.pullRequests || [])
    .map((pullRequest: any) => [pullRequest.url || pullRequest.id, pullRequest])).values()];
  const demoEntries = relationTickets
    .map((item: any) => ({ key: item.key, url: item.demoLink?.url || (item.key === ticket.key ? demoUrl : '') }))
    .filter((entry: any) => entry.url);
  const uniqueDemoUrls = [...new Set(demoEntries.map((entry: any) => entry.url))];
  const announcementDemoUrl = uniqueDemoUrls.length === 1
    ? `- **${relationTickets.map((item: any) => item.key).join(' + ')}:** ${uniqueDemoUrls[0]}`
    : demoEntries.map((entry: any) => `- **${entry.key}:** ${entry.url}`).join('\n');
  const ticketChoices = dependencyChoices((coreData?.dashboard || []).flatMap((group: any) => group.tickets || []), ticket.key);

  return (
    <Page width="full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {renderBackButton()}
        <div className="flex flex-wrap items-center gap-2">
          {ticket.url && <a href={ticket.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-border-glow max-[760px]:h-11"><ExternalLink size={15} aria-hidden="true" />Jira</a>}
          {ticket.figmaUrl && <a href={ticket.figmaUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-border-glow max-[760px]:h-11"><Figma size={15} aria-hidden="true" />Figma</a>}
          {run?.kind === 'review' && (run.approved
            ? <Button className="max-[760px]:h-11" disabled title="Your Jira Pass label is on the ticket and its pull requests are approved"><Check size={15} aria-hidden="true" />Approved</Button>
            : <Button variant="primary" className="max-[760px]:h-11" onClick={() => setConfirmApprove(true)} disabled={approving} title="Adds your Jira Pass label and approves the open pull requests on GitHub"><Check size={15} aria-hidden="true" />{approving ? 'Approving...' : 'Approve'}</Button>)}
          {blackboardFiles && <Button className="max-[760px]:h-11" onClick={() => onNavigate(blackboardHref(ticket.key))}><ClipboardList size={15} aria-hidden="true" />Blackboard</Button>}
          <Button className="max-[760px]:h-11" onClick={() => void openForTicket(ticket.key)} disabled={openingSession}><MessagesSquare size={15} aria-hidden="true" />{openingSession ? 'Opening...' : 'Session'}</Button>
          <Button
            className="border-status-discord bg-status-discord text-white hover:bg-status-discord/80 max-[760px]:h-11"
            title={isCombinedAnnouncement ? `One combined Discord announcement for ${relationTickets.map((item: any) => item.key).join(' + ')}` : 'Send status, PR checks and the demo link to Discord'}
            onClick={handleDiscordBroadcast}
          >
            {isCombinedAnnouncement ? `Broadcast ${relationTickets.length}` : 'Broadcast'}
          </Button>
          <Button
            className="w-9 px-0 max-[760px]:h-11 max-[760px]:w-11"
            aria-label={`Actions for ${ticket.key}`}
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({ key: ticket.key, x: box.right - MENU_WIDTH, y: box.bottom + 4, sheet: window.matchMedia('(max-width: 760px)').matches });
            }}
          >
            <MoreVertical size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {sessionError && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{sessionError}</Card>}
      {approval && (
        <Card className="mb-4" role="status">
          <h2 className="mb-1 font-display text-sm font-bold">Approval</h2>
          <ul className="flex flex-col gap-0.5">
            {approval.map((step) => (
              <li key={step.name} className="flex flex-wrap items-baseline gap-2 text-sm">
                {step.ok ? <Check size={14} className="shrink-0 text-status-merged" aria-hidden="true" /> : <X size={14} className="shrink-0 text-status-conflict" aria-hidden="true" />}
                <span className="font-semibold">{step.name}</span>
                <span className={cn('min-w-0 break-words text-xs', step.ok ? 'text-muted-foreground' : 'text-status-conflict')}>{step.ok ? '' : 'Failed: '}{step.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-8 max-[1000px]:grid-cols-1 max-[1000px]:gap-6">
        <main className="flex min-w-0 flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs text-muted-foreground">
              <span className="rounded-xs border border-accent/30 bg-accent-dim px-2 py-0.5 text-sm font-extrabold text-accent">{ticket.key}</span>
              {ticket.status && <PRBadge status={ticket.status} />}
              {ticket.sprintName && ticket.sprintName !== 'No Sprint' && <span className={cn(ticket.sprintState !== 'CLOSED' && 'text-status-merged')}>{ticket.sprintName}</span>}
              {run?.stackedOn && <StackedOnBadge stack={run.stackedOn} />}
            </div>
            <h1 className="mt-2 text-balance font-display text-[1.6rem] leading-snug font-bold">{ticket.title}</h1>
          </div>

          <NeedsYouCard
            items={needs}
            onAction={handleNeed}
            answering={answering}
            answerBlocked={blockedHere}
            onAnswer={async (text) => {
              try {
                const where = await answer(ticket.key, text);
                setToast({ message: `Sent to ${where}.`, type: 'success' });
              } catch (answerError) {
                setToast({ message: answerError instanceof Error ? answerError.message : 'The answer could not be sent', type: 'error' });
                throw answerError;
              }
            }}
          />

          <div className="grid grid-cols-2 items-start gap-8 max-[1280px]:grid-cols-1 max-[1280px]:gap-4">
            <div className="flex min-w-0 flex-col gap-4">
              {ticket.userStory && <JiraField title="User Story" text={ticket.userStory} />}
              {ticket.problemDefinition && <JiraField title="Problem Definition" text={ticket.problemDefinition} />}
              {(description || (!ticket.userStory && !ticket.problemDefinition)) && <JiraField title="Description" text={description || NO_DESCRIPTION} />}
            </div>

            <section id="acceptance-criteria" className="min-w-0 scroll-mt-6">
              <h2 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-display text-sm font-bold">
                Acceptance criteria
                {run
                  ? <span className="font-body text-xs font-medium text-muted-foreground">{run.acPassed} of {run.acTotal} passing</span>
                  : jiraAc.length > 0 && <span className="font-body text-xs font-medium text-muted-foreground">{jiraAc.length} from Jira</span>}
                {(run ? acItems.length : jiraAc.length) > AC_FOLD && <button type="button" className="text-xs font-semibold text-accent hover:underline" aria-expanded={acOpen} onClick={() => setAcOpen((open) => !open)}>{acOpen ? 'Show less' : `Show all ${run ? acItems.length : jiraAc.length}`}</button>}
                {run && ticket.acceptanceCriteria && <button type="button" className="text-xs font-semibold text-accent hover:underline" aria-expanded={jiraAcOpen} onClick={() => setJiraAcOpen((open) => !open)}>{jiraAcOpen ? 'Hide Jira original' : 'Jira original'}</button>}
              </h2>
              {run ? (
                acItems.length === 0 ? (
                  <p className="text-pretty text-sm text-muted-foreground">No acceptance criteria recorded yet.</p>
                ) : (
                  <ol className="flex flex-col">
                    {(acOpen ? acItems : acItems.slice(0, AC_FOLD)).map((item) => (
                      <li key={item.n} className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 py-1 text-sm" title={item.evidence || undefined}>
                        {AC_ICON[item.state as keyof typeof AC_ICON] ?? AC_TODO}
                        <span className="text-pretty">
                          <span className="sr-only">{item.state}: </span>
                          {item.text || `AC ${item.n}`}
                          {item.state === 'FAIL' && item.evidence && <span className="ml-2 font-mono text-[0.7rem] text-status-conflict">{item.evidence}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                )
              ) : jiraAc.length === 0 ? (
                <p className="text-pretty text-sm text-muted-foreground">Not filled in Jira.</p>
              ) : (
                <ol className="flex flex-col">
                  {(acOpen ? jiraAc : jiraAc.slice(0, AC_FOLD)).map((line, index) => (
                    <li key={index} className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 py-1 text-sm">
                      {AC_TODO}
                      <span className="text-pretty text-secondary-foreground">{line}</span>
                    </li>
                  ))}
                </ol>
              )}
              {run && jiraAcOpen && ticket.acceptanceCriteria && (
                <div className="mt-2 whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-1 p-3 text-xs leading-relaxed text-secondary-foreground">{ticket.acceptanceCriteria}</div>
              )}
            </section>
          </div>
        </main>

        <aside className="min-w-0 border-l border-border pl-6 max-[1000px]:border-l-0 max-[1000px]:border-t max-[1000px]:pl-0 max-[1000px]:pt-4">
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3">
            <Property label="Agent">
              <span className={cn('flex items-center gap-1.5 whitespace-nowrap font-semibold', RUN_TONE[state])}>
                <i className={cn('size-1.5 rounded-full bg-current', state === 'running' && 'animate-pulse motion-reduce:animate-none')} aria-hidden="true" />
                {RUN_STATE_LABEL[state]}{run && state !== 'pr' ? ` · ${stageLabel(run.stage)}` : ''}
              </span>
              {run && <span className="font-mono text-[0.7rem] text-muted-foreground">{machineOf(run)} · <button type="button" className="font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => onNavigate(`/agents?run=${encodeURIComponent(run.key)}`)}>View run →</button></span>}
            </Property>
            {run?.stage === 'blocked' && <><dt className="sr-only">Blocked</dt><dd className="col-span-2 pb-1 text-pretty text-xs text-status-conflict">Blocked: {run.note || run.waiting || 'see the session for the reason'}.</dd></>}
            {!monitoring && <>
            <Property label="Order">
              {editingOrder ? (
                <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleSaveWorkOrder(); }}>
                  <Input
                    autoFocus
                    className="h-8 w-20 font-mono"
                    inputMode="numeric"
                    aria-label={`Work order for ${ticket.key}`}
                    value={workOrder}
                    onChange={(event) => setWorkOrder(event.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(event) => { if (event.key === 'Escape') setEditingOrder(false); }}
                    onBlur={() => setEditingOrder(false)}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className={cn(propertyButton, ticket.workOrder == null && 'font-normal text-muted-foreground')}
                  title={ticket.workOrderSource === 'label' ? 'From the Jira label; a number set here wins over it' : ticket.workOrderSource === 'dock' ? 'Set in DOCK; never written to Jira' : 'No number: taken after the numbered tickets'}
                  onClick={() => { setWorkOrder(ticket.workOrder != null ? String(ticket.workOrder) : ''); setEditingOrder(true); }}
                  disabled={work.busy}
                >
                  {ticket.workOrder != null ? `#${ticket.workOrder}${ticket.workOrderSource === 'label' ? ' · Jira label' : ''}` : 'Set order'}
                </button>
              )}
            </Property>
            <Property label="Mode">
              <span className="inline-flex overflow-hidden rounded-sm border border-border" role="group" aria-label="How the ticket gets worked">
                {[{ manual: false, label: 'Cron' }, { manual: true, label: 'Manual' }].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={Boolean(ticket.workManual) === option.manual}
                    className={cn('h-7 px-3 text-xs font-semibold max-[760px]:h-11', Boolean(ticket.workManual) === option.manual ? 'bg-surface-hover text-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground')}
                    onClick={() => void handleToggleManual(option.manual)}
                    disabled={work.busy}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            </Property>
            </>}
            <Property label="Depends on">
              <button type="button" className={cn(propertyButton, 'flex items-center gap-1.5', !relation?.dependsOnKey && 'font-normal text-muted-foreground')} onClick={() => setShowDependency(true)}>
                <Link2 size={13} aria-hidden="true" />{relation?.dependsOnKey || 'None'}
              </button>
            </Property>
            <Property label="Assignee">{assignee || <span className="text-muted-foreground">Unassigned</span>}</Property>
            <Property label="Points">{ticket.storyPoints ?? <span className="text-muted-foreground">—</span>}</Property>
            <Property label="Approved">
              {passLabels.length > 0
                ? <span className="flex flex-wrap gap-1">{passLabels.map((label) => <span key={label} className="rounded-xs bg-status-merged-bg px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-status-merged">{label}</span>)}</span>
                : <span className="text-muted-foreground">—</span>}
            </Property>
          </dl>

          <h2 className={cn(sectionTitle, 'flex items-center justify-between')}>
            Pull requests
            <button type="button" className="rounded-xs p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => void handleManualRefetch()} disabled={isRefreshing} aria-label="Refresh pull requests from GitHub" title="Refresh PRs from GitHub">
              <RefreshCw size={12} className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            </button>
          </h2>
          {enrichmentLoading && !enrichmentData && <p className="font-mono text-xs text-muted-foreground">Loading pull requests...</p>}
          {enrichmentError && <p className="font-mono text-xs text-status-conflict">Pull request details are temporarily unavailable.</p>}
          {!enrichmentLoading && !enrichmentError && !ticket.pullRequests?.length && <p className="text-sm text-muted-foreground">No pull requests linked.</p>}
          <ul className="flex flex-col gap-1">
            {ticket.pullRequests?.map((pr: any) => {
              const isConflict = pr.status?.toUpperCase() === 'CONFLICT';
              return (
                <li key={pr.id} className={cn('-mx-2 rounded-xs px-2 py-1.5', isConflict ? 'bg-status-conflict-bg' : 'hover:bg-surface-2')}>
                  <div className="flex items-center justify-between gap-2">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs font-bold text-accent hover:underline" title={pr.title}>{pr.repo}#{pr.pullNumber || pr.number}</a>
                    {isConflict
                      ? <Button size="sm" variant="danger" onClick={() => void handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number)}><AlertTriangle size={12} aria-hidden="true" />Inspect</Button>
                      : <PRBadge status={pr.status} />}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[0.68rem] text-muted-foreground" title={`${pr.headBranch} → ${pr.baseBranch}`}>
                    <GitBranch size={11} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{pr.headBranch || 'feature'} → {pr.baseBranch || 'main'}</span>
                  </p>
                </li>
              );
            })}
          </ul>

          {blackboardFiles && (() => {
            const latest = blackboardFiles.reduce((at, file) => (file.updatedAt > at ? file.updatedAt : at), '');
            const shots = blackboardFiles.filter((file) => folderOf(file.path) === 'screenshots').length;
            const quick = [
              ...['NOW.md', 'review.md'].filter((name) => blackboardFiles.some((file) => file.path === name)).map((name) => ({ label: name, href: blackboardFileHref(ticket.key, name) })),
              ...(shots ? [{ label: `screenshots · ${shots}`, href: blackboardFileHref(ticket.key, 'screenshots') }] : []),
            ];
            return (
              <>
                <h2 className={sectionTitle}>Blackboard</h2>
                <p className="font-mono text-[0.68rem] text-muted-foreground">{blackboardFiles.length} files{latest ? ` · changed ${new Date(latest).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                {quick.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {quick.map((link) => <button key={link.label} type="button" onClick={() => onNavigate(link.href)} className="border-0 bg-transparent p-0 font-mono text-xs text-accent hover:underline">{link.label}</button>)}
                  </p>
                )}
                <button type="button" onClick={() => onNavigate(blackboardHref(ticket.key))} className="mt-1.5 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs text-secondary-foreground hover:text-foreground">See all<ArrowRight size={12} aria-hidden="true" /></button>
              </>
            );
          })()}

          <h2 className={sectionTitle}>Demo</h2>
          {editingDemo ? (
            <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleSaveDemo(); }}>
              <Input autoFocus aria-label="Demo recording URL" className="h-8 min-w-0 flex-1 font-mono text-xs" placeholder="https://loom.com/share/..." value={demoUrl} onChange={(event) => setDemoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingDemo(false); }} />
              <Button size="sm" variant="primary" type="submit" disabled={!demoUrl}>Save</Button>
            </form>
          ) : ticket.demoLink?.url ? (
            <div className="flex items-center justify-between gap-2">
              <a href={ticket.demoLink.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-semibold text-status-merged hover:underline"><ExternalLink size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{ticket.demoLink.url.replace(/^https?:\/\//, '')}</span></a>
              <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => { setDemoUrl(ticket.demoLink.url); setEditingDemo(true); }}>Edit</button>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setEditingDemo(true)}>+ Add link</button>
          )}
        </aside>
      </div>

      {menu && (
        <TicketMenu
          target={menu}
          ticket={ticket}
          nextOrder={nextWorkOrder(cachedTickets, ticket.key)}
          refetchQueries={['GetTicketDetailCore']}
          onSession={() => void openForTicket(ticket.key)}
          onDependency={() => setShowDependency(true)}
          onDone={report}
          onClose={closeMenu}
        />
      )}

      <DependencyDialog
        open={showDependency}
        ticketKey={ticket.key}
        dependsOnKey={relation?.dependsOnKey}
        primaryKey={relation?.primaryKey}
        groupKeys={relation?.ticketKeys ?? []}
        choices={ticketChoices}
        onClose={() => setShowDependency(false)}
        onDone={report}
      />

      <ConfirmDialog
        open={confirmApprove}
        title={`Approve ${ticket.key}?`}
        description="DOCK adds your Jira Pass label to the reviewed ticket and submits an Approve review on each of its open pull requests on GitHub. The review run then moves to done."
        confirmLabel="Approve"
        busyLabel="Approving..."
        busy={approving}
        onConfirm={() => void handleApprove()}
        onCancel={() => setConfirmApprove(false)}
      />

      <ConflictModal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        message={conflictMessage}
      />

      <DiscordPreviewModal
        isOpen={showDiscordModal}
        onClose={() => setShowDiscordModal(false)}
        onConfirm={handleConfirmDiscord}
        ticket={announcementTicket}
        relatedTickets={relationTickets.map((item: any) => ({ key: item.key, title: item.title, url: item.url }))}
        pullRequests={announcementPullRequests as any[]}
        demoUrl={announcementDemoUrl || undefined}
        messageTemplate={coreData?.settings?.discordMessageTemplate}
        loading={sendingDiscord}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default TicketDetailPage;
