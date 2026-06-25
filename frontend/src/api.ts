import type { HaCommand, HaExecuteResult, LlmCommandResult, TranscribeResult } from './types.ts';

async function readError(res: Response, fallback: string): Promise<string> {
  const { error } = await res.json().catch(() => ({ error: res.statusText }));
  return error || fallback;
}

export async function transcribeAudio(blob: Blob): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(await readError(res, 'Transcription failed'));
  }

  return res.json();
}

// Sends the transcript to the LLM (with the smart-home system prompt) and
// gets back a structured command.
export async function getLlmCommand(text: string): Promise<LlmCommandResult> {
  const res = await fetch('/api/llm-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(await readError(res, 'LLM command request failed'));
  }

  return res.json();
}

// Executes a command against Home Assistant.
export async function executeHaCommand(command: HaCommand): Promise<HaExecuteResult> {
  const res = await fetch('/api/ha-execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    throw new Error(await readError(res, 'Home Assistant request failed'));
  }

  return res.json();
}
