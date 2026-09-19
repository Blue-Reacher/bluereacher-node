import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEnvelope } from "./types.js";

/**
 * Verify a Blue Reacher webhook delivery.
 *
 * Each delivery carries an `X-BlueReacher-Signature` header of the form
 * `sha256=HMAC-SHA256(secret, raw_body)`. Compute the same HMAC over the exact
 * raw request body and compare in constant time.
 *
 * @param rawBody   The exact raw request body, as a string or Buffer. Do not
 *                  parse and re-serialize it first; the bytes must match.
 * @param signature The value of the `X-BlueReacher-Signature` header.
 * @param secret    The signing secret returned once by `registerWebhook`.
 * @returns `true` when the signature is valid.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Accept the "sha256=" prefix or a bare hex digest.
  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a delivery and return the parsed event. Throws if the signature is
 * invalid, so a handler can never act on an unverified payload.
 */
export function constructEvent(
  rawBody: string | Buffer,
  signature: string | undefined | null,
  secret: string
): WebhookEnvelope {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new Error("Invalid Blue Reacher webhook signature");
  }
  const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return JSON.parse(text) as WebhookEnvelope;
}
