import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "../../shared/activity";
import { applyOp } from "../../shared/reducer";
import type { ClientMessage, Doc, Op, ServerMessage } from "../../shared/types";
import { KEY_CLOSE_CODE } from "../../shared/keys";
import { newId } from "../../shared/validate";
import { getKey, keyProblemOf, takeKeyFromHash } from "./keys";

/** "locked": the project is protected and this browser's key is missing or no longer valid. */
export type ConnectionStatus = "connecting" | "open" | "offline" | "locked";

interface Pending {
  opId: string;
  op: Op;
}

/**
 * Keeps a project document in sync with its Durable Object.
 *
 * Local edits are applied optimistically and queued as pending ops. The server
 * applies ops in the order it receives them and broadcasts each one; every
 * client folds those into its `confirmed` copy, drops its own ops as they are
 * echoed back, and re-applies whatever is still pending on top. Because the
 * reducer is shared and deterministic, everyone converges on the same state.
 */
export function useProject(projectId: string) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [peers, setPeers] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  /** Why the server refused this browser's key, while `status` is "locked". */
  const [keyProblem, setKeyProblem] = useState<"required" | "invalid" | null>(null);

  const confirmed = useRef<Doc | null>(null);
  const pending = useRef<Pending[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const activityListeners = useRef(new Set<(entries: ActivityEntry[]) => void>());
  const reconnect = useRef<() => void>(() => {});

  const recompute = useCallback(() => {
    let next = confirmed.current;
    if (!next) return;
    const now = Date.now();
    for (const p of pending.current) next = applyOp(next, p.op, now);
    setDoc(next);
    setPendingCount(pending.current.length);
  }, []);

  const send = (ws: WebSocket | null, p: Pending) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: "op", opId: p.opId, op: p.op } satisfies ClientMessage));
  };

  useEffect(() => {
    confirmed.current = null;
    pending.current = [];
    setDoc(null);

    let disposed = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const handle = (msg: ServerMessage) => {
      switch (msg.t) {
        case "init":
          setKeyProblem(null);
          confirmed.current = msg.doc;
          setPeers(msg.peers);
          // Ops are idempotent, so resending anything unacknowledged is safe.
          for (const p of pending.current) send(socket.current, p);
          break;
        case "reset":
          confirmed.current = msg.doc;
          break;
        case "op":
          if (confirmed.current) confirmed.current = applyOp(confirmed.current, msg.op, msg.at);
          pending.current = pending.current.filter((p) => p.opId !== msg.opId);
          break;
        case "ack":
          pending.current = pending.current.filter((p) => p.opId !== msg.opId);
          break;
        case "presence":
          setPeers(msg.peers);
          return;
        case "activity":
          for (const listener of activityListeners.current) listener(msg.entries);
          return;
      }
      recompute();
    };

    takeKeyFromHash(projectId);

    const connect = () => {
      clearTimeout(retryTimer);
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const key = getKey(projectId);
      const query = key ? `?key=${encodeURIComponent(key)}` : "";
      const ws = new WebSocket(`${proto}://${location.host}/api/p/${projectId}/ws${query}`);
      socket.current = ws;
      setStatus(retries === 0 ? "connecting" : "offline");

      let opened = false;
      ws.onopen = () => {
        opened = true;
        retries = 0;
        setStatus("open");
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          handle(JSON.parse(e.data));
        } catch (err) {
          console.error("Bad message from server", err);
        }
      };
      const lock = (problem: "required" | "invalid") => {
        // Retrying won't help: wait for a key. Don't keep showing a board this browser can't access.
        confirmed.current = null;
        setDoc(null);
        setKeyProblem(problem);
        setStatus("locked");
      };
      const retryLater = () => {
        setStatus("offline");
        retryTimer = setTimeout(connect, Math.min(10_000, 400 * 2 ** retries++));
      };

      ws.onclose = async (e) => {
        clearInterval(pingTimer);
        if (disposed || socket.current !== ws) return;
        // A key saved since this socket connected (e.g. the first key, just created here) may work.
        const keyChanged = getKey(projectId) !== key;
        if (e.code === KEY_CLOSE_CODE) {
          if (keyChanged) return reconnect.current();
          return lock(e.reason === "invalid" ? "invalid" : "required");
        }
        // The server answers an upgrade without a valid key with a 401 that the browser hides;
        // a failed first connection could be that, or just the network. Ask over HTTP.
        if (!opened && !keyChanged) {
          const problem = await keyProblemOf(projectId);
          if (disposed || socket.current !== ws) return;
          if (problem) return lock(problem);
        }
        retryLater();
      };
    };

    // Reconnect immediately when the tab regains focus or the network returns.
    const wake = () => {
      if (document.visibilityState === "visible" && socket.current?.readyState === WebSocket.CLOSED) {
        retries = 0;
        connect();
      }
    };

    reconnect.current = () => {
      retries = 0;
      socket.current?.close();
      connect();
    };
    // A link with a key pasted into the address bar of an open project only changes the hash.
    const onHash = () => takeKeyFromHash(projectId) && reconnect.current();

    connect();
    window.addEventListener("online", wake);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      window.removeEventListener("online", wake);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", wake);
      socket.current?.close();
      socket.current = null;
    };
  }, [projectId, recompute]);

  const dispatch = useCallback(
    (op: Op) => {
      const p = { opId: newId(), op };
      pending.current.push(p);
      send(socket.current, p);
      recompute();
    },
    [recompute],
  );

  /** Calls `listener` with feed entries as they're recorded; returns an unsubscribe function. */
  const subscribeActivity = useCallback((listener: (entries: ActivityEntry[]) => void) => {
    activityListeners.current.add(listener);
    return () => {
      activityListeners.current.delete(listener);
    };
  }, []);

  /** Connects again, e.g. after the user enters a key. */
  const retry = useCallback(() => reconnect.current(), []);

  return { doc, status, peers, pendingCount, keyProblem, retry, dispatch, subscribeActivity };
}
