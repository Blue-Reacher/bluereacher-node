# bluereacher-node

Official TypeScript SDK for the [Blue Reacher](https://bluereacher.com) API. Send iMessage from your CRM, app, or AI agent over a dedicated line, read replies, manage contacts, and verify webhooks.

- Typed end to end, hand written against the public OpenAPI spec
- Fetch based, zero runtime dependencies
- Works on Node 18+ (uses the built-in `fetch` and `crypto`)
- No A2P registration required

Docs: https://docs.bluereacher.com  
OpenAPI: https://docs.bluereacher.com/openapi.json

## Install

```bash
npm install bluereacher
```

## Quickstart

```ts
import { BlueReacher } from "bluereacher";

const br = new BlueReacher(process.env.BLUEREACHER_API_KEY!);
// Test keys (brk_test_) hit a simulator: no message is ever sent.

const res = await br.sendMessage({
  to: "+13035550101",
  message: "Hey, following up on your quote.",
});

console.log(res.messageId, res.mode);

// Poll for delivery status
const status = await br.getStatus(res.messageId);
console.log(status.status);
```

Every example here uses the placeholder key `brk_test_your_key`. Keep live keys (`brk_live_`) in environment variables, never in source.

## Sending

By default a send is queued through the paced drip pipeline. Pass `sendMode: "instant"` to dispatch now.

```ts
// Paced (default)
await br.sendMessage({ to: "+13035550101", message: "Reminder for tomorrow." });

// Instant, with a native effect
await br.sendMessage({
  to: "+13035550101",
  message: "You are confirmed",
  sendMode: "instant",
  messageEffect: "confetti",
});

// Media
await br.sendMessage({
  to: "+13035550101",
  message: "Your receipt",
  mediaUrls: ["https://example.com/receipt.pdf"],
});
```

## Contacts

```ts
await br.upsertContact({
  phoneNumber: "+13035550101",
  firstName: "Jordan",
  tags: ["lead", "q3"],
});

const { contacts } = await br.listContacts({ tag: "lead", perPage: 50 });
```

## Opt-out

```ts
const state = await br.getOptOut("+13035550101");
if (!state.optedOut) {
  await br.sendMessage({ to: "+13035550101", message: "..." });
}

// Honor an opt-out
await br.setOptOut({ phone: "+13035550101", optedOut: true });
```

## Capability check

```ts
const cap = await br.checkCapability(["+13035550101", "+13035550102"]);
for (const r of cap.results) {
  console.log(r.phone, r.status); // "imessage" | "sms" | "unknown" | "pending"
}
```

## Conversations

```ts
const convo = await br.getConversation({ phone: "+13035550101", limit: 50 });
for (const m of convo.messages) {
  console.log(m.direction, m.message);
}
```

## Webhooks

Register your endpoint, store the signing secret, and verify every delivery. Each request carries an `X-BlueReacher-Signature` header of the form `sha256=HMAC-SHA256(secret, raw_body)`.

```ts
import { BlueReacher, verifyWebhookSignature, constructEvent } from "bluereacher";

const br = new BlueReacher(process.env.BLUEREACHER_API_KEY!);
const { secret } = await br.registerWebhook("https://example.com/hooks/bluereacher");

// In your HTTP handler, pass the EXACT raw body (not a re-serialized object):
const signature = req.headers["x-bluereacher-signature"];
if (!verifyWebhookSignature(rawBody, signature, secret)) {
  return res.status(400).end();
}
const event = constructEvent(rawBody, signature, secret);
console.log(event.event, event.data);
```

Express example:

```ts
import express from "express";
import { constructEvent } from "bluereacher";

const app = express();
app.post(
  "/hooks/bluereacher",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const event = constructEvent(
        req.body, // Buffer, the raw body
        req.header("X-BlueReacher-Signature"),
        process.env.BLUEREACHER_WEBHOOK_SECRET!
      );
      // handle event.event ...
      res.sendStatus(200);
    } catch {
      res.sendStatus(400);
    }
  }
);
```

## Error handling

Non-2xx responses throw a `BlueReacherError` with `status`, `code`, and `help`.

```ts
import { BlueReacherError } from "bluereacher";

try {
  await br.sendMessage({ to: "+13035550101", message: "Hi" });
} catch (err) {
  if (err instanceof BlueReacherError) {
    console.error(err.status, err.code, err.message);
  }
}
```

## API surface

| Method | Endpoint |
| --- | --- |
| `sendMessage(params)` | `POST /v1/messages` |
| `getStatus(messageId)` | `GET /v1/status/{message_id}` |
| `getConversation(params)` | `GET /v1/conversations` |
| `getContactMessages(contactId, params)` | `GET /v1/conversations/{contact_id}/messages` |
| `listContacts(params)` | `GET /v1/contacts` |
| `upsertContact(params)` | `POST /v1/contacts` |
| `updateContact(contactId, params)` | `PATCH /v1/contacts/{contact_id}` |
| `getOptOut(phone)` | `GET /v1/opt-out` |
| `setOptOut(params)` | `POST /v1/opt-out` |
| `checkCapability(phones)` | `POST /v1/capability` |
| `getUsage()` | `GET /v1/usage` |
| `listLines()` | `GET /v1/devices` |
| `registerWebhook(url, events?)` | `POST /v1/webhooks` |
| `getWebhook()` | `GET /v1/webhooks` |
| `deleteWebhook()` | `DELETE /v1/webhooks` |

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # emits dist/
```

## License

MIT. Copyright 2026 Sagency International LLC (Blue Reacher).
