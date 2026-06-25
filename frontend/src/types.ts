export interface HaCommand {
  action: 'turn_on' | 'turn_off' | 'toggle' | 'set_brightness' | 'query' | 'unknown' | string;
  entity: string | null;
  value: number | null;
  response_text: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
  duration_ms: number;
}

export interface LlmCommandResult {
  command: HaCommand;
  model: string;
  duration_ms: number;
}

export interface HaExecuteResult {
  executed: boolean;
  response_text: string;
  changed?: unknown;
  duration_ms: number;
}
