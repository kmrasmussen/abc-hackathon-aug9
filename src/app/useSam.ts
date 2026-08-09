"use client";

import { useCallback, useRef, useState } from "react";

/**
 * SlimSAM running fully in the browser via transformers.js + onnxruntime-web.
 * The vision encoder runs once per captured image; each click only runs the
 * light mask decoder, so clicking stays responsive.
 */
export type SamStatus = "idle" | "loading" | "encoding" | "ready" | "error";

export type SamMask = {
  grid: Uint8Array;
  width: number;
  height: number;
  score: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useSam() {
  const modelRef = useRef<any>(null);
  const processorRef = useRef<any>(null);
  const embeddingsRef = useRef<any>(null);
  const inputsRef = useRef<any>(null);

  const [status, setStatus] = useState<SamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (modelRef.current) return true;
    setStatus("loading");
    setError(null);
    try {
      const t = await import("@huggingface/transformers");
      // Weights are served from /public/models, never the HF hub.
      t.env.allowLocalModels = true;
      t.env.allowRemoteModels = false;
      t.env.localModelPath = "/";

      processorRef.current = await t.AutoProcessor.from_pretrained("models");
      modelRef.current = await t.SamModel.from_pretrained("models", { dtype: "q8" });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return false;
    }
  }, []);

  /** Run the vision encoder on a captured image — the expensive step. */
  const encode = useCallback(
    async (dataUrl: string) => {
      const ok = await load();
      if (!ok) return false;
      setStatus("encoding");
      try {
        const t = await import("@huggingface/transformers");
        const image = await t.RawImage.fromURL(dataUrl);
        const inputs = await processorRef.current(image);
        inputsRef.current = inputs;
        embeddingsRef.current = await modelRef.current.get_image_embeddings(inputs);
        setStatus("ready");
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        return false;
      }
    },
    [load],
  );

  /** Decode the best mask for one clicked point given in 0-1 coordinates. */
  const segmentAt = useCallback(async (nx: number, ny: number): Promise<SamMask | null> => {
    if (!embeddingsRef.current || !inputsRef.current) return null;
    try {
      const t = await import("@huggingface/transformers");
      const inputs = inputsRef.current;
      // processor returns plain [[h, w]] arrays, not tensors
      const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];

      const input_points = new t.Tensor("float32", [nx * rw, ny * rh], [1, 1, 1, 2]);
      const input_labels = new t.Tensor("int64", [1n], [1, 1, 1]);

      const outputs = await modelRef.current({
        ...embeddingsRef.current,
        input_points,
        input_labels,
      });

      const masks = await (processorRef.current as any).post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes,
      );

      // SAM proposes 3 masks per point; keep the highest-scoring one.
      const scores = outputs.iou_scores.data as Float32Array;
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

      const m = masks[0];
      const [, , mh, mw] = m.dims as number[];
      const data = m.data as unknown as ArrayLike<number>;
      const plane = mh * mw;
      const grid = new Uint8Array(plane);
      for (let i = 0; i < plane; i++) grid[i] = Number(data[best * plane + i]) > 0 ? 1 : 0;

      return { grid, width: mw, height: mh, score: scores[best] };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  /**
   * Segment inside a bounding box, given in 0-1 coordinates. A box is a much
   * less ambiguous prompt than a point on sparse line art, where a point can
   * easily land on blank canvas instead of ink.
   */
  const segmentBox = useCallback(
    async (x: number, y: number, w: number, h: number): Promise<SamMask | null> => {
      if (!embeddingsRef.current || !inputsRef.current) return null;
      try {
        const t = await import("@huggingface/transformers");
        const inputs = inputsRef.current;
        const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];

        // input_boxes is (batch, num_boxes, 4) as x_min, y_min, x_max, y_max
        const input_boxes = new t.Tensor(
          "float32",
          [x * rw, y * rh, (x + w) * rw, (y + h) * rh],
          [1, 1, 4],
        );

        // SamModel.forward reads input_points.dims unconditionally, so a box on
        // its own throws. Anchor with the box centre as a foreground point.
        const input_points = new t.Tensor(
          "float32",
          [(x + w / 2) * rw, (y + h / 2) * rh],
          [1, 1, 1, 2],
        );
        const input_labels = new t.Tensor("int64", [1n], [1, 1, 1]);

        const outputs = await modelRef.current({
          ...embeddingsRef.current,
          input_points,
          input_labels,
          input_boxes,
        });

        const masks = await (processorRef.current as any).post_process_masks(
          outputs.pred_masks,
          inputs.original_sizes,
          inputs.reshaped_input_sizes,
        );

        const scores = outputs.iou_scores.data as Float32Array;
        let best = 0;
        for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

        const m = masks[0];
        const [, , mh, mw] = m.dims as number[];
        const data = m.data as unknown as ArrayLike<number>;
        const plane = mh * mw;
        const grid = new Uint8Array(plane);
        for (let i = 0; i < plane; i++) grid[i] = Number(data[best * plane + i]) > 0 ? 1 : 0;

        return { grid, width: mw, height: mh, score: scores[best] };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    embeddingsRef.current = null;
    inputsRef.current = null;
    if (modelRef.current) setStatus("idle");
  }, []);

  return { status, error, load, encode, segmentAt, segmentBox, reset };
}
