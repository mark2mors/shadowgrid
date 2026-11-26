import React from 'react';

/**
 * Reusable confirmation modal for destructive actions.
 * Props:
 *   open       - boolean controlling visibility
 *   title      - header text (e.g. "CONFIRM KILL")
 *   message    - body text / description
 *   detail     - optional secondary info line (agent ID, hostname, etc.)
 *   confirmLabel - text on the confirm button (default: "CONFIRM")
 *   cancelLabel  - text on the cancel button (default: "CANCEL")
 *   variant    - "red" (default) or "yellow" for warning-level
 *   onConfirm  - callback when confirmed
 *   onCancel   - callback when cancelled
 */
export default function ConfirmModal({
  open,
  title = 'CONFIRM ACTION',
  message = 'Are you sure?',
  detail,
  confirmLabel = 'CONFIRM',
  cancelLabel = 'CANCEL',
  variant = 'red',
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const accentColor = variant === 'red' ? 'var(--red)' : 'var(--yellow, #e5c07b)';

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: '#1f2228',
        border: `1px solid ${accentColor}`,
        borderRadius: 0,
        width: 420,
        maxWidth: '90vw',
        fontFamily: 'var(--font-mono)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${accentColor}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: accentColor, fontSize: 14 }}>⚠</span>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            color: accentColor,
          }}>
            {title}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 16px' }}>
          <div style={{
            fontSize: 12,
            color: 'var(--text-sec)',
            lineHeight: 1.6,
            marginBottom: detail ? 12 : 0,
          }}>
            {message}
          </div>
          {detail && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-muted)',
              lineHeight: 1.8,
            }}>
              {detail}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-sec)',
              borderRadius: 0,
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              background: accentColor,
              border: `1px solid ${accentColor}`,
              color: '#000',
              borderRadius: 0,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
