// Environment-configurable backend URLs for Vite frontend
const rawEnvUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').trim();

function resolveBackendUrls() {
  const isBrowser = typeof window !== 'undefined';
  const isHttps = isBrowser && window.location.protocol === 'https:';

  if (rawEnvUrl) {
    const clean = rawEnvUrl.replace(/\/+$/, '');

    // Handle full HTTP / HTTPS URLs
    if (/^https?:\/\//i.test(clean)) {
      const httpUrl = clean;
      const wsUrl = clean.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
      try {
        const urlObj = new URL(httpUrl);
        return {
          wsUrl,
          httpUrl,
          host: urlObj.host,
          label: urlObj.port ? `:${urlObj.port}` : urlObj.hostname
        };
      } catch {
        const host = clean.replace(/^https?:\/\//i, '');
        return { wsUrl, httpUrl, host, label: host };
      }
    }

    // Handle full WS / WSS URLs
    if (/^wss?:\/\//i.test(clean)) {
      const wsUrl = clean;
      const httpUrl = clean.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      const hostPart = clean.replace(/^wss?:\/\//i, '');
      const portMatch = hostPart.match(/:(\d+)$/);
      return {
        wsUrl,
        httpUrl,
        host: hostPart,
        label: portMatch ? `:${portMatch[1]}` : hostPart
      };
    }

    // Host without scheme (e.g. "sih-vox.onrender.com" or "localhost:8000")
    const isLocal = clean.includes('localhost') || clean.includes('127.0.0.1');
    const wsScheme = (isHttps || !isLocal) ? 'wss:' : 'ws:';
    const httpScheme = (isHttps || !isLocal) ? 'https:' : 'http:';
    const portMatch = clean.match(/:(\d+)$/);

    return {
      wsUrl: `${wsScheme}//${clean}`,
      httpUrl: `${httpScheme}//${clean}`,
      host: clean,
      label: portMatch ? `:${portMatch[1]}` : clean
    };
  }

  // Fallback when no env variable is defined
  const isLocalhost = isBrowser &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocalhost) {
    return {
      wsUrl: 'ws://localhost:8000',
      httpUrl: 'http://localhost:8000',
      host: 'localhost:8000',
      label: ':8000'
    };
  }

  // Production fallback for deployed dashboard (e.g. on Vercel)
  return {
    wsUrl: 'wss://sih-vox.onrender.com',
    httpUrl: 'https://sih-vox.onrender.com',
    host: 'sih-vox.onrender.com',
    label: 'sih-vox.onrender.com'
  };
}

const resolved = resolveBackendUrls();

export const BACKEND_WS_URL = resolved.wsUrl;
export const BACKEND_HTTP_URL = resolved.httpUrl;
export const BACKEND_HOST = resolved.host;
export const BACKEND_LABEL = resolved.label;
