import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useInteract - WebSocket hook for interactive agent sessions.
 * 
 * Opens a persistent WebSocket to the server. Commands go over WebSocket,
 * results are pushed back instantly when the agent responds.
 * 
 * Falls back gracefully: if WebSocket fails, `connected` stays false and
 * callers should use sendAndPoll instead.
 */
export default function useInteract(agentId) {
  const [connected, setConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const wsRef = useRef(null);
  const callbacksRef = useRef(new Map()); // task_id -> { resolve, reject, timer }
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      const token = localStorage.getItem('sg_token');
      if (!token || !agentId) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}/api/v1/interact?agent_id=${agentId}&token=${token}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (mountedRef.current) setConnected(true);
      };

      ws.onclose = () => {
        if (mountedRef.current) {
          setConnected(false);
          // Auto-reconnect after 3 seconds
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        if (mountedRef.current) setConnected(false);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === 'result') {
            // Parse JSON output if possible
            let parsed;
            try { parsed = JSON.parse(msg.output); } catch { parsed = msg.output; }

            // Call registered callback if any
            const cb = callbacksRef.current.get(msg.task_id);
            if (cb) {
              clearTimeout(cb.timer);
              cb.resolve(parsed);
              callbacksRef.current.delete(msg.task_id);
            }
          } else if (msg.type === 'agent_status') {
            if (mountedRef.current) setAgentStatus(msg.status);
          }
          // task_created is handled inside the send() promise chain
        } catch {}
      };
    }

    connect();

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      mountedRef.current = false;
      clearInterval(pingInterval);
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      // Reject any pending callbacks
      callbacksRef.current.forEach((cb) => {
        clearTimeout(cb.timer);
        cb.reject(new Error('Disconnected'));
      });
      callbacksRef.current.clear();
    };
  }, [agentId]);

  /**
   * Send a command and return a promise that resolves when the result arrives.
   * Returns null if not connected (caller should fallback to sendAndPoll).
   */
  const send = useCallback((taskType, args = {}, timeoutMs = 120000) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      // We need to listen for task_created to get the task_id,
      // then register a callback for that task_id
      const handler = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'task_created') {
            wsRef.current.removeEventListener('message', handler);

            // Set up timeout
            const timer = setTimeout(() => {
              if (callbacksRef.current.has(msg.task_id)) {
                callbacksRef.current.delete(msg.task_id);
                reject(new Error('Timeout'));
              }
            }, timeoutMs);

            // Register callback for the result
            callbacksRef.current.set(msg.task_id, { resolve, reject, timer });
          } else if (msg.type === 'error') {
            wsRef.current.removeEventListener('message', handler);
            reject(new Error(msg.error || 'Server error'));
          }
        } catch {}
      };

      wsRef.current.addEventListener('message', handler);

      // Also set a short timeout for getting task_created acknowledgment
      setTimeout(() => {
        wsRef.current?.removeEventListener('message', handler);
      }, 10000);

      wsRef.current.send(JSON.stringify({ type: taskType, args }));
    });
  }, []);

  return { connected, send, agentStatus };
}
