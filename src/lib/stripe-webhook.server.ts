import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeStripe, type StripeBillingEvent } from "./stripe";

export function validStripeSignature(body: Uint8Array, header: string | null, secret: string, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = header.split(",").map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0 || signatures.length > 5) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(body)])).digest();
  return signatures.some(signature => /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(expected, Buffer.from(signature, "hex")));
}

export async function handleStripeWebhook(request: Request, secret: string | undefined, processEvent: (event: StripeBillingEvent) => Promise<void>) {
  const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (!secret) return reply(503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply(415);
  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) { await reader.cancel(); return reply(413); }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    if (!validStripeSignature(body, request.headers.get("stripe-signature"), secret)) return reply(401);
    let event: StripeBillingEvent;
    try { event = normalizeStripe(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
    catch { return reply(400); }
    await processEvent(event);
    return reply(204);
  } catch { return reply(503); }
}
