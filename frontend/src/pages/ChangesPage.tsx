import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Page } from '../components/ui';
import { sessionIdFromSearch, sessionUrl } from '../chat/sessionRoute';
import { pullEntry, pullRepo } from '../lib/blackboard';
import { CodeChanges } from './blackboard/CodeChanges';

interface ChangesPageProps { onNavigate: (path: string) => void; onTicketClick: (key: string) => void }

const FROM: Record<string, string> = { agents: 'Agents', board: 'Board', discord: 'Discord', sessions: 'Sessions' };

const params = () => new URLSearchParams(window.location.search);

/**
 * Perubahan kode on its own, for the laptop DOCK, which has no Blackboard: a pull request link there opens the same
 * diff with a way back to where it came from. On the workspace the link opens inside the ticket's Blackboard.
 */
const ChangesPage: React.FC<ChangesPageProps> = ({ onNavigate, onTicketClick }) => {
  const query = params();
  const ticketKey = query.get('key') ?? '';
  const from = query.get('from') ?? 'board';

  const back = () => {
    if (from === 'ticket') onTicketClick(ticketKey);
    else if (from === 'sessions') onNavigate(sessionUrl(sessionIdFromSearch(window.location.search)));
    else onNavigate(from === 'agents' ? '/agents' : from === 'discord' ? '/discord' : '/dashboard');
  };
  const crumb = from === 'ticket' ? ticketKey : FROM[from] ?? 'Board';
  const pickRepo = (repo: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('file', pullEntry(repo));
    url.searchParams.delete('path');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };

  if (!ticketKey) return <Page width="full"><p className="text-sm text-muted-foreground">Open this page from a pull request link.</p></Page>;
  return (
    <Page width="full">
      <nav className="mb-1.5 flex items-center gap-1.5 font-mono text-[0.72rem] text-muted-foreground" aria-label="Breadcrumb">
        <button type="button" onClick={back} className="flex min-h-7 items-center gap-1.5 border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground max-[760px]:min-h-11"><ArrowLeft size={13} aria-hidden="true" />{crumb}</button>
        {from !== 'ticket' && <><span>/</span><button type="button" onClick={() => onTicketClick(ticketKey)} className="border-0 bg-transparent p-0 font-semibold text-secondary-foreground hover:text-foreground">{ticketKey}</button></>}
        <span>/</span><span>Changes</span>
      </nav>
      <CodeChanges ticketKey={ticketKey} repo={pullRepo(query.get('file'))} onRepo={pickRepo} trace={null} focusPath={query.get('path')} onSettings={() => onNavigate('/settings')} />
    </Page>
  );
};

export default ChangesPage;
