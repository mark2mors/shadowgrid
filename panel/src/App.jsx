import React, { useState, useEffect } from 'react';
import { isLoggedIn, clearToken, api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Credentials from './pages/Credentials';
import Files from './pages/Files';
import Listeners from './pages/Listeners';
import Builder from './pages/Builder';
import Settings from './pages/Settings';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import StatusBar from './components/StatusBar';

const PAGES = {
  dashboard: Dashboard,
  agents: Agents,
  credentials: Credentials,
  files: Files,
  listeners: Listeners,
  builder: Builder,
  settings: Settings,
};

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [page, setPage] = useState('dashboard');
  const [operator, setOperator] = useState('');
  const [stats, setStats] = useState({});

  useEffect(() => {
    if (loggedIn) {
      api.me().then(op => setOperator(op.username || 'operator')).catch(() => {});
      api.getStats().then(s => setStats(s)).catch(() => {});
      const interval = setInterval(() => {
        api.getStats().then(s => setStats(s)).catch(() => {});
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [loggedIn]);

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  const PageComponent = PAGES[page] || Dashboard;

  return (
    <div className="app">
      <TopBar operator={operator} onLogout={() => { clearToken(); setLoggedIn(false); }} />
      <div className="app-body">
        <Sidebar active={page} onNavigate={setPage} />
        <div className="main-content">
          <PageComponent />
        </div>
      </div>
      <StatusBar stats={stats} />
    </div>
  );
}
