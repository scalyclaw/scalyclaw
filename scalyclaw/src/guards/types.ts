export interface GuardResult {
  passed: boolean;
  guardType: 'message' | 'skill' | 'agent' | 'command';
  failedLayer?: string;
  reason?: string;
  score?: number;
  durationMs: number;
}

export interface GuardConfig {
  enabled: boolean;
  model: string;
  message: {
    enabled: boolean;
    echoGuard: { enabled: boolean; similarityThreshold: number };
    contentGuard: { enabled: boolean };
  };
  skill: { enabled: boolean };
  agent: { enabled: boolean };
}
