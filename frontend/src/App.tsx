import { lazy, Suspense, useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { Loader2 } from 'lucide-react';
import { GET_AUTH_STATUS } from './graphql/queries';
import { VERIFY_MASTER_PIN } from './graphql/mutations';
import { AppLayout } from './components/AppLayout';
import DashboardPage from './pages/DashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';
import NeedsAttentionPage from './pages/NeedsAttentionPage';
import SettingsPage from './pages/SettingsPage';
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import MonitoringPage from './pages/MonitoringPage';
import DockerServicesPage from './pages/DockerServicesPage';
import SessionsPage from './pages/SessionsPage';
import { PinLockModal } from './components/PinLockModal';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { Button, Page } from './components/ui';

const AgentsPage = lazy(() => import('./pages/AgentsPage'));

function App() {
  const { data, error, refetch } = useQuery(GET_AUTH_STATUS, { fetchPolicy: 'network-only' });
  const [verifyMasterPin] = useMutation(VERIFY_MASTER_PIN);

  const getInitialRoute = () => {
    const path = window.location.pathname;
    if (path.startsWith('/detail/') || path.startsWith('/ticket/')) {
      const key = decodeURIComponent(path.split('/').pop() || '');
      return { path: '/ticket', key: key || null };
    }
    if (path === '/dashboard' || path === '/agents' || path === '/sessions' || path === '/calendar' || path === '/monitoring' || path === '/docker' || path === '/attention' || path === '/settings') {
      return { path, key: null };
    }
    return { path: '/', key: null };
  };

  const initialRoute = getInitialRoute();
  const [currentPath, setCurrentPath] = useState(initialRoute.path);
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(initialRoute.key);

  useEffect(() => {
    const handlePopState = () => {
      const route = getInitialRoute();
      setCurrentPath(route.path);
      setSelectedTicketKey(route.key);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleUnlock = async (pin: string): Promise<boolean> => {
    try {
      const res = await verifyMasterPin({ variables: { pin } });
      if (res.data?.verifyMasterPin) {
        await refetch();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleNavigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    if (path !== '/ticket') {
      setSelectedTicketKey(null);
    }
  };

  const navigateToTicket = (key: string) => {
    window.history.pushState({}, '', `/detail/${encodeURIComponent(key)}`);
    setSelectedTicketKey(key);
    setCurrentPath('/ticket');
  };

  const renderPage = () => {
    switch (currentPath) {
      case '/': return <HomePage onTicketClick={navigateToTicket} onNavigate={handleNavigate} />;
      case '/dashboard': return <DashboardPage onTicketClick={navigateToTicket} />;
      case '/agents': return <Suspense fallback={<Page width="full"><LoadingSkeleton /></Page>}><AgentsPage onTicketClick={navigateToTicket} onNavigate={handleNavigate} /></Suspense>;
      case '/sessions': return <SessionsPage />;
      case '/calendar': return <CalendarPage onNavigate={handleNavigate} />;
      case '/monitoring': return <MonitoringPage onNavigate={handleNavigate} />;
      case '/docker': return <DockerServicesPage />;
      case '/attention': return <NeedsAttentionPage onTicketClick={navigateToTicket} />;
      case '/settings': return <SettingsPage />;
      case '/ticket': return selectedTicketKey ? <TicketDetailPage ticketKey={selectedTicketKey} onBack={() => handleNavigate('/dashboard')} /> : <DashboardPage onTicketClick={navigateToTicket} />;
      default: return <HomePage onTicketClick={navigateToTicket} onNavigate={handleNavigate} />;
    }
  };

  if (!data?.authStatus) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
          <img src="/dock-logo.svg" alt="DOCK" className="size-14" />
          {error ? (
            <>
              <p className="text-sm text-secondary-foreground">Unable to restore your DOCK session.</p>
              <Button onClick={() => void refetch()}>
                Retry
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
              <p className="text-sm text-secondary-foreground">Restoring your session...</p>
            </>
          )}
        </div>
      </main>
    );
  }

  const isLocked = data.authStatus.hasMasterPin && !data.authStatus.authenticated;

  return (
    <AppLayout currentPath={currentPath === '/ticket' ? '/dashboard' : currentPath} onNavigate={handleNavigate}>
      {!isLocked && renderPage()}
      <PinLockModal 
        isOpen={isLocked} 
        onUnlock={handleUnlock} 
      />
    </AppLayout>
  );
}

export default App;
