export interface BrowserInput {
  actions: Action[];
  stealth?: boolean;
  human_like?: boolean;
  profile?: string;
  viewport?: { width: number; height: number };
  user_agent?: string;
  proxy?: { server: string; username?: string; password?: string };
  locale?: string;
  timezone?: string;
  extra_headers?: Record<string, string>;
  on_error?: "abort" | "continue";
}

export type Action =
  | { action: "navigate"; url: string; wait_until?: "load" | "domcontentloaded" | "networkidle" | "commit" }
  | { action: "click"; selector: string; button?: "left" | "right" | "middle"; click_count?: number }
  | { action: "type"; selector: string; text: string; delay?: number }
  | { action: "clear_and_type"; selector: string; text: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "select"; selector: string; values: string | string[] }
  | { action: "press_key"; key: string; modifiers?: string[] }
  | { action: "hover"; selector: string }
  | { action: "scroll"; direction?: "up" | "down" | "left" | "right"; amount?: number; selector?: string }
  | { action: "drag_drop"; source: string; target: string }
  | { action: "screenshot"; full_page?: boolean; selector?: string; clip?: { x: number; y: number; width: number; height: number }; output_filename?: string }
  | { action: "extract"; selector: string; attribute?: string; multiple?: boolean; format?: "text" | "html" }
  | { action: "evaluate"; script: string }
  | { action: "wait"; selector?: string; navigation?: boolean; state?: "visible" | "hidden" | "attached" | "detached"; timeout?: number; load_state?: "load" | "domcontentloaded" | "networkidle" }
  | { action: "upload"; selector: string; file_path: string }
  | { action: "go_back" }
  | { action: "go_forward" }
  | { action: "get_cookies"; urls?: string[] }
  | { action: "set_cookies"; cookies: Array<{ name: string; value: string; url?: string; domain?: string; path?: string }> }
  | { action: "pdf"; output_filename?: string; format?: string; print_background?: boolean };

export interface ActionResult {
  action: string;
  success: boolean;
  data?: any;
  error?: string;
  elapsed_ms: number;
}

export interface BrowserOutput {
  results: ActionResult[];
  elapsed_ms: number;
}
