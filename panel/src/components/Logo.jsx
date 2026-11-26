import React from 'react';

// ShadowGrid Logo - Grid dissolving into shadow with isometric perspective
// Premium cyber security aesthetic: geometric, angular, technical

export function LogoIcon({ size = 40 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sg-icon-fade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="1"/>
          <stop offset="60%" stopColor="#00ff88" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0.05"/>
        </linearGradient>
        <linearGradient id="sg-icon-shadow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1f2228" stopOpacity="0"/>
          <stop offset="50%" stopColor="#1f2228" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#1f2228" stopOpacity="0.95"/>
        </linearGradient>
        <clipPath id="sg-icon-clip">
          <rect x="2" y="2" width="36" height="36"/>
        </clipPath>
      </defs>
      <g clipPath="url(#sg-icon-clip)">
        {/* Isometric grid - 5x5 diamond grid */}
        {/* Horizontal grid lines (isometric) */}
        {[0,1,2,3,4,5].map(i => (
          <line key={`h${i}`} x1="2" y1={2 + i*7.2} x2="38" y2={2 + i*7.2}
            stroke="url(#sg-icon-fade)" strokeWidth="0.8" opacity={1 - i*0.12}/>
        ))}
        {/* Vertical grid lines */}
        {[0,1,2,3,4,5].map(i => (
          <line key={`v${i}`} x1={2 + i*7.2} y1="2" x2={2 + i*7.2} y2="38"
            stroke="url(#sg-icon-fade)" strokeWidth="0.8" opacity={1 - i*0.12}/>
        ))}
        {/* Diagonal perspective lines */}
        <line x1="2" y1="2" x2="20" y2="20" stroke="#00ff88" strokeWidth="0.5" opacity="0.4"/>
        <line x1="38" y1="2" x2="20" y2="20" stroke="#00ff88" strokeWidth="0.5" opacity="0.3"/>
        <line x1="2" y1="38" x2="20" y2="20" stroke="#00ff88" strokeWidth="0.5" opacity="0.2"/>
        {/* Shadow overlay - dissolves bottom-right */}
        <rect x="2" y="2" width="36" height="36" fill="url(#sg-icon-shadow)"/>
        {/* Corner accent nodes */}
        <rect x="1" y="1" width="3" height="3" fill="#00ff88" opacity="0.9"/>
        <rect x="8.2" y="1" width="2" height="2" fill="#00ff88" opacity="0.6"/>
        <rect x="1" y="8.2" width="2" height="2" fill="#00ff88" opacity="0.6"/>
        {/* Bright accent line on top-left edge */}
        <line x1="2" y1="2" x2="20" y2="2" stroke="#00ff88" strokeWidth="1.5" opacity="0.9"/>
        <line x1="2" y1="2" x2="2" y2="20" stroke="#00ff88" strokeWidth="1.5" opacity="0.9"/>
      </g>
    </svg>
  );
}

