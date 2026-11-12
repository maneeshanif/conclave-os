import { API } from './api';

/** A message from the server's live socket. Only `kind` matters to most pages. */
export interface LiveMessage {
  kind: string;
  [key: string]: unknown;
}

/**
 * Listens to the server's live updates (SPEC 12) over one WebSocket and reconnects if it drops. Returns the function
 * that stops listening. Client side only: call it from an effect.
 */
export function socketEvents(onMessage: (m: LiveMessage) => void): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    socket = new WebSocket(`${API.replace(/^http/, 'ws')}/events`);
    socket.onclose = () => {
      if (!stopped) retry = setTimeout(connect, 2000);
    };
    socket.onmessage = (msg) => {
      try {
        onMessage(JSON.parse(String(msg.data)) as LiveMessage);
      } catch {
        // A message that is not JSON is not for us.
      }
    };
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}
