import React from 'react';
import { DashboardIcon, AgentsIcon, CredentialsIcon, FilesIcon, ListenersIcon, BuilderIcon, SettingsIcon } from '../icons';

const items = [
  { id: 'dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { id: 'agents', label: 'Agents', Icon: AgentsIcon },
  { id: 'credentials', label: 'Credentials', Icon: CredentialsIcon },
  { id: 'files', label: 'Files', Icon: FilesIcon },
  { id: 'listeners', label: 'Listeners', Icon: ListenersIcon },
  { id: 'builder', label: 'Builder', Icon: BuilderIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function Sidebar({ active, onNavigate }) {
  return (
    <div style={{
      width: 60, minWidth: 60, background: '#191b20',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 12, gap: 4, zIndex: 10,
    }}>
      {items.map(item => (
        <div
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            width: 44, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            borderLeft: active === item.id ? '2px solid var(--green)' : '2px solid transparent',
            background: active === item.id ? 'rgba(255,255,255,0.05)' : 'transparent',
            position: 'relative',
          }}
          title={item.label}
        >
          <item.Icon active={active === item.id} />
        </div>
      ))}
    </div>
  );
}
