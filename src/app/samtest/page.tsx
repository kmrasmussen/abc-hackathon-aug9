"use client";

import { useEffect, useState } from "react";

/** Scratch page: proves SlimSAM loads and segments in the browser. */
export default function SamTest() {
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    (async () => {
      try {
        say("importing transformers.js…");
        const t = await import("@huggingface/transformers");
        t.env.allowLocalModels = true;
        t.env.allowRemoteModels = false;
        t.env.localModelPath = "/";
        say("loading processor…");
        const processor = await t.AutoProcessor.from_pretrained("models");
        say("loading model…");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model: any = await t.SamModel.from_pretrained("models", { dtype: "q8" });
        say("model loaded ✓");

        // a tiny synthetic image: black circle on white
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const x = c.getContext("2d")!;
        x.fillStyle = "#fff";
        x.fillRect(0, 0, 256, 256);
        x.strokeStyle = "#000";
        x.lineWidth = 5;
        x.beginPath();
        x.arc(90, 90, 50, 0, 7);
        x.stroke();
        x.beginPath();
        x.moveTo(150, 180);
        x.lineTo(230, 220);
        x.stroke();

        say("encoding image…");
        const image = await t.RawImage.fromURL(c.toDataURL());
        const inputs = await processor(image);
        const embeddings = await model.get_image_embeddings(inputs);
        say("encoded ✓");

        const [h, w] = inputs.reshaped_input_sizes.tolist()[0];
        say(`reshaped size: ${w}x${h}`);

        // click on the circle's stroke
        const px = 90 / 256, py = 40 / 256;
        const input_points = new t.Tensor("float32", [px * w, py * h], [1, 1, 1, 2]);
        const input_labels = new t.Tensor("int64", [1n], [1, 1, 1]);
        say("decoding mask…");
        const outputs = await model({ ...embeddings, input_points, input_labels });
        const masks = await processor.post_process_masks(
          outputs.pred_masks,
          inputs.original_sizes,
          inputs.reshaped_input_sizes,
        );
        const m = masks[0];
        say(`mask dims: ${JSON.stringify(m.dims)}`);
        const scores = Array.from(outputs.iou_scores.data as Float32Array).map((v) => v.toFixed(3));
        say(`iou scores: ${scores.join(", ")}`);

        const [, , mh, mw] = m.dims;
        const data = m.data as unknown as ArrayLike<number>;
        let on = 0;
        for (let i = 0; i < mh * mw; i++) if (Number(data[i]) > 0) on++;
        say(`mask[0] pixels on: ${on} / ${mh * mw}`);
        say("DONE ✓");
      } catch (err) {
        say("ERROR: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      <h1 className="mb-3 font-bold">SAM browser test</h1>
      <pre id="samlog" className="whitespace-pre-wrap">{log.join("\n")}</pre>
    </main>
  );
}
