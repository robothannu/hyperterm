/**
 * htptyd IPC protocol — line-delimited JSON over unix domain socket.
 *
 * All messages are serialized as single JSON lines (no newlines inside).
 * Each message ends with '\n'. The daemon reads line-by-line.
 *
 * Sprint 2: CREATE / LIST / KILL / PING / SHUTDOWN
 * Sprint 3 will add: ADOPT / ATTACH / DETACH
 */

// ---- Request messages (client → daemon) ----

export interface PingRequest {
  type: "PING";
}

export interface CreateRequest {
  type: "CREATE";
  /** Working directory for the new PTY. Defaults to $HOME if not provided. */
  cwd?: string;
  /** Command to run. Defaults to user's $SHELL. */
  cmd?: string;
}

export interface ListRequest {
  type: "LIST";
}

export interface KillRequest {
  type: "KILL";
  /** PTY id returned by CreateResponse */
  id: string;
}

export interface ShutdownRequest {
  type: "SHUTDOWN";
}

export type DaemonRequest =
  | PingRequest
  | CreateRequest
  | ListRequest
  | KillRequest
  | ShutdownRequest;

// ---- Response messages (daemon → client) ----

export interface PongResponse {
  type: "PONG";
}

export interface CreateResponse {
  type: "CREATED";
  id: string;
  cwd: string;
  pid: number;
}

export interface PtyInfo {
  id: string;
  cwd: string;
  pid: number;
}

export interface ListResponse {
  type: "LIST";
  ptys: PtyInfo[];
}

export interface KilledResponse {
  type: "KILLED";
  id: string;
}

export interface ErrorResponse {
  type: "ERROR";
  message: string;
}

export interface OkResponse {
  type: "OK";
}

export type DaemonResponse =
  | PongResponse
  | CreateResponse
  | ListResponse
  | KilledResponse
  | ErrorResponse
  | OkResponse;
