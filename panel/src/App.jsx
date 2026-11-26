import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
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
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={() => setLoggedIn(true)} />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <div className="app">
        <TopBar operator={operator} onLogout={() => { clearToken(); setLoggedIn(false); }} />
        <div className="app-body">
          <Sidebar />
          <div className="main-content">
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/files" element={<Files />} />
              <Route path="/listeners" element={<Listeners />} />
              <Route path="/builder" element={<Builder />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </div>
        </div>
        <StatusBar stats={stats} />
      </div>
    </BrowserRouter>
  );
}
