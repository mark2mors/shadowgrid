import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import AgentModal from './AgentModal';

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const loadAgents = useCallback(() => {
    let params = '';
    if (filter !== 'all') params += 'status=' + filter;
    if (search) params += (params ? '&' : '') + 'search=' + encodeURIComponent(search);
    api.getAgents(params).then(setAgents).catch(() => {});
  }, [filter, search]);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 5000);
    return () => clearInterval(interval);
  }, [loadAgents]);

  const timeSince = (dateStr) => {
    if (!dateStr) return '-';
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return seconds + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  };

  const statusColor = (agent) => {
    if (agent.status === 'dead') return 'red';
    if (agent.status === 'dormant') return 'yellow';
    return 'green';
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (confirm('Remove agent ' + id + '?')) {
      await api.deleteAgent(id);
      loadAgents();
    }
  };

  return (
    <div>
      <div className="page-title">// AGENTS</div>
      <div className="filter-bar">
        {['all', 'active', 'dormant', 'dead'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f.toUpperCase()}
          </button>
        ))}
        <input
          type="text" className="search-input" placeholder="Search agents..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn-green" onClick={loadAgents}>REFRESH</button>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Status</th><th>ID</th><th>Hostname</th><th>User</th><th>OS</th>
              <th>IP</th><th>Country</th><th>City</th><th>ISP</th><th>Last Seen</th><th>Sleep</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-disabled)', padding: 24 }}>No agents connected</td></tr>
            ) : agents.map(a => (
              <tr key={a.id} className="agent-row" onClick={() => setSelectedAgent(a)}>
                <td><span className={`status-dot ${statusColor(a)}`} /></td>
                <td>{a.id?.substring(0, 10)}</td>
                <td>{countryFlag(a.country)} {a.hostname}</td>
                <td>{a.username}</td>
                <td>{a.os}</td>
                <td>{a.ip_external || a.ip_internal}</td>
                <td>{countryFlag(a.country)} {a.country}</td>
                <td>{a.city || '-'}</td>
                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.isp || '-'}</td>
                <td style={{ color: `var(--${statusColor(a)})` }}>{timeSince(a.last_seen)}</td>
                <td>{a.sleep_seconds}s</td>
                <td>
                  <div className="action-btns">
                    {a.is_admin && <span className="badge-admin">ADMIN</span>}
                    <button className="btn btn-sm" onClick={e => { e.stopPropagation(); setSelectedAgent(a); }}>INTERACT</button>
                    <button className="btn btn-sm btn-red" onClick={e => handleDelete(e, a.id)}>KILL</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedAgent && (
        <AgentModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
