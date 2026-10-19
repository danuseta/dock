import React, { useEffect, useState } from 'react';
import { isPlayableVideo } from '../lib/demoVideos';
import { useQuery, useMutation } from '@apollo/client';
import { 
  GitPullRequest, 
  Video, 
  ExternalLink, 
  Save, 
  AlertTriangle, 
  ArrowLeft, 
  RefreshCw, 
  GitCommit, 
  FileCode, 
  GitBranch, 
  FileText,
  ArrowRight,
  Link2,
  ListOrdered,
  Unlink,
} from 'lucide-react';
import { GET_DASHBOARD, GET_ORCHESTRATION, GET_TICKET_DETAIL_CORE, GET_TICKET_DETAIL_ENRICHMENT } from '../graphql/queries';
import type { AgentRun } from '../agents/runs';
import { useAnswerTicket } from '../chat/useAnswerTicket';
import { useOpenForTicket } from '../chat/useOpenForTicket';
import { AcceptanceCard, AgentRunCard } from '../components/ticket/AgentRunCards';
import { NeedsYouCard } from '../components/ticket/NeedsYouCard';
import { TicketHeader } from '../components/ticket/TicketHeader';
import { CLEAR_TICKET_DEPENDENCY, CLEAR_TICKET_WORK_ORDER, SAVE_DEMO_LINK, SEND_TO_DISCORD, SET_TICKET_DEPENDENCY, SET_TICKET_MANUAL, SET_TICKET_WORK_ORDER, CHECK_CONFLICTS } from '../graphql/mutations';
import { PRBadge } from '../components/PRBadge';
import { ConflictModal } from '../components/ConflictModal';
import { DiscordPreviewModal } from '../components/DiscordPreviewModal';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Toast } from '../components/Toast';
import { Badge, Button, Card, Checkbox, Input, Page, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, DETAIL_QUERY_OPTIONS, displayAssignee } from '../lib/queryPolicy';
import { isLongDescription, needsYou, type NeedItem } from '../lib/ticketDetail';
import { getApprovalLabels } from '../lib/ticketApprovals';

interface TicketDetailPageProps {
  ticketKey: string;
  onBack?: () => void;
}