export function LogoFull({ width = 200, height = 48, showTagline = false }) {
  return (
    <svg viewBox="0 0 280 60" width={width} height={height} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sg-grid-fade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="1"/>
          <stop offset="55%" stopColor="#00ff88" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0.02"/>
        </linearGradient>
        <linearGradient id="sg-shadow-overlay" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1f2228" stopOpacity="0"/>
          <stop offset="40%" stopColor="#1f2228" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#1f2228" stopOpacity="0.92"/>
        </linearGradient>
        <linearGradient id="sg-text-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.7"/>
        </linearGradient>
        <linearGradient id="sg-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0"/>
        </linearGradient>
        <filter id="sg-blur">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5"/>
        </filter>
        <clipPath id="sg-grid-clip">
          <path d="M4,4 L50,4 L50,50 L4,50 Z"/>
        </clipPath>
      </defs>

      {/* === GRID ICON (left side) === */}
      <g transform="translate(4, 5)">
        {/* Glow effect behind grid */}
        <rect x="0" y="0" width="50" height="50" fill="url(#sg-glow)" filter="url(#sg-blur)" opacity="0.5"/>

        <g clipPath="url(#sg-grid-clip)">
          {/* Isometric grid with perspective vanishing point */}
          {/* Main grid lines - horizontal */}
          {[0,1,2,3,4,5,6].map(i => (
            <line key={`fh${i}`} x1="0" y1={i*8} x2="52" y2={i*8}
              stroke="url(#sg-grid-fade)" strokeWidth={i < 3 ? "1" : "0.6"}
              opacity={Math.max(0.1, 1 - i*0.15)}/>
          ))}
          {/* Main grid lines - vertical */}
          {[0,1,2,3,4,5,6].map(i => (
            <line key={`fv${i}`} x1={i*8} y1="0" x2={i*8} y2="52"
              stroke="url(#sg-grid-fade)" strokeWidth={i < 3 ? "1" : "0.6"}
              opacity={Math.max(0.1, 1 - i*0.15)}/>
          ))}

          {/* Perspective diagonals converging to center-right */}
          <line x1="0" y1="0" x2="48" y2="24" stroke="#00ff88" strokeWidth="0.4" opacity="0.35"/>
          <line x1="0" y1="16" x2="48" y2="28" stroke="#00ff88" strokeWidth="0.3" opacity="0.25"/>
          <line x1="0" y1="32" x2="48" y2="32" stroke="#00ff88" strokeWidth="0.3" opacity="0.2"/>
          <line x1="0" y1="48" x2="48" y2="36" stroke="#00ff88" strokeWidth="0.3" opacity="0.15"/>

          {/* Particle/fragment effect on dissolving edge */}
          <rect x="34" y="6" width="2" height="2" fill="#00ff88" opacity="0.4"/>
          <rect x="38" y="14" width="1.5" height="1.5" fill="#00ff88" opacity="0.3"/>
          <rect x="42" y="10" width="1" height="1" fill="#00ff88" opacity="0.25"/>
          <rect x="36" y="22" width="1.5" height="1.5" fill="#00ff88" opacity="0.2"/>
          <rect x="40" y="30" width="1" height="1" fill="#00ff88" opacity="0.15"/>
          <rect x="44" y="20" width="0.8" height="0.8" fill="#00ff88" opacity="0.12"/>
          <rect x="46" y="26" width="0.6" height="0.6" fill="#00ff88" opacity="0.1"/>
          <rect x="32" y="34" width="1.5" height="1.5" fill="#00ff88" opacity="0.18"/>
          <rect x="38" y="38" width="1" height="1" fill="#00ff88" opacity="0.1"/>

          {/* Shadow overlay - bottom-right dissolve */}
          <rect x="0" y="0" width="52" height="52" fill="url(#sg-shadow-overlay)"/>
        </g>

        {/* Border frame - top-left bright, fading to bottom-right */}
        <line x1="0" y1="0" x2="50" y2="0" stroke="#00ff88" strokeWidth="2" opacity="0.9"/>
        <line x1="0" y1="0" x2="0" y2="50" stroke="#00ff88" strokeWidth="2" opacity="0.9"/>
        <line x1="50" y1="0" x2="50" y2="50" stroke="#00ff88" strokeWidth="1" opacity="0.15"/>
        <line x1="0" y1="50" x2="50" y2="50" stroke="#00ff88" strokeWidth="1" opacity="0.15"/>

        {/* Corner nodes */}
        <rect x="-1" y="-1" width="4" height="4" fill="#00ff88" opacity="1"/>
        <rect x="48" y="-1" width="4" height="4" fill="#00ff88" opacity="0.3"/>
        <rect x="-1" y="48" width="4" height="4" fill="#00ff88" opacity="0.3"/>
        <rect x="48" y="48" width="4" height="4" fill="#00ff88" opacity="0.08"/>

        {/* Inner bright node accents */}
        <rect x="7" y="7" width="2.5" height="2.5" fill="#00ff88" opacity="0.7"/>
        <rect x="15" y="7" width="2" height="2" fill="#00ff88" opacity="0.5"/>
        <rect x="7" y="15" width="2" height="2" fill="#00ff88" opacity="0.5"/>
        <rect x="15" y="15" width="2" height="2" fill="#00ff88" opacity="0.35"/>
        <rect x="23" y="7" width="1.5" height="1.5" fill="#00ff88" opacity="0.3"/>
        <rect x="7" y="23" width="1.5" height="1.5" fill="#00ff88" opacity="0.3"/>
      </g>

      {/* === TEXT === */}
      <g transform="translate(66, 0)">
        {/* SHADOW - white text */}
        <text x="0" y="34" fontFamily="'Geist Mono', monospace" fontSize="26" fontWeight="700"
          letterSpacing="4" fill="url(#sg-text-fade)">SHADOW</text>
        {/* GRID - green accent */}
        <text x="150" y="34" fontFamily="'Geist Mono', monospace" fontSize="26" fontWeight="700"
          letterSpacing="4" fill="#00ff88">GRID</text>

        {/* Subtle underline */}
        <line x1="0" y1="40" x2="80" y2="40" stroke="#00ff88" strokeWidth="1" opacity="0.4"/>
        <line x1="80" y1="40" x2="210" y2="40" stroke="#00ff88" strokeWidth="0.5" opacity="0.15"/>

        {showTagline && (
          <text x="0" y="54" fontFamily="'Geist Mono', monospace" fontSize="8"
            letterSpacing="3" fill="rgba(255,255,255,0.3)" textTransform="uppercase">
            COMMAND &amp; CONTROL FRAMEWORK
          </text>
        )}
      </g>
    </svg>
  );
}

