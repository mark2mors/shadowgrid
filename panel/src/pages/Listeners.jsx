import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Listeners() {
  const [listeners, setListeners] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'https', bind_host: '0.0.0.0', bind_port: 443, domain: '' });
  const [showForm, setShowForm] = useState(false);

  const load = () => api.getListeners().then(setListeners).catch(() => {});
  useEffect(load, []);

  const create = async () => {
    await api.createListener(form);
    setForm({ name: '', type: 'https', bind_host: '0.0.0.0', bind_port: 443, domain: '' });
    setShowForm(false);
    load();
  };

  const start = async (id) => { await api.startListener(id); load(); };
  const stop = async (id) => { await api.stopListener(id); load(); };

  return (
    <div>
      <div className="page-title">// LISTENERS</div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button className="btn btn-green" onClick={() => setShowForm(!showForm)}>NEW LISTENER</button>
        <button className="btn btn-sm" onClick={load}>REFRESH</button>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Bind</th><th>Port</th><th>Domain</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {listeners.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-disabled)', padding: 24 }}>No listeners configured</td></tr>
            ) : listeners.map(l => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.type?.toUpperCase()}</td>
                <td>{l.bind_host}</td>
                <td>{l.bind_port}</td>
                <td>{l.domain}</td>
                <td>
                  <span className={`status-dot ${l.status === 'running' ? 'green' : 'red'}`} />
                  <span style={{ color: l.status === 'running' ? 'var(--green)' : 'var(--red)' }}>{l.status?.toUpperCase()}</span>
                </td>
                <td>
                  <div className="action-btns">
                    {l.status === 'running' ? (
                      <button className="btn btn-sm btn-red" onClick={() => stop(l.id)}>STOP</button>
                    ) : (
                      <button className="btn btn-sm btn-green" onClick={() => start(l.id)}>START</button>
                    )}
                    <button className="btn btn-sm">EDIT</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">New Listener Configuration</div>
          <div className="panel-body" style={{ maxWidth: 700 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input type="text" className="form-input" placeholder="listener-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <div className="radio-group">
                  {['https','dns','tcp'].map(t => (
                    <span key={t} className={`radio-item ${form.type === t ? 'selected' : ''}`} onClick={() => setForm({...form, type: t})}>{t.toUpperCase()}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Bind Address</label>
                <input type="text" className="form-input" value={form.bind_host} onChange={e => setForm({...form, bind_host: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Port</label>
                <input type="number" className="form-input" value={form.bind_port} onChange={e => setForm({...form, bind_port: parseInt(e.target.value)})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Domain</label>
                <input type="text" className="form-input" placeholder="cdn.example.com" value={form.domain} onChange={e => setForm({...form, domain: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">TLS Certificate Path</label>
                <input type="text" className="form-input" placeholder="/etc/ssl/cert.pem" />
              </div>
            </div>
            <button className="btn btn-green" style={{ marginTop: 8 }} onClick={create}>CREATE LISTENER</button>
          </div>
        </div>
      )}
    </div>
  );
}
