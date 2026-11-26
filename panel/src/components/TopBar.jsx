import React from 'react';

export default function TopBar({ operator, onLogout }) {
  return (
    <div style={{
      height: 48, background: '#191b20',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', zIndex: 10,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 2,
      }}>
        <span style={{ color: 'var(--green)' }}>SHADOW</span>GRID
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        textTransform: 'uppercase', letterSpacing: 1,
        color: 'var(--text-sec)',
      }}>
        <span>OPERATOR: <span style={{ color: 'var(--green)' }}>{operator}</span></span>
        <span
          onClick={onLogout}
          style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
          onMouseEnter={e => e.target.style.color = 'var(--red)'}
          onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
        >[ LOGOUT ]</span>
      </div>
    </div>
  );
}
