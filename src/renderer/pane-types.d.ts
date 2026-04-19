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
}

// Persistence types
interface SavedPaneLeaf {
  type: "leaf";
  sessionKey: string;
  cwd?: string;
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
}
interface SavedStateV2 {
  version: 3;
  tabs: SavedTab[];
  activeTabIndex: number;
}
