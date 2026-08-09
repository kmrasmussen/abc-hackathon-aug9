"use client";

import { useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;

/**
 * Cartesia streaming STT over WebSocket. The model decides where turns begin
 * and end, so utterances land in the log as whole thoughts rather than being
 * chopped on a fixed timer.
 */
export function useStt(enabled: boolean, onTurn: (text: string) => void) {
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string>("");
  const [live, setLive] = useState(false);
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let node: ScriptProcessorNode | null = null;
    let stopped = false;

    (async () => {
      try {
        const res = await fetch("/api/stt", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.token) {
          setError(data.error ?? `token ${res.status}`);
          return;
        }
        if (stopped) return;

        const url =
          `wss://api.cartesia.ai/stt/turns/websocket` +
          `?model=ink-2&encoding=pcm_s16le&sample_rate=${SAMPLE_RATE}` +
          `&cartesia_version=${data.version}&access_token=${data.token}`;

        ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";

        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") return;
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "turn.update") setPartial(msg.transcript ?? "");
            else if (msg.type === "turn.end") {
              setPartial("");
              const t = (msg.transcript ?? "").trim();
              if (t) onTurnRef.current(t);
            } else if (msg.type === "error") {
              setError(msg.message ?? msg.title ?? "stt error");
            }
          } catch {
            // non-JSON frame — ignore
          }
        };
        ws.onerror = () => setError("websocket error");
        ws.onclose = () => setLive(false);

        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: SAMPLE_RATE },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        const src = ctx.createMediaStreamSource(stream);
        // ScriptProcessor is deprecated but needs no extra worklet file, and
        // 2048 frames at 16k is ~128ms — close to the 100ms chunks Cartesia wants.
        node = ctx.createScriptProcessor(2048, 1, 1);

        node.onaudioprocess = (ev) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const input = ev.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(pcm.buffer);
        };

        src.connect(node);
        node.connect(ctx.destination);
        setLive(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      stopped = true;
      setLive(false);
      setPartial("");
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "close" }));
        }
        ws?.close();
      } catch {
        // already closing
      }
      node?.disconnect();
      ctx?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { error, partial, live };
}
