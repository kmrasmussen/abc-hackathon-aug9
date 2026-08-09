import { NextResponse } from "next/server";

const VERSION = "2026-03-01";

/**
 * Mint a short-lived STT access token. Browsers can't set headers on a
 * WebSocket, so the client connects with ?access_token=... instead — and the
 * real API key never leaves the server.
 */
export async function POST() {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "CARTESIA_API_KEY not set" }, { status: 500 });
  }

  const res = await fetch("https://api.cartesia.ai/access-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Cartesia-Version": VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grants: { stt: true }, expires_in: 3600 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `cartesia ${res.status}`, detail }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({ token: data.token, version: VERSION });
}
