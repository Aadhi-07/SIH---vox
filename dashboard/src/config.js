export const BACKEND_HOST = window.location.hostname;
const PROTOCOL = window.location.protocol;
const WS_PROTOCOL = PROTOCOL === 'https:' ? 'wss:' : 'ws:';

export const BACKEND_WS_URL = `${WS_PROTOCOL}//${BACKEND_HOST}:8000`;
export const BACKEND_HTTP_URL = `${PROTOCOL}//${BACKEND_HOST}:8000`;
