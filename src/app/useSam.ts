"use client";

import { useCallback, useRef, useState } from "react";

/**
 * SlimSAM running fully in the browser via transformers.js + onnxruntime-web.
 * The encoder runs once per image; each click only runs the light decoder.
 */
export type SamStatus = "idle" | "loading" | "encoding" | "ready" | "error";

export function useSam() {
  const modelRef = useRef<unknown>(null);
  const processorRef = useRef<unknown>(null);
  const embeddingsRef = useRef<unknown>(null);
  const sizesRef = useRef<unknown>(null);

  const [status, setStatus] = useState<SamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  /** Load the model once, lazily — it's ~13MB of quantized weights. */
  const load = useCallback(async () => {
    if (modelRef.current) return true;
    setStatus("loading");
    setError(null);
    try {
      const t = await import("@huggingface/transformers");
      // Serve weights from /public/models rather than the HF hub.
      t.env.allowLocalModels = true;
      t.env.allowRemoteModels = false;
      t.env.localModelPath = "/";

      processorRef.current = await t.AutoProcessor.from_pretrained("models");
      modelRef.current = await t.SamModel.from_pretrained("models", {
        dtype: "q8",
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return false;
    }
  }, []);

  /** Run the vision encoder on a captured image (the expensive step). */
  const encode = useCallback(
    async (dataUrl: string) => {
      const ok = await load();
      if (!ok) return false;
      setStatus("encoding");
      try {
        const t = await import("@huggingface/transformers");
        const image = await t.RawImage.fromURL(dataUrl);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processor = processorRef.current as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = modelRef.current as any;

        const inputs = await processor(image);
        sizesRef.current = inputs.reshaped_input_sizes;
        embeddingsRef.current = await model.get_image_embeddings(inputs);

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

  /**
   * Decode a mask for one clicked point, in 0-1 image coordinates.
   * Returns the best mask as a boolean grid plus its dimensions.
   */
  const segmentAt = useCallback(
    async (nx: number, ny: number) => {
      if (!embeddingsRef.current) return null;
      try {
        const t = await import("@huggingface/transformers");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processor = processorRef.current as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = modelRef.current as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sizes = sizesRef.current as any;

        const [h, w] = sizes.tolist()[0];
        const input_points = new t.Tensor(
          "float32",
          [nx * w, ny * h],
          [1, 1, 1, 2],
        );
        const input_labels = new t.Tensor("int64", [1n], [1, 1, 1]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputs = await model({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(embeddingsRef.current as any),
          input_points,
          input_labels,
        });

        const masks = await processor.post_process_masks(
          outputs.pred_masks,
          sizes,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (processor as any).original_sizes ?? sizes,
        );

        const scores = outputs.iou_scores.data as Float32Array;
        let best = 0;
        for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

        const m = masks[0];
        const [, , mh, mw] = m.dims;
        const data = m.data as Uint8Array | Float32Array | BigInt64Array;
        const plane = mh * mw;
        const grid = new Uint8Array(plane);
        for (let i = 0; i < plane; i++) {
          grid[i] = Number(data[best * plane + i]) > 0 ? 1 : 0;
        }
        return { grid, width: mw, height: mh, score: scores[best] };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  return { status, error, load, encode, segmentAt };
}
