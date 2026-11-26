import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState({});
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
    api.getActivity(20).then(setActivity).catch(() => {});
    const interval = setInterval(() => {
      api.getStats().then(setStats).catch(() => {});
      api.getActivity(20).then(setActivity).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="page-title">// DASHBOARD</div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Active Agents</div>
          <div className="value green">{stats.active_agents || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Tasks Today</div>
          <div className="value">{stats.tasks_today || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Credentials</div>
          <div className="value">{stats.credentials || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Listeners</div>
          <div className="value">{stats.active_listeners || 0} / {stats.total_listeners || 0}</div>
        </div>
      </div>

      <div className="two-col">
        {/* AGENT MAP */}
        <div className="panel">
          <div className="panel-header">Agent Map</div>
          <div className="panel-body">
            <div className="map-container">
              <svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg">
                <g fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8">
                  <path d="M120,80 L180,60 L250,70 L280,100 L290,130 L270,160 L230,180 L200,200 L170,210 L140,230 L130,200 L100,170 L90,130 L100,90Z"/>
                  <path d="M200,250 L230,240 L260,260 L280,300 L290,340 L280,380 L250,420 L220,440 L200,420 L190,380 L180,340 L185,300 L190,270Z"/>
                  <path d="M440,80 L470,70 L510,75 L530,90 L520,120 L500,140 L470,150 L450,140 L430,120 L435,95Z"/>
                  <path d="M440,170 L480,160 L520,170 L540,200 L550,250 L540,300 L520,340 L490,370 L460,370 L440,340 L430,300 L425,250 L430,210Z"/>
                  <path d="M540,60 L600,50 L680,55 L750,70 L800,90 L820,120 L800,150 L770,170 L720,180 L660,175 L600,165 L560,150 L540,120 L535,90Z"/>
                  <path d="M640,180 L670,180 L690,210 L680,250 L660,270 L640,260 L630,230 L635,200Z"/>
                  <path d="M760,310 L810,300 L850,310 L870,340 L860,370 L830,390 L790,390 L770,370 L755,340Z"/>
                  <path d="M830,100 L835,120 L840,140 L835,155 L825,140 L820,115Z"/>
                </g>
                <text x="500" y="250" textAnchor="middle" fill="var(--text-disabled)" fontFamily="var(--font-mono)" fontSize="11" style={{textTransform:'uppercase',letterSpacing:2}}>
                  {stats.active_agents ? `${stats.active_agents} agents connected` : 'No agents connected'}
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* RECENT ACTIVITY */}
        <div className="panel">
          <div className="panel-header">Recent Activity</div>
          <div className="panel-body">
            <div className="log-feed">
              {(!activity || activity.length === 0) ? (
                <div style={{ color: 'var(--text-disabled)' }}>No activity yet</div>
              ) : activity.map((a, i) => (
                <div key={i}>
                  <span className="log-time">[{a.created_at ? new Date(a.created_at).toLocaleTimeString() : ''}]</span>{' '}
                  <span className={a.type === 'error' ? 'log-error' : a.type === 'warn' ? 'log-warn' : 'log-success'}>
                    {a.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* TIMELINE */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">Agent Timeline — Last 24 Hours</div>
        <div className="panel-body">
          <div className="timeline-chart">
            {Array.from({ length: 48 }, (_, i) => {
              const h = Math.random() * 50 + 10;
              return <div key={i} className="timeline-bar" style={{ height: h, opacity: 0.3 + Math.random() * 0.5 }} />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
