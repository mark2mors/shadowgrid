import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings({
        server_port: s.server_port || '443',
        tls_cert_path: s.tls_cert_path || '/etc/shadowgrid/cert.pem',
        agent_timeout: s.agent_timeout || '300',
        log_retention: s.log_retention || '90',
        ...s,
      });
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    await api.updateSettings(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (key, val) => setSettings({...settings, [key]: val});

  return (
    <div>
      <div className="page-title">// SETTINGS</div>

      <div className="panel">
        <div className="panel-header">Server Configuration</div>
        <div className="panel-body" style={{ maxWidth: 600 }}>
          <div className="form-group">
            <label className="form-label">Server Port</label>
            <input type="number" className="form-input" value={settings.server_port || ''} onChange={e => update('server_port', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">TLS Certificate Path</label>
            <input type="text" className="form-input" value={settings.tls_cert_path || ''} onChange={e => update('tls_cert_path', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Agent Timeout (seconds before marking dead)</label>
            <input type="number" className="form-input" value={settings.agent_timeout || ''} onChange={e => update('agent_timeout', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Log Retention (days)</label>
            <input type="number" className="form-input" value={settings.log_retention || ''} onChange={e => update('log_retention', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-green" onClick={save} disabled={saving}>
              {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE SETTINGS'}
            </button>
            <button className="btn">BACKUP DATABASE</button>
            <button className="btn">EXPORT DATA</button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">About</div>
        <div className="panel-body">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 2, color: 'var(--text-sec)' }}>
            <div><span style={{ color: 'var(--text-muted)' }}>Product:</span> ShadowGrid v1.0.0</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Server:</span> Go 1.21 (compiled: Nov 26, 2026)</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Agent Runtime:</span> Rust (nightly-2026-11-01)</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Protocol:</span> HTTPS/DNS with AES-256-GCM</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Database:</span> SQLite 3.44.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}
