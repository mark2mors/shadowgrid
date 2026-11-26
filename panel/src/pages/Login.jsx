import React, { useState } from 'react';
import { api, setToken } from '../api';
import { LogoFull } from '../components/Logo';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username, password);
      if (res.token) {
        setToken(res.token);
        onLogin();
      } else {
        setError(res.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection failed');
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <LogoFull width={260} height={60} showTagline={true} />
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input className="form-input" type="text" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-green" type="submit" style={{ width: '100%', padding: '12px', fontSize: 12 }} disabled={loading}>
            {loading ? 'AUTHENTICATING...' : 'LOGIN'}
          </button>
        </form>
      </div>
    </div>
  );
}
