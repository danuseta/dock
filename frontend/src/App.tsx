import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
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
import { PinLockModal } from './components/PinLockModal';

function App() {
  const { data, refetch } = useQuery(GET_AUTH_STATUS, { fetchPolicy: 'network-only' });
  const [verifyMasterPin] = useMutation(VERIFY_MASTER_PIN);

  const getInitialRoute = () => {
    const path = window.location.pathname;
    if (path.startsWith('/detail/') || path.startsWith('/ticket/')) {
      const key = decodeURIComponent(path.split('/').pop() || '');
      return { path: '/ticket', key: key || null };
    }
    if (path === '/dashboard' || path === '/calendar' || path === '/monitoring' || path === '/attention' || path === '/settings') {
      return { path, key: null };
    }
    return { path: '/', key: null };
  };

  const initialRoute = getInitialRoute();
  const [currentPath, setCurrentPath] = useState(initialRoute.path);
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(initialRoute.key);
  const [isLocked, setIsLocked] = useState(true);

  useEffect(() => {
    const handlePopState = () => {
      const route = getInitialRoute();
      setCurrentPath(route.path);
      setSelectedTicketKey(route.key);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!data?.authStatus) return;
    setIsLocked(data.authStatus.hasMasterPin && !data.authStatus.authenticated);
  }, [data]);

  const handleUnlock = async (pin: string): Promise<boolean> => {
    try {
      const res = await verifyMasterPin({ variables: { pin } });
      if (res.data?.verifyMasterPin) {
        await refetch();
        setIsLocked(false);
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
      case '/calendar': return <CalendarPage onNavigate={handleNavigate} />;
      case '/monitoring': return <MonitoringPage />;
      case '/attention': return <NeedsAttentionPage onTicketClick={navigateToTicket} />;
      case '/settings': return <SettingsPage />;
      case '/ticket': return selectedTicketKey ? <TicketDetailPage ticketKey={selectedTicketKey} onBack={() => handleNavigate('/dashboard')} /> : <DashboardPage onTicketClick={navigateToTicket} />;
      default: return <HomePage onTicketClick={navigateToTicket} onNavigate={handleNavigate} />;
    }
  };

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
