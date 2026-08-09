import { NextResponse } from "next/server";

/**
 * Transcribe one audio chunk with Cartesia. The browser records short clips
 * and posts them here, so the key never reaches the client.
 */
export async function POST(req: Request) {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "CARTESIA_API_KEY not set" }, { status: 500 });
  }

  const inbound = await req.formData();
  const file = inbound.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "expected an audio file" }, { status: 400 });
  }

  const form = new FormData();
  form.append("file", file, "clip.webm");
  form.append("model", "ink-whisper");
  form.append("language", "en");

  const res = await fetch("https://api.cartesia.ai/stt", {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Cartesia-Version": "2024-06-10",
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `cartesia ${res.status}`, detail }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({ text: (data?.text ?? "").trim() });
}
