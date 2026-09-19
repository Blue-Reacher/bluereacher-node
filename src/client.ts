import { BlueReacherError } from "./errors.js";
import type {
  SendMessageParams,
  SendMessageResult,
  MessageStatus,
  ListContactsParams,
  ContactList,
  Contact,
  UpsertContactParams,
  UpdateContactParams,
  ConversationByPhoneParams,
  Conversation,
  ContactMessagesParams,
  OptOutState,
  SetOptOutResult,
  CapabilityResponse,
  Line,
  WebhookRegistration,
} from "./types.js";

export interface BlueReacherOptions {
  /** API base URL. Defaults to https://api.bluereacher.com/v1 */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.bluereacher.com/v1";

const OPAQUE_KEYS = new Set(["custom_fields", "customFields"]);

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** Recursively convert response object keys to camelCase, leaving arbitrary
 *  custom-field payloads untouched. */
function deepCamel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => deepCamel(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[snakeToCamel(k)] = OPAQUE_KEYS.has(k) ? v : deepCamel(v);
    }
    return out as T;
  }
  return value as T;
}

/** Drop undefined values so they are never serialized. */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Client for the Blue Reacher API. Send iMessage from your CRM, app, or agent
 * over a dedicated line. See https://docs.bluereacher.com for the full API.
 *
 * ```ts
 * const br = new BlueReacher("brk_test_your_key");
 * const res = await br.sendMessage({ to: "+13035550101", message: "Hi" });
 * ```
 */
export class BlueReacher {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, options: BlueReacherOptions = {}) {
    if (!apiKey) {
      throw new Error(
        "A Blue Reacher API key is required (brk_live_ or brk_test_)."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error(
        "No fetch implementation found. Use Node 18+ or pass options.fetch."
      );
    }
    this.fetchImpl = f;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": "bluereacher-node",
      ...opts.headers,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new BlueReacherError(
          `Request to ${path} timed out after ${this.timeoutMs}ms`,
          0
        );
      }
      throw new BlueReacherError(
        `Network error calling ${path}: ${(err as Error).message}`,
        0
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const b = (parsed ?? {}) as Record<string, unknown>;
      throw new BlueReacherError(
        (b.error as string) || `Request failed with status ${res.status}`,
        res.status,
        {
          code: b.error_code as string | undefined,
          help: b.help as string | undefined,
          body: parsed,
        }
      );
    }

    return deepCamel<T>(parsed);
  }

  // --- Messages -----------------------------------------------------------

  /** Send a text and/or media iMessage. Paced drip by default, or instant. */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { idempotencyKey, ...rest } = params;
    const body = clean({
      to: rest.to,
      group_chat_id: rest.groupChatId,
      create_group_phones: rest.createGroupPhones,
      message: rest.message,
      media_urls: rest.mediaUrls,
      send_mode: rest.sendMode,
      message_effect: rest.messageEffect,
      device_id: rest.deviceId,
      delay_minutes: rest.delayMinutes,
    });
    const headers = idempotencyKey
      ? { "Idempotency-Key": idempotencyKey }
      : undefined;
    return this.request<SendMessageResult>("POST", "/messages", { body, headers });
  }

  /** Delivery status of a queued or sent item. */
  async getStatus(messageId: string): Promise<MessageStatus> {
    return this.request<MessageStatus>(
      "GET",
      `/status/${encodeURIComponent(messageId)}`
    );
  }

  // --- Conversations ------------------------------------------------------

  /** Conversation history for a phone number or group chat. */
  async getConversation(
    params: ConversationByPhoneParams
  ): Promise<Conversation> {
    return this.request<Conversation>("GET", "/conversations", {
      query: {
        phone: params.phone,
        group_chat_id: params.groupChatId,
        limit: params.limit,
        before: params.before,
        device_id: params.deviceId,
      },
    });
  }

  /** Paginated message history for a known contact. */
  async getContactMessages(
    contactId: string,
    params: ContactMessagesParams = {}
  ): Promise<Conversation> {
    return this.request<Conversation>(
      "GET",
      `/conversations/${encodeURIComponent(contactId)}/messages`,
      {
        query: {
          page: params.page,
          per_page: params.perPage,
          before: params.before,
          after: params.after,
        },
      }
    );
  }

  // --- Contacts -----------------------------------------------------------

  /** Search and list contacts. */
  async listContacts(params: ListContactsParams = {}): Promise<ContactList> {
    return this.request<ContactList>("GET", "/contacts", {
      query: {
        page: params.page,
        per_page: params.perPage,
        phone: params.phone,
        email: params.email,
        tag: params.tag,
        created_after: params.createdAfter,
        search: params.search,
      },
    });
  }

  /** Create or update a contact, keyed by phone number. */
  async upsertContact(params: UpsertContactParams): Promise<{ contact: Contact }> {
    const body = clean({
      phone_number: params.phoneNumber,
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      company: params.company,
      tags: params.tags,
      notes: params.notes,
      custom_fields: params.customFields,
    });
    return this.request<{ contact: Contact }>("POST", "/contacts", { body });
  }

  /** Update an existing contact by id, including opt-out state. */
  async updateContact(
    contactId: string,
    params: UpdateContactParams
  ): Promise<{ contact: Contact }> {
    const body = clean({
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      company: params.company,
      tags: params.tags,
      notes: params.notes,
      custom_fields: params.customFields,
      opted_out: params.optedOut,
    });
    return this.request<{ contact: Contact }>(
      "PATCH",
      `/contacts/${encodeURIComponent(contactId)}`,
      { body }
    );
  }

  // --- Opt-out ------------------------------------------------------------

  /** Read a contact's opt-out state by phone. */
  async getOptOut(phone: string): Promise<OptOutState> {
    return this.request<OptOutState>("GET", "/opt-out", { query: { phone } });
  }

  /**
   * Opt a contact out, or opt them back in. Re-subscribing requires
   * `confirmResubscribe: true`.
   */
  async setOptOut(params: {
    phone: string;
    optedOut: boolean;
    confirmResubscribe?: boolean;
  }): Promise<SetOptOutResult> {
    const body = clean({
      phone: params.phone,
      opted_out: params.optedOut,
      confirm_resubscribe: params.confirmResubscribe,
    });
    return this.request<SetOptOutResult>("POST", "/opt-out", { body });
  }

  // --- Capability ---------------------------------------------------------

  /** Check iMessage vs SMS capability for up to 100 phone numbers. */
  async checkCapability(
    phones: string[],
    probe = true
  ): Promise<CapabilityResponse> {
    return this.request<CapabilityResponse>("POST", "/capability", {
      body: { phones, probe },
    });
  }

  // --- Usage & lines ------------------------------------------------------

  /** Usage by key and endpoint. */
  async getUsage(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/usage");
  }

  /** List sending lines and their live capacity. */
  async listLines(): Promise<{ success: boolean; devices: Line[] }> {
    return this.request<{ success: boolean; devices: Line[] }>("GET", "/devices");
  }

  // --- Webhooks -----------------------------------------------------------

  /**
   * Register your inbound webhook endpoint. Returns a signing secret once;
   * store it and verify each delivery with `verifyWebhookSignature`.
   */
  async registerWebhook(
    url: string,
    events?: string
  ): Promise<WebhookRegistration> {
    const body = clean({ url, events });
    return this.request<WebhookRegistration>("POST", "/webhooks", { body });
  }

  /** Read your current webhook registration. */
  async getWebhook(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/webhooks");
  }

  /** Remove your webhook endpoint. */
  async deleteWebhook(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("DELETE", "/webhooks");
  }
}
