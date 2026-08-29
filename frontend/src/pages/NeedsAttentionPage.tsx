import React, { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { AlertTriangle, CheckCircle2, ExternalLink, GitMerge } from 'lucide-react';
import { GET_NEEDS_ATTENTION } from '../graphql/queries';
import { CHECK_CONFLICTS } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ConflictModal } from '../components/ConflictModal';
import { Toast } from '../components/Toast';
import { Badge, Button, Card, Page } from '../components/ui';

interface NeedsAttentionPageProps { onTicketClick: (key: string) => void }

const NeedsAttentionPage: React.FC<NeedsAttentionPageProps> = ({ onTicketClick }) => {
  const { data, loading, error } = useQuery(GET_NEEDS_ATTENTION, { pollInterval: 30000, fetchPolicy: 'cache-and-network' });
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  if (loading && !data) return <Page><LoadingSkeleton /></Page>;
  if (error) return <Page><Card className="border-status-conflict text-status-conflict" role="alert">Error: {error.message}</Card></Page>;

  const items = data?.needsAttention || [];
  const handleInspectConflict = async (owner: string, repo: string, pullNumber: number) => {
    try {
      const res = await checkConflicts({ variables: { owner, repo, pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) {
        setConflictMessage(res.data.checkConflicts.message || 'Merge conflict detected in target branch.');
        setShowConflictModal(true);
      } else setToast({ message: 'No conflicts detected! Clean merge status.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to inspect conflict details', type: 'error' });
    }
  };

  return (
    <Page>
      <Card className="mb-8 border-status-conflict/60 bg-status-conflict-bg shadow-none">
        <div className="flex items-center gap-4">
          <div className="rounded-sm bg-status-conflict-bg p-4 text-status-conflict"><AlertTriangle size={36} aria-hidden="true" /></div>
          <div><h1 className="text-balance font-display text-2xl font-bold text-status-conflict">Needs Immediate Attention</h1><p className="mt-1 text-pretty text-secondary-foreground">Pull requests with active merge conflicts against their target branch that require resolution.</p></div>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="py-12 text-center"><CheckCircle2 size={48} className="mx-auto mb-4 text-status-merged" aria-hidden="true" /><h2 className="text-balance font-display text-xl font-bold text-status-merged">All Clear! No Merge Conflicts</h2><p className="mt-2 text-pretty text-muted-foreground">None of your monitored pull requests currently have merge conflicts.</p></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item: any) => <Card key={item.id} className="flex flex-wrap items-center justify-between gap-4 border-status-conflict/40">
            <div className="flex min-w-0 items-center gap-4">
              <Badge variant="danger" className="shrink-0 gap-1.5 px-3.5 py-2.5 text-sm"><AlertTriangle size={16} aria-hidden="true" /><span>{item.ticketKey || 'CONFLICT'}</span></Badge>
              <div className="min-w-0"><h3 className="text-balance text-lg font-medium">{item.message}</h3>{item.prUrl && <a href={item.prUrl} target="_blank" rel="noreferrer" className="mt-0.5 flex min-h-6 items-center gap-1 truncate font-mono text-sm text-accent hover:underline"><ExternalLink size={14} className="shrink-0" aria-hidden="true" /><span className="truncate">{item.prUrl}</span></a>}</div>
            </div>
            <div className="flex items-center gap-2">
              {item.owner && item.repo && item.pullNumber && <Button size="sm" variant="danger" onClick={() => handleInspectConflict(item.owner, item.repo, item.pullNumber)}><GitMerge size={16} aria-hidden="true" />Inspect File Conflict</Button>}
              {item.ticketKey && <Button size="sm" variant="primary" onClick={() => onTicketClick(item.ticketKey)}>Inspect Ticket</Button>}
            </div>
          </Card>)}
        </div>
      )}
      {showConflictModal && <ConflictModal isOpen={showConflictModal} message={conflictMessage} onClose={() => setShowConflictModal(false)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default NeedsAttentionPage;
