import React, { useState, useEffect } from 'react';
import { api } from '../api';

const TABS = ['Server', 'Builder'];

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('Server');

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings({
        server_port: s.server_port || '443',
        tls_cert_path: s.tls_cert_path || '/etc/shadowgrid/cert.pem',
        agent_timeout: s.agent_timeout || '300',
        log_retention: s.log_retention || '90',
        github_token: s.github_token || '',
        github_repo: s.github_repo || '',
        azure_tenant_id: s.azure_tenant_id || '',
        azure_client_id: s.azure_client_id || '',
        azure_client_secret: s.azure_client_secret || '',
        azure_signing_endpoint: s.azure_signing_endpoint || '',
        azure_account_name: s.azure_account_name || '',
        azure_cert_profile: s.azure_cert_profile || '',
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
        {TABS.map(tab => (
          <button key={tab}
            className={`btn ${activeTab === tab ? 'btn-green' : ''}`}
            style={{ fontSize: 11, padding: '8px 20px', borderRadius: 0 }}
            onClick={() => setActiveTab(tab)}>
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* SERVER TAB */}
      {activeTab === 'Server' && (
        <>
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
        </>
      )}

      {/* BUILDER TAB */}
      {activeTab === 'Builder' && (
        <>
          <div className="panel">
            <div className="panel-header">GitHub Integration</div>
            <div className="panel-body" style={{ maxWidth: 600 }}>
              <div className="form-group">
                <label className="form-label">GitHub Personal Access Token</label>
                <input type="password" className="form-input" value={settings.github_token || ''} onChange={e => update('github_token', e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  Requires <code>repo</code> and <code>actions</code> scopes
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">GitHub Repository</label>
                <input type="text" className="form-input" value={settings.github_repo || ''} onChange={e => update('github_repo', e.target.value)}
                  placeholder="owner/repository" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-green" onClick={save} disabled={saving}>
                  {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE SETTINGS'}
                </button>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">Azure Trusted Signing</div>
            <div className="panel-body" style={{ maxWidth: 600 }}>
              <div style={{
                marginBottom: 16, padding: 10, border: '1px solid var(--border)',
                background: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--yellow, #e5c07b)', lineHeight: 1.6,
              }}>
                ⚠ These credentials are stored in the ShadowGrid database for display purposes.
                <br />
                <strong>Azure credentials must also be added as GitHub repository secrets:</strong>
                <br />
                <span style={{ color: 'var(--text-muted)' }}>
                  AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
                  AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT, AZURE_CERT_PROFILE
                </span>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Azure Tenant ID</label>
                  <input type="text" className="form-input" value={settings.azure_tenant_id || ''} onChange={e => update('azure_tenant_id', e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Azure Client ID</label>
                  <input type="text" className="form-input" value={settings.azure_client_id || ''} onChange={e => update('azure_client_id', e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Azure Client Secret</label>
                <input type="password" className="form-input" value={settings.azure_client_secret || ''} onChange={e => update('azure_client_secret', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Signing Endpoint</label>
                <input type="text" className="form-input" value={settings.azure_signing_endpoint || ''} onChange={e => update('azure_signing_endpoint', e.target.value)}
                  placeholder="https://eus.codesigning.azure.net" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Account Name</label>
                  <input type="text" className="form-input" value={settings.azure_account_name || ''} onChange={e => update('azure_account_name', e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Certificate Profile</label>
                  <input type="text" className="form-input" value={settings.azure_cert_profile || ''} onChange={e => update('azure_cert_profile', e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-green" onClick={save} disabled={saving}>
                  {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE SETTINGS'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
