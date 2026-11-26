import React from 'react';

export default function StatusBar({ stats }) {
  return (
    <div style={{
      height: 24, background: '#15171b',
      borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 24,
      fontFamily: 'var(--font-mono)', fontSize: 10,
      color: 'var(--text-muted)', textTransform: 'uppercase',
      letterSpacing: 1,
    }}>
      <span>
        <span style={{ width: 6, height: 6, display: 'inline-block', background: 'var(--green)', marginRight: 6 }} />
        SERVER ONLINE
      </span>
      <span>
        AGENTS: {stats.active_agents || 0} ACTIVE / {stats.dormant_agents || 0} DORMANT / {stats.dead_agents || 0} DEAD
      </span>
      <span>
        LISTENERS: {stats.active_listeners || 0} / {stats.total_listeners || 0}
      </span>
      <span>
        CREDENTIALS: {stats.credentials || 0}
      </span>
    </div>
  );
}
