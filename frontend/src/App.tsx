import { useRef, useState } from 'react';
import { useRecorder } from './useRecorder.ts';
import { transcribeAudio, getLlmCommand, executeHaCommand } from './api.ts';
import type { HaCommand, HaExecuteResult } from './types.ts';
import { errorMessage } from './utils.ts';
import './App.css';

// Mirrors esp32-client's CONFIG_STT_RECORD_SECONDS default: on the device,
// recording starts on wake word and always runs for a fixed duration, no
// manual stop. The web UI follows the same shape (click = "wake word"
// trigger, then a fixed-length recording) so behavior stays comparable.
const RECORD_SECONDS = 4;

type Stage = 'idle' | 'transcribed' | 'commanded' | 'executed';
type Busy = 'transcribing' | 'thinking' | 'executing' | null;
type StepMeta = { model: string; duration_ms: number } | null;

function MetaLine({ meta }: { meta: StepMeta }) {
  if (!meta) return null;
  return (
    <p className="meta">
      Модель: <code>{meta.model}</code> · {meta.duration_ms} мс
    </p>
  );
}

function App() {
  const { isRecording, start, stop } = useRecorder();
  const [stage, setStage] = useState<Stage>('idle');
  const [busy, setBusy] = useState<Busy>(null);
  const [transcript, setTranscript] = useState('');
  const [transcribeMeta, setTranscribeMeta] = useState<StepMeta>(null);
  const [commandText, setCommandText] = useState('');
  const [llmMeta, setLlmMeta] = useState<StepMeta>(null);
  const [haResult, setHaResult] = useState<HaExecuteResult | null>(null);
  const [error, setError] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function runLLMStep(text: string) {
    setError('');
    setBusy('thinking');
    try {
      const { command, model, duration_ms } = await getLlmCommand(text);
      setCommandText(JSON.stringify(command, null, 2));
      setLlmMeta({ model, duration_ms });
      setStage('commanded');
      if (autoMode) {
        await runHAStep(command);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runHAStep(command: HaCommand) {
    setError('');
    setBusy('executing');
    try {
      const result = await executeHaCommand(command);
      setHaResult(result);
      setStage('executed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function clearRecordingTimers() {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    autoStopTimerRef.current = null;
    countdownIntervalRef.current = null;
  }

  async function stopAndTranscribe() {
    clearRecordingTimers();
    setCountdown(null);
    setBusy('transcribing');
    const blob = await stop();
    try {
      if (!blob) {
        throw new Error('Recording produced no audio data');
      }
      const { text, model, duration_ms } = await transcribeAudio(blob);
      setTranscript(text);
      setTranscribeMeta({ model, duration_ms });
      setCommandText('');
      setLlmMeta(null);
      setHaResult(null);
      setStage('transcribed');
      if (autoMode) {
        await runLLMStep(text);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRecordClick() {
    setError('');
    if (isRecording) {
      await stopAndTranscribe();
    } else {
      setTranscript('');
      setTranscribeMeta(null);
      setCommandText('');
      setLlmMeta(null);
      setHaResult(null);
      setStage('idle');
      try {
        await start();
        setCountdown(RECORD_SECONDS);
        countdownIntervalRef.current = setInterval(() => {
          setCountdown((c) => (c !== null ? c - 1 : null));
        }, 1000);
        autoStopTimerRef.current = setTimeout(stopAndTranscribe, RECORD_SECONDS * 1000);
      } catch (err) {
        setError('Не удалось получить доступ к микрофону: ' + errorMessage(err));
      }
    }
  }

  async function handleConfirmToLLM() {
    await runLLMStep(transcript);
  }

  async function handleConfirmToHA() {
    let command: HaCommand;
    try {
      command = JSON.parse(commandText);
    } catch {
      setError('Команда не является валидным JSON — исправьте перед отправкой');
      return;
    }
    await runHAStep(command);
  }

  function handleReset() {
    setStage('idle');
    setBusy(null);
    setTranscript('');
    setTranscribeMeta(null);
    setCommandText('');
    setLlmMeta(null);
    setHaResult(null);
    setError('');
  }

  return (
    <div className="app">
      <h1>ESP32 → STT → LLM → HA</h1>
      <p className="subtitle">Пошаговая отладка: запись → транскрипт → команда (JSON) → Home Assistant</p>

      <label className="auto-toggle">
        <input
          type="checkbox"
          checked={autoMode}
          onChange={(e) => setAutoMode(e.target.checked)}
        />
        Выполнять всю цепочку автоматически (без подтверждений)
      </label>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>1. Запись и распознавание (Whisper.cpp)</h2>
        <button
          type="button"
          className={`record-btn ${isRecording ? 'recording' : ''}`}
          onClick={handleRecordClick}
          disabled={busy !== null}
        >
          {isRecording ? '⏹ Остановить' : '🎤 Записать'}
        </button>
        <p className="status">
          {isRecording && countdown !== null && `Идёт запись… остановится через ${countdown}с`}
          {busy === 'transcribing' && 'Распознаю речь…'}
        </p>
        <textarea
          className="transcript"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Здесь появится распознанный текст..."
          rows={3}
        />
        <MetaLine meta={transcribeMeta} />
        <button
          type="button"
          onClick={handleConfirmToLLM}
          disabled={!transcript.trim() || busy !== null || autoMode}
        >
          Подтвердить и отправить в LLM →
        </button>
      </section>

      <section className={`panel ${stage === 'idle' ? 'panel-disabled' : ''}`}>
        <h2>2. Команда от LLM (JSON)</h2>
        <p className="status">{busy === 'thinking' && 'LLM формирует команду…'}</p>
        <textarea
          className="transcript command-json"
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
          placeholder='{"action": "...", "entity": "...", "value": null, "response_text": "..."}'
          rows={7}
          disabled={stage === 'idle'}
        />
        <MetaLine meta={llmMeta} />
        <button
          type="button"
          onClick={handleConfirmToHA}
          disabled={stage === 'idle' || !commandText.trim() || busy !== null || autoMode}
        >
          Подтвердить и выполнить в Home Assistant →
        </button>
      </section>

      <section className={`panel ${stage !== 'executed' && busy !== 'executing' ? 'panel-disabled' : ''}`}>
        <h2>3. Выполнение в Home Assistant</h2>
        <p className="status">{busy === 'executing' && 'Home Assistant выполняет команду…'}</p>
        <div className="reply">
          {haResult ? (
            <>
              <div>{haResult.response_text || '(нет голосового ответа)'}</div>
              <div className="ha-meta">
                executed: {String(haResult.executed)} · {haResult.duration_ms} мс
              </div>
            </>
          ) : (
            '—'
          )}
        </div>
        {stage === 'executed' && (
          <button type="button" onClick={handleReset}>
            Начать заново
          </button>
        )}
      </section>
    </div>
  );
}

export default App;
