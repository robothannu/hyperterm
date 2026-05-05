// Shared pane tree types used across renderer modules

type AgentHookState = "idle" | "working" | "waiting_approval" | "done";

interface PaneLeaf {
  type: "leaf";
  ptyId: number;
  session: TerminalSession;
  element: HTMLElement;
  agentStatus: boolean;
  agentState: AgentHookState;
  // session_id from Claude Code hook, mapped after first hook event
  hookSessionId?: string;
}

interface PaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
  element: HTMLElement;
  divider: HTMLElement;
}

type PaneNode = PaneLeaf | PaneSplit;

interface Tab {
  id: number;
  root: PaneNode;
  container: HTMLElement;
  focusedPtyId: number;
  // Sprint (Run with Claude polish): if this tab/group was created via the
  // "Run with Claude" footer button, the workspace cwd it was opened with is
  // stored here for dedup. undefined for normal terminals. Used by
  // onOpenGroupWithCwdWithClaude to switch to an existing claude tab instead
  // of spawning a duplicate. NOTE: only set for taskText-less opens — Ask
  // Claude (with a prompt) always creates a new tab.
  claudeCwd?: string;
}

// Persistence types
interface SavedPaneLeaf {
  type: "leaf";
  sessionKey: string;
  cwd?: string;
  // Sprint 1 (Session Restore): ANSI serialized scrollback from SerializeAddon.
  // Optional — absent for new sessions or when capture fails. Max ~200 KB per leaf.
  scrollback?: string;
  // ISO timestamp of when the snapshot was captured (for divider display).
  snapshotSavedAt?: string;
}
interface SavedPaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [SavedPaneNode, SavedPaneNode];
}
type SavedPaneNode = SavedPaneLeaf | SavedPaneSplit;
interface SavedTab {
  label: string;
  cluster?: string;
  layout: SavedPaneNode;
  layoutPreset?: string;
  // Sprint (Run with Claude polish): persisted so claude-tab dedup survives
  // app restart. PTYs themselves don't survive restart, but the group meta
  // does — when this tab restores, its claudeCwd is repopulated and a
  // subsequent "Run with Claude" click will switch to it instead of creating
  // a duplicate.
  claudeCwd?: string;
}
interface SavedStateV2 {
  version: 3;
  tabs: SavedTab[];
  activeTabIndex: number;
}
