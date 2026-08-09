"use client";

import { useCallback, useRef, useState } from "react";

export type Segment = { text: string; at: string | null };

const SAMPLE_RATE = 24000;
const VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";

/**
 * Speak a sequence of segments with Cartesia TTS, exposing which segment is
 * currently being spoken so the diagram can point along with the words.
 *
 * Each segment is synthesised as its own request, and the next one only starts
 * when the previous finishes playing — that's what keeps the highlight in step
 * with the audio without needing word timestamps.
 */
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const stop = useCallback(() => {
    abortRef.current = true;
    setSpeaking(false);
    setCurrent(-1);
  }, []);

  const speak = useCallback(async (segments: Segment[]) => {
    if (!segments.length) return;
    abortRef.current = false;
    setError(null);
    setSpeaking(true);

    let ctx: AudioContext | null = null;
    try {
      const res = await fetch("/api/stt", { method: "POST" });
      const auth = await res.json();
      if (!res.ok || !auth.token) {
        setError(auth.error ?? `token ${res.status}`);
        setSpeaking(false);
        return;
      }

      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

      for (let i = 0; i < segments.length; i++) {
        if (abortRef.current) break;
        setCurrent(i);
        const pcm = await synth(segments[i].text, auth.token, auth.version);
        if (abortRef.current || !pcm.length) continue;
        await play(ctx, pcm);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      ctx?.close();
      setSpeaking(false);
      setCurrent(-1);
    }
  }, []);

  return { speak, stop, speaking, current, error };
}

/** Synthesise one segment, collecting its raw PCM. */
function synth(text: string, token: string, version: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const url =
      `wss://api.cartesia.ai/tts/websocket` +
      `?cartesia_version=${version}&access_token=${token}`;
    const ws = new WebSocket(url);
    const parts: Int16Array[] = [];
    const contextId = `seg-${Math.random().toString(36).slice(2)}`;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          model_id: "sonic-3.5",
          transcript: text,
          voice: { mode: "id", id: VOICE_ID },
          output_format: {
            container: "raw",
            encoding: "pcm_s16le",
            sample_rate: SAMPLE_RATE,
          },
          language: "en",
          context_id: contextId,
          continue: false,
        }),
      );
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "chunk" && msg.data) {
          const bin = atob(msg.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          parts.push(new Int16Array(bytes.buffer));
        } else if (msg.type === "done") {
          ws.close();
        } else if (msg.type === "error") {
          reject(new Error(msg.message ?? "tts error"));
          ws.close();
        }
      } catch {
        // ignore non-JSON frames
      }
    };

    ws.onerror = () => reject(new Error("tts websocket error"));
    ws.onclose = () => {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Int16Array(total);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      resolve(out);
    };
  });
}

/** Play raw PCM and resolve when it finishes. */
function play(ctx: AudioContext, pcm: Int16Array): Promise<void> {
  return new Promise((resolve) => {
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
  });
}
