import React from 'react';

export default function DataTable({ columns, data, onRowClick, emptyMessage }) {
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(!data || data.length === 0) ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-disabled)', padding: 24 }}>
                {emptyMessage || 'No data'}
              </td>
            </tr>
          ) : data.map((row, ri) => (
            <tr key={ri} onClick={() => onRowClick?.(row)} className={onRowClick ? 'agent-row' : ''}>
              {columns.map((col, ci) => (
                <td key={ci} style={col.style}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
