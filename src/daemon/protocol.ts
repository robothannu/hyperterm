/**
 * htptyd IPC protocol — line-delimited JSON over unix domain socket.
 *
 * All messages are serialized as single JSON lines (no newlines inside).
 * Each message ends with '\n'. The daemon reads line-by-line.
 *
 * Sprint 2: CREATE / LIST / KILL / PING / SHUTDOWN
 * Sprint 3: SPAWN_OWNED / ATTACH / DETACH / INPUT / RESIZE (streaming PTY proxy)
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

// Sprint 3: daemon spawns and owns a PTY from the start (pinned group).
// Returns SPAWNED response with the PTY id.
export interface SpawnOwnedRequest {
  type: "SPAWN_OWNED";
  /** Working directory for the new PTY. */
  cwd?: string;
  /** Command to run. Defaults to $SHELL. */
  cmd?: string;
  /** cols for initial terminal size */
  cols?: number;
  /** rows for initial terminal size */
  rows?: number;
  /** Group label (informational, stored in PtyEntry for LIST response) */
  groupLabel?: string;
}

// Sprint 3: attach a streaming connection to an existing daemon-owned PTY.
// After ATTACH is sent, the same socket connection becomes a streaming pipe:
//   daemon→client: ATTACHED response, then raw PTY output chunks (DATA messages)
//   client→daemon: INPUT messages (keystroke data), RESIZE messages, DETACH
// The socket stays open until DETACH or connection close.
export interface AttachRequest {
  type: "ATTACH";
  id: string;
}

// Sprint 3: detach from a streaming PTY connection (daemon keeps PTY alive).
export interface DetachRequest {
  type: "DETACH";
  id: string;
}

// Sprint 3: send keystroke data to a daemon-owned PTY (sent over streaming socket).
export interface InputRequest {
  type: "INPUT";
  id: string;
  data: string;
}

// Sprint 3: resize a daemon-owned PTY.
export interface ResizeRequest {
  type: "RESIZE";
  id: string;
  cols: number;
  rows: number;
}

export type DaemonRequest =
  | PingRequest
  | CreateRequest
  | ListRequest
  | KillRequest
  | ShutdownRequest
  | SpawnOwnedRequest
  | AttachRequest
  | DetachRequest
  | InputRequest
  | ResizeRequest;

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
  /** Present for daemon-owned (pinned) PTYs. */
  groupLabel?: string;
  /** true if this PTY was spawned for a pinned group */
  owned?: boolean;
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

// Sprint 3: response to SPAWN_OWNED
export interface SpawnedResponse {
  type: "SPAWNED";
  id: string;
  cwd: string;
  pid: number;
}

// Sprint 3: response to ATTACH (sent once; then DATA messages follow)
export interface AttachedResponse {
  type: "ATTACHED";
  id: string;
}

// Sprint 3: streaming PTY output chunk (daemon → client on attached socket)
export interface DataResponse {
  type: "DATA";
  id: string;
  /** Base64-encoded PTY output (to avoid newline issues in JSON lines) */
  b64: string;
}

// Sprint 3: PTY exit notification on streaming socket
export interface PtyExitResponse {
  type: "PTY_EXIT";
  id: string;
  exitCode: number;
}

export type DaemonResponse =
  | PongResponse
  | CreateResponse
  | ListResponse
  | KilledResponse
  | ErrorResponse
  | OkResponse
  | SpawnedResponse
  | AttachedResponse
  | DataResponse
  | PtyExitResponse;
