import React, { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { 
  MessageSquare, 
  GitPullRequest, 
  Video, 
  ExternalLink, 
  Save, 
  AlertTriangle, 
  User, 
  ArrowLeft, 
  RefreshCw, 
  GitCommit, 
  FileCode, 
  GitBranch, 
  FileText,
  ArrowRight
} from 'lucide-react';
import { GET_TICKET_DETAIL } from '../graphql/queries';
import { SAVE_DEMO_LINK, SEND_TO_DISCORD, CHECK_CONFLICTS } from '../graphql/mutations';
import { PRBadge } from '../components/PRBadge';
import { ConflictModal } from '../components/ConflictModal';
import { DiscordPreviewModal } from '../components/DiscordPreviewModal';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Toast } from '../components/Toast';
import { Badge, Button, Card, Input, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';

interface TicketDetailPageProps {
  ticketKey: string;
  onBack?: () => void;
}

const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketKey, onBack }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, loading, error, refetch } = useQuery(GET_TICKET_DETAIL, { 
    ...CACHED_QUERY_OPTIONS,
    variables: { key: ticketKey },
  });
  const [saveDemoLink] = useMutation(SAVE_DEMO_LINK);
  const [sendToDiscord, { loading: sendingDiscord }] = useMutation(SEND_TO_DISCORD);
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [activePRTab, setActivePRTab] = useState<Record<string, 'commits' | 'files' | 'none'>>({});

  const togglePRTab = (prId: string, tab: 'commits' | 'files') => {
    setActivePRTab(prev => ({
      ...prev,
      [prId]: prev[prId] === tab ? 'none' : tab
    }));
  };

  const renderBackButton = () => onBack ? (
    <button onClick={onBack} className="mb-5 inline-flex min-h-6 items-center gap-2 font-mono text-[0.82rem] font-semibold text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Dashboard</span>
      <span className="opacity-40">/</span>
      <span className="text-foreground">{ticketKey}</span>
    </button>
  ) : null;

  if (isInitialQueryLoading(loading, data)) return (
    <Page width="full">
      {renderBackButton()}
      <LoadingSkeleton />
    </Page>
  );
  if (error && !data) return (
    <Page width="full">
      {renderBackButton()}
      <Card className="border-status-conflict text-status-conflict" role="alert">Error loading ticket details: {error.message}</Card>
    </Page>
  );

  const ticket = data?.ticketDetail;
  if (!ticket) return (
    <Page width="full">
      {renderBackButton()}
      <Card>Ticket "{ticketKey}" not found in current workspace.</Card>
    </Page>
  );

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
      await saveDemoLink({ variables: { ticketKey, url: demoUrl } });
      setToast({ message: 'Demo recording link saved permanently!', type: 'success' });
      setDemoUrl('');
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
        setToast({ message: 'Summary message posted to Discord channel!', type: 'success' });
        setShowDiscordModal(false);
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
      await refetch();
      setToast({ message: 'Pull requests synchronized successfully!', type: 'success' });
    } catch (e) {
      setToast({ message: 'Failed to synchronize pull requests', type: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  };

  const isOldSprint = ticket.sprintState === 'CLOSED';

  return (
    <Page width="full">
      {renderBackButton()}
      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[1_1_640px] flex-col gap-6">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-3"><Badge variant="accent" className="px-3 py-1 font-bold text-base">{ticket.key}</Badge>{ticket.storyPoints != null && <Badge className="border-orange-300/35 bg-orange-300/10 text-orange-200">{ticket.storyPoints} SP</Badge>}<PRBadge status={ticket.status} /></div>
            <h1 className="text-balance font-display text-[1.65rem] leading-snug font-bold">{ticket.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3 font-mono text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><User size={15} className="text-secondary-foreground" aria-hidden="true" />Assignee: <strong className="text-foreground">{ticket.assignee || 'Unassigned'}</strong></span>
              {ticket.sprintName && ticket.sprintName !== 'No Sprint' && <span className={cn('text-[0.78rem] font-semibold', isOldSprint ? 'text-muted-foreground' : 'text-status-merged')}>{ticket.sprintName}</span>}
              {ticket.url && <a href={ticket.url} target="_blank" rel="noreferrer" className="flex min-h-6 items-center gap-1.5 font-bold text-accent hover:underline"><ExternalLink size={15} aria-hidden="true" />Open in Jira</a>}
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-3"><FileText size={20} className="text-accent" aria-hidden="true" /><h2 className="font-display text-xl font-bold">Issue Description</h2></div>
            <div className="max-h-[62dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-0 px-6 py-5 text-sm leading-7 text-secondary-foreground">{ticket.description || 'No detailed description provided in this Jira issue.'}</div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-6">
          <Card className="border-status-discord/40 bg-status-discord/15">
            <Button className="h-12 w-full border-status-discord bg-status-discord text-base text-white hover:bg-status-discord/80" onClick={handleDiscordBroadcast}><MessageSquare size={20} aria-hidden="true" />Broadcast Summary to Discord</Button>
            <p className="mt-2.5 text-center font-mono text-xs text-muted-foreground">Sends status, PR merge checks, and demo recordings to team channels.</p>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2"><GitPullRequest size={20} className="text-accent" aria-hidden="true" /><h2 className="font-display text-lg font-bold">Linked Pull Requests</h2><Badge>{ticket.pullRequests?.length || 0}</Badge></div>
              <Button size="sm" onClick={handleManualRefetch} disabled={isRefreshing} title="Refresh PRs from GitHub"><RefreshCw size={13} className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{isRefreshing ? 'Syncing...' : 'Refresh'}</Button>
            </div>

            <div className="flex flex-col gap-4">
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
                    <a href={pr.url} target="_blank" rel="noreferrer" className="flex min-h-6 items-center text-balance text-sm font-semibold hover:underline">{pr.title}</a>
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

              {(!ticket.pullRequests || ticket.pullRequests.length === 0) && <div className="rounded-sm border border-dashed border-border bg-white/[0.01] px-4 py-6 text-center text-muted-foreground"><p className="font-mono text-xs">No GitHub pull requests currently linked to ticket key "{ticket.key}".</p></div>}
            </div>
          </Card>

          <Card className="h-fit"><div className="mb-3 flex items-center border-b border-border pb-3"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Video size={19} className="text-status-merged" aria-hidden="true" />Demo Video Link</h2></div><p className="mb-3 text-pretty text-xs leading-5 text-muted-foreground">Attach a Loom or Google Drive video demo recording. It will be included in the Discord broadcast.</p><div className="flex flex-col gap-2.5"><Input aria-label="Demo recording URL" className="font-mono" placeholder="https://loom.com/share/..." value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} /><Button variant="primary" onClick={handleSaveDemo}><Save size={16} aria-hidden="true" />Save Demo Recording</Button></div>
            {ticket.demoLink?.url && <div className="mt-4 rounded-sm border border-status-merged/30 bg-status-merged-bg p-3"><div className="mb-1 font-mono text-[0.68rem] font-extrabold text-muted-foreground uppercase">Active Demo Recording:</div><a href={ticket.demoLink.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 break-all font-mono text-[0.8rem] font-bold text-status-merged hover:underline"><ExternalLink size={13} className="shrink-0" aria-hidden="true" /><span>{ticket.demoLink.url}</span></a></div>}
          </Card>
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
        ticket={{ key: ticket.key, title: ticket.title, url: ticket.url }}
        pullRequests={ticket.pullRequests || []}
        demoUrl={ticket.demoLink?.url || demoUrl}
        loading={sendingDiscord}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default TicketDetailPage;