export function LogoSidebar({ size = 36 }) {
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sg-sb-fade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="1"/>
          <stop offset="60%" stopColor="#00ff88" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0.03"/>
        </linearGradient>
        <linearGradient id="sg-sb-shadow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#191b20" stopOpacity="0"/>
          <stop offset="50%" stopColor="#191b20" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#191b20" stopOpacity="0.9"/>
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[0,1,2,3,4].map(i => (
        <line key={`sh${i}`} x1="2" y1={2 + i*8} x2="34" y2={2 + i*8}
          stroke="url(#sg-sb-fade)" strokeWidth="0.7" opacity={1 - i*0.18}/>
      ))}
      {[0,1,2,3,4].map(i => (
        <line key={`sv${i}`} x1={2 + i*8} y1="2" x2={2 + i*8} y2="34"
          stroke="url(#sg-sb-fade)" strokeWidth="0.7" opacity={1 - i*0.18}/>
      ))}
      {/* Shadow overlay */}
      <rect x="2" y="2" width="32" height="32" fill="url(#sg-sb-shadow)"/>
      {/* Frame */}
      <line x1="2" y1="2" x2="34" y2="2" stroke="#00ff88" strokeWidth="1.5" opacity="0.8"/>
      <line x1="2" y1="2" x2="2" y2="34" stroke="#00ff88" strokeWidth="1.5" opacity="0.8"/>
      <line x1="34" y1="2" x2="34" y2="34" stroke="#00ff88" strokeWidth="0.6" opacity="0.12"/>
      <line x1="2" y1="34" x2="34" y2="34" stroke="#00ff88" strokeWidth="0.6" opacity="0.12"/>
      {/* Corner node */}
      <rect x="1" y="1" width="3" height="3" fill="#00ff88"/>
      {/* Inner nodes */}
      <rect x="9" y="9" width="2" height="2" fill="#00ff88" opacity="0.6"/>
      <rect x="17" y="9" width="1.5" height="1.5" fill="#00ff88" opacity="0.35"/>
      <rect x="9" y="17" width="1.5" height="1.5" fill="#00ff88" opacity="0.35"/>
    </svg>
  );
}

export function LogoTopBar({ height = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LogoIcon size={height} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 2,
      }}>
        <span style={{ color: 'var(--green)' }}>SHADOW</span>GRID
      </span>
    </div>
  );
}
