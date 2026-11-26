import React, { useState, useRef, useEffect } from 'react';

export default function Terminal({ agentId, onSendCommand }) {
  const [lines, setLines] = useState([
    { type: 'info', text: `Connected to agent ${agentId}. Type commands below.` },
  ]);
  const [input, setInput] = useState('');
  const termRef = useRef(null);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [lines]);

  const handleSend = () => {
    if (!input.trim()) return;
    setLines(prev => [...prev, { type: 'prompt', text: `${agentId} $> ${input}` }]);
    if (onSendCommand) {
      onSendCommand(input).then(result => {
        if (result) {
          setLines(prev => [...prev, { type: 'output', text: result }]);
        }
      }).catch(err => {
        setLines(prev => [...prev, { type: 'error', text: 'Error: ' + err.message }]);
      });
    }
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="terminal" ref={termRef} style={{ flex: 1, overflowY: 'auto' }}>
        {lines.map((line, i) => (
          <div key={i}>
            {line.type === 'prompt' && <span className="prompt">{line.text}</span>}
            {line.type === 'output' && <span className="output">{line.text}</span>}
            {line.type === 'error' && <span style={{ color: 'var(--red)' }}>{line.text}</span>}
            {line.type === 'info' && <span style={{ color: 'var(--text-muted)' }}>{line.text}</span>}
          </div>
        ))}
      </div>
      <div className="terminal-input-bar">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Enter command..."
          spellCheck="false"
        />
        <button onClick={handleSend}>SEND</button>
      </div>
    </div>
  );
}