const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketKey, onBack }) => {
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
  const cachedTicket = cachedDashboardData?.dashboard
    ?.flatMap((group: any) => group.tickets || [])
    .find((item: any) => item.key?.toUpperCase() === ticketKey.toUpperCase());
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
  const [setTicketDependency, { loading: savingDependency }] = useMutation(SET_TICKET_DEPENDENCY);
  const [clearTicketDependency, { loading: clearingDependency }] = useMutation(CLEAR_TICKET_DEPENDENCY);
  const [setTicketWorkOrder, { loading: savingOrder }] = useMutation(SET_TICKET_WORK_ORDER);
  const [clearTicketWorkOrder, { loading: clearingOrder }] = useMutation(CLEAR_TICKET_WORK_ORDER);
  const [setTicketManual, { loading: savingManual }] = useMutation(SET_TICKET_MANUAL);
  const [workOrder, setWorkOrder] = useState('');
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [dependsOnKey, setDependsOnKey] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [activePRTab, setActivePRTab] = useState<Record<string, 'commits' | 'files' | 'none'>>({});
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const { data: runData } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, pollInterval: 30000 });
  const run: AgentRun | null = runData?.orchestration?.key?.toUpperCase() === ticketKey.toUpperCase() ? runData.orchestration : null;
  const { openForTicket, opening: openingSession, error: sessionError } = useOpenForTicket();
  const { answer, sending: answering } = useAnswerTicket();

  useEffect(() => {
    setDependsOnKey(coreData?.ticketRelationGroup?.dependsOnKey || '');
  }, [coreData?.ticketRelationGroup?.dependsOnKey, ticketKey]);

  useEffect(() => {
    setWorkOrder(coreData?.ticketDetail?.workOrder != null ? String(coreData.ticketDetail.workOrder) : '');
  }, [coreData?.ticketDetail?.workOrder, ticketKey]);

  const handleSaveWorkOrder = async () => {
    try {
      await setTicketWorkOrder({ variables: { ticketKey, position: Number(workOrder) } });
      await refetchAll();
      setToast({ message: `${ticketKey} is #${workOrder} in the cron's work order.`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save the work order', type: 'error' });
    }
  };

  const handleClearWorkOrder = async () => {
    try {
      await clearTicketWorkOrder({ variables: { ticketKey } });
      await refetchAll();
      setToast({ message: 'The DOCK work order is removed; a #N Jira label applies again.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to remove the work order', type: 'error' });
    }
  };

  const handleToggleManual = async (manual: boolean) => {
    try {
      await setTicketManual({ variables: { ticketKey, manual } });
      await refetchAll();
      setToast({ message: manual ? `${ticketKey} is worked manually: the cron will not take or resume it.` : `${ticketKey} is back in the cron's queue.`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update manual work', type: 'error' });
    }
  };

  const togglePRTab = (prId: string, tab: 'commits' | 'files') => {
    setActivePRTab(prev => ({
      ...prev,
      [prId]: prev[prId] === tab ? 'none' : tab
    }));
  };

  const renderBackButton = () => onBack ? (
    <button onClick={onBack} className="mb-5 inline-flex min-h-6 max-[760px]:min-h-11 items-center gap-2 font-mono text-[0.82rem] font-semibold text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Dashboard</span>
      <span className="opacity-40">/</span>
      <span className="text-foreground">{ticketKey}</span>
    </button>
  ) : null;

  const enrichedTicket = enrichmentData?.ticketDetail?.key?.toUpperCase() === ticketKey.toUpperCase()
    ? enrichmentData.ticketDetail
    : undefined;
  const ticket = coreTicket
    ? { ...coreTicket, ...(enrichedTicket || {}) }
    : undefined;

  if (coreLoading && !ticket) return (
    <Page width="full">
      {renderBackButton()}
      <LoadingSkeleton />
    </Page>
  );
  if (coreError && !ticket) return (
    <Page width="full">
      {renderBackButton()}
      <Card className="border-status-conflict text-status-conflict" role="alert">
        <p>Error loading ticket details: {coreError.message}</p>
        <Button className="mt-3" variant="primary" onClick={() => void refetchCore()}>Retry</Button>
      </Card>
    </Page>
  );

  if (!ticket) return (
    <Page width="full">
      {renderBackButton()}
      <Card>Ticket "{ticketKey}" not found in current workspace.</Card>
    </Page>
  );

  const refetchAll = async () => {
    await Promise.all([refetchCore(), refetchEnrichment()]);
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
    } catch (err) {
      setToast({ message: 'Failed to save demo recording link', type: 'error' });
    }
  };

  const handleDiscordBroadcast = () => {
    setShowDiscordModal(true);
  };

  const handleSaveDependency = async () => {
    if (!dependsOnKey) return;
    try {
      await setTicketDependency({ variables: { ticketKey, dependsOnKey } });
      await refetchAll();
      setToast({ message: `${ticketKey} now depends on ${dependsOnKey}.`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save ticket dependency', type: 'error' });
    }
  };

  const handleClearDependency = async () => {
    try {
      await clearTicketDependency({ variables: { ticketKey } });
      await refetchAll();
      setDependsOnKey('');
      setToast({ message: 'Ticket dependency removed.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to remove ticket dependency', type: 'error' });
    }
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

  const needs = needsYou({ run, pullRequests: ticket.pullRequests, demoUrl: ticket.demoLink?.url });
  const handleNeed = (item: NeedItem) => {
    if (item.kind === 'question') void openForTicket(ticket.key);
    else if (item.kind === 'ac') document.getElementById('acceptance-criteria')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (item.kind === 'demo') document.getElementById('demo-video')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else {
      const pr = item.kind === 'conflict'
        ? ticket.pullRequests?.find((candidate: any) => `conflict-${candidate.id ?? candidate.repo}` === item.id)
        : ticket.pullRequests?.[0];
      if (item.kind === 'conflict' && pr) void handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number);
      else if (pr?.url) window.open(pr.url, '_blank', 'noreferrer');
    }
  };
  const longDescription = isLongDescription(ticket.description);

  const isOldSprint = ticket.sprintState === 'CLOSED';
  const approvalLabels = getApprovalLabels(ticket.labels);
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
  const ticketChoices = [...new Map((coreData?.dashboard || [])
    .flatMap((group: any) => group.tickets || [])
    .filter((item: any) => item.key !== ticket.key)
    .map((item: any) => [item.key, item])).values()]
    .sort((first: any, second: any) => first.key.localeCompare(second.key));

  return (
    <Page width="full">
      {renderBackButton()}
      <div className="flex flex-col gap-6">
        <TicketHeader
          ticket={ticket}
          run={run}
          approvalLabels={approvalLabels}
          assignee={assignee}
          oldSprint={isOldSprint}
          broadcastLabel={isCombinedAnnouncement ? `Broadcast ${relationTickets.length}` : 'Broadcast'}
          broadcastTitle={isCombinedAnnouncement ? `One combined Discord announcement for ${relationTickets.map((item: any) => item.key).join(' + ')}` : 'Send status, PR checks and the demo link to Discord'}
          sessionOpening={openingSession}
          onBroadcast={handleDiscordBroadcast}
          onSession={() => void openForTicket(ticket.key)}
        />
        {sessionError && <Card className="border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{sessionError}</Card>}

        <NeedsYouCard
          items={needs}
          onAction={handleNeed}
          answering={answering}
          answerBlocked={run?.remote ? 'The other DOCK runs this ticket. Answer it there.' : null}
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

        <div className="grid grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)] items-start gap-6 max-[1100px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-6">
            <AcceptanceCard run={run} />

            <Card>
              <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold"><FileText size={19} className="text-accent" aria-hidden="true" />Description</h2>
                {longDescription && <Button size="sm" variant="ghost" aria-expanded={descriptionOpen} onClick={() => setDescriptionOpen((open) => !open)}>{descriptionOpen ? 'Show less' : 'Show all'}</Button>}
              </div>
              <div className="rounded-sm border border-border bg-surface-0 px-6 py-5 text-sm leading-7 text-secondary-foreground"><div className={cn('whitespace-pre-wrap break-words', longDescription && !descriptionOpen && 'line-clamp-8')}>{ticket.description || 'No detailed description provided in this Jira issue.'}</div></div>
            </Card>

            <div className="grid grid-cols-2 items-start gap-6 max-[1300px]:grid-cols-1">
            <Card>
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-3"><ListOrdered size={19} className="text-accent" aria-hidden="true" /><h2 className="text-balance font-display text-lg font-bold">Work order</h2></div>
              <p className="mb-3 text-pretty text-xs leading-5 text-muted-foreground">
                The cron takes To Do tickets lowest number first. {ticket.workOrderSource === 'label' ? `Now #${ticket.workOrder} from the Jira label.` : ticket.workOrderSource === 'dock' ? 'Set in DOCK; it wins over a Jira label.' : 'No number: taken after the numbered tickets.'} Never written to Jira.
              </p>
              <label htmlFor="work-order" className="mb-1.5 block font-mono text-xs text-muted-foreground">Order of {ticket.key}</label>
              <div className="flex flex-wrap gap-2">
                <Input id="work-order" className="w-24 font-mono" inputMode="numeric" value={workOrder} onChange={(event) => setWorkOrder(event.target.value.replace(/[^0-9]/g, ''))} placeholder="#" disabled={savingOrder || clearingOrder} />
                <Button variant="primary" onClick={handleSaveWorkOrder} disabled={!workOrder || (ticket.workOrderSource === 'dock' && String(ticket.workOrder) === workOrder) || savingOrder || clearingOrder}><Save size={15} aria-hidden="true" />{savingOrder ? 'Saving...' : 'Save order'}</Button>
                {ticket.workOrderSource === 'dock' && <Button variant="danger" onClick={handleClearWorkOrder} disabled={savingOrder || clearingOrder}><Unlink size={15} aria-hidden="true" />{clearingOrder ? 'Removing...' : 'Remove'}</Button>}
              </div>
              <label htmlFor="work-manual" className="mt-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <Checkbox id="work-manual" checked={!!ticket.workManual} onChange={(event) => void handleToggleManual(event.target.checked)} disabled={savingManual} />
                Work by hand (the cron skips it)
              </label>
            </Card>
  
            <Card>
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-3"><Link2 size={19} className="text-accent" aria-hidden="true" /><h2 className="text-balance font-display text-lg font-bold">Ticket Dependency</h2></div>
              <p className="mb-3 text-pretty text-xs leading-5 text-muted-foreground">Link this ticket to its primary work item. Every ticket in the group will share one Discord announcement.</p>
              <label><span className="mb-1.5 block font-mono text-xs text-muted-foreground">{ticket.key} depends on</span><Select value={dependsOnKey || 'NONE'} onValueChange={(value) => setDependsOnKey(value === 'NONE' ? '' : value)} disabled={savingDependency || clearingDependency} aria-label={`${ticket.key} depends on ticket`} options={[{ value: 'NONE', label: 'No dependency' }, ...ticketChoices.map((item: any) => ({ value: item.key, label: `${item.key} — ${item.title}` }))]} /></label>
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="primary" onClick={handleSaveDependency} disabled={!dependsOnKey || dependsOnKey === relation?.dependsOnKey || savingDependency || clearingDependency}><Save size={15} aria-hidden="true" />{savingDependency ? 'Saving...' : 'Save Dependency'}</Button>{relation?.dependsOnKey && <Button variant="danger" onClick={handleClearDependency} disabled={savingDependency || clearingDependency}><Unlink size={15} aria-hidden="true" />{clearingDependency ? 'Removing...' : 'Remove Dependency'}</Button>}</div>
              {relation?.ticketKeys?.length > 1 && <div className="mt-4 rounded-sm border border-border bg-surface-0 p-3"><p className="mb-2 font-mono text-[0.68rem] font-bold text-muted-foreground uppercase">Announcement group</p><div className="flex flex-wrap gap-1.5">{relation.ticketKeys.map((key: string) => <Badge key={key} variant={key === relation.primaryKey ? 'accent' : 'neutral'}>{key}{key === relation.primaryKey ? ' · PRIMARY' : ''}</Badge>)}</div></div>}
            </Card>
  
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6 min-[1101px]:sticky min-[1101px]:top-6">
            <AgentRunCard run={run} opening={openingSession} onSession={() => void openForTicket(ticket.key)} />

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2"><GitPullRequest size={20} className="text-accent" aria-hidden="true" /><h2 className="font-display text-lg font-bold">Linked Pull Requests</h2><Badge>{ticket.pullRequests?.length || 0}</Badge></div>
              <Button size="sm" onClick={handleManualRefetch} disabled={isRefreshing} title="Refresh PRs from GitHub"><RefreshCw size={13} className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{isRefreshing ? 'Syncing...' : 'Refresh'}</Button>
            </div>

            <div className="flex flex-col gap-4">
              {enrichmentLoading && !enrichmentData && <div className="rounded-sm border border-dashed border-border bg-white/[0.01] px-4 py-6 text-center text-muted-foreground"><p className="font-mono text-xs">Loading GitHub pull request details...</p></div>}
              {ticket.pullRequests?.map((pr: any) => {
                const isConflict = pr.status?.toUpperCase() === 'CONFLICT';
                const currentTab = activePRTab[pr.id] || 'none';
                return (
                  <div key={pr.id} className={cn('flex flex-col gap-2.5 rounded-sm border bg-surface-0 p-3.5 shadow-card', isConflict ? 'border-status-conflict' : 'border-border')}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5"><span className="font-mono text-sm font-bold text-accent">{pr.repo}#{pr.pullNumber || pr.number}</span><span className="font-mono text-xs text-muted-foreground">({pr.owner})</span></div>
                      <PRBadge status={pr.status} />
                    </div>
                    <div className="flex w-fit max-w-full items-center gap-1.5 overflow-hidden rounded-sm border border-border bg-surface-1 px-2 py-1 font-mono text-[0.78rem]"><GitBranch size={13} className="shrink-0 text-secondary-foreground" aria-hidden="true" /><span className="truncate font-semibold">{pr.headBranch || 'feature'}</span><ArrowRight size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" /><Badge variant="accent">{pr.baseBranch || 'main'}</Badge></div>
                    <a href={pr.url} target="_blank" rel="noreferrer" className="flex min-h-6 max-[760px]:min-h-11 items-center text-balance text-sm font-semibold hover:underline">{pr.title}</a>
                    <div className="flex gap-2 border-t border-border pt-2.5">
                      <Button size="sm" className={cn('flex-1', currentTab === 'commits' && 'border-accent bg-accent-dim text-accent')} onClick={() => togglePRTab(pr.id, 'commits')}><GitCommit size={13} aria-hidden="true" />Commits ({pr.commitsCount ?? (pr.commits?.length || 0)})</Button>
                      <Button size="sm" className={cn('flex-1', currentTab === 'files' && 'border-accent bg-accent-dim text-accent')} onClick={() => togglePRTab(pr.id, 'files')}><FileCode size={13} aria-hidden="true" />Files ({pr.changedFilesCount ?? (pr.files?.length || 0)})</Button>
                    </div>
                    {currentTab === 'commits' && pr.commits && (
                      <div className="flex max-h-[200px] flex-col gap-2 overflow-y-auto rounded-sm border border-border bg-surface-1 p-2.5">
                        {pr.commits.length === 0 ? <div className="p-2 text-center text-[0.8rem] text-muted-foreground">No commit details available.</div> : pr.commits.map((commit: any, index: number) => <div key={commit.sha || index} className="flex items-start justify-between gap-2 border-b border-border pb-1.5 last:border-0 last:pb-0"><div className="min-w-0 flex-1"><span className="block truncate text-[0.82rem] font-medium">{commit.message?.split('\n')[0]}</span><span className="font-mono text-[0.72rem] text-muted-foreground">by {commit.author || 'unknown'}</span></div><Badge variant="accent">{commit.sha?.substring(0, 7)}</Badge></div>)}
                      </div>
                    )}
                    {currentTab === 'files' && pr.files && (
                      <div className="flex max-h-[200px] flex-col gap-2 overflow-y-auto rounded-sm border border-border bg-surface-1 p-2.5">
                        {pr.files.length === 0 ? <div className="p-2 text-center text-[0.8rem] text-muted-foreground">No modified file details available.</div> : pr.files.map((file: any, index: number) => <div key={file.filename || index} className="flex items-center justify-between gap-2 border-b border-border pb-1.5 font-mono text-[0.78rem] last:border-0 last:pb-0"><span className="min-w-0 flex-1 truncate text-secondary-foreground" title={file.filename}>{file.filename}</span><div className="flex shrink-0 gap-1.5">{file.additions > 0 && <span className="font-bold text-status-open">+{file.additions}</span>}{file.deletions > 0 && <span className="font-bold text-status-conflict">-{file.deletions}</span>}</div></div>)}
                      </div>
                    )}
                    {isConflict && (
                      <div className="mt-1 flex items-center justify-between border-t border-dashed border-status-conflict pt-2"><span className="flex items-center gap-1 font-mono text-xs font-bold text-status-conflict"><AlertTriangle size={13} aria-hidden="true" />File conflict detected</span><Button size="sm" variant="danger" onClick={() => handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number)}>Inspect Conflict</Button>
                      </div>
                    )}
                  </div>
                );
              })}

              {!enrichmentLoading && !enrichmentError && (!ticket.pullRequests || ticket.pullRequests.length === 0) && <div className="rounded-sm border border-dashed border-border bg-white/[0.01] px-4 py-6 text-center text-muted-foreground"><p className="font-mono text-xs">No GitHub pull requests currently linked to ticket key "{ticket.key}".</p></div>}
              {enrichmentError && <div className="rounded-sm border border-status-conflict/40 bg-status-conflict-bg px-4 py-3 text-center text-status-conflict"><p className="font-mono text-xs">GitHub pull request details are temporarily unavailable.</p></div>}
            </div>
          </Card>

          <Card id="demo-video" className="h-fit scroll-mt-6"><div className="mb-3 flex items-center border-b border-border pb-3"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Video size={19} className="text-status-merged" aria-hidden="true" />Demo Video Link</h2></div><p className="mb-3 text-pretty text-xs leading-5 text-muted-foreground">Attach a Loom or Google Drive video demo recording. It will be included in the Discord broadcast.</p><div className="flex flex-col gap-2.5"><Input aria-label="Demo recording URL" className="font-mono" placeholder="https://loom.com/share/..." value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} /><Button variant="primary" onClick={handleSaveDemo}><Save size={16} aria-hidden="true" />Save Demo Recording</Button></div>
            {ticket.demoLink?.url && <div className="mt-4 rounded-sm border border-status-merged/30 bg-status-merged-bg p-3"><div className="mb-1 font-mono text-[0.68rem] font-extrabold text-muted-foreground uppercase">Active Demo Recording:</div><a href={ticket.demoLink.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 break-all font-mono text-[0.8rem] font-bold text-status-merged hover:underline"><ExternalLink size={13} className="shrink-0" aria-hidden="true" /><span>{ticket.demoLink.url}</span></a>{isPlayableVideo(ticket.demoLink.url) && <video className="mt-2 w-full rounded-sm" src={ticket.demoLink.url} controls preload="metadata" />}</div>}
          </Card>
          </div>
        </div>
      </div>

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
