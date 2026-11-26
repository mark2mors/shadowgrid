import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Files() {
  const [files, setFiles] = useState([]);
  const [direction, setDirection] = useState('all');
  const [search, setSearch] = useState('');

  const loadFiles = () => {
    let params = '';
    if (direction !== 'all') params += 'direction=' + direction;
    api.getFiles(params).then(setFiles).catch(() => {});
  };

  useEffect(loadFiles, [direction]);

  const downloadFile = async (id, filename) => {
    const res = await api.downloadFile(id);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-title">// FILES</div>
      <div className="filter-bar">
        <input type="text" className="search-input" placeholder="Search files..." value={search} onChange={e => setSearch(e.target.value)} />
        {['all','download','upload'].map(f => (
          <button key={f} className={`btn ${direction === f ? 'active' : ''}`} onClick={() => setDirection(f)}>
            {f === 'all' ? 'ALL' : f === 'download' ? 'DOWNLOADS' : 'UPLOADS'}
          </button>
        ))}
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Agent</th><th>Filename</th><th>Size</th><th>Dir</th><th>Path</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {files.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-disabled)', padding: 24 }}>No files</td></tr>
            ) : files.map(f => (
              <tr key={f.id}>
                <td style={{ color: 'var(--green)' }}>{f.agent_id?.substring(0, 10)}</td>
                <td>{f.filename}</td>
                <td>{f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : f.size > 1024 ? (f.size / 1024).toFixed(0) + ' KB' : f.size + ' B'}</td>
                <td style={{ color: f.direction === 'download' ? 'var(--green)' : 'var(--red)' }}>
                  {f.direction === 'download' ? '↓' : '↑'}
                </td>
                <td>{f.filepath}</td>
                <td>{f.created_at ? new Date(f.created_at).toLocaleTimeString() : '-'}</td>
                <td><button className="btn btn-sm btn-green" onClick={() => downloadFile(f.id, f.filename)}>DOWNLOAD</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
