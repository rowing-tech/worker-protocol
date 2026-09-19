import { error as errorSchema } from "@worker-protocol/schemas";
import type * as z from "zod";

/**
 * One call to a Worker, and every rule in `spec/` that binds the party making it.
 *
 * Eleven rules in the specification oblige a consumer rather than a Worker, and until this package
 * existed none of them had a subject: `conformance/verifiability.md` classes them `P` and a report
 * says *other subject*, because a tool pointed at a base URL never contacted whoever they bind.
 * They are all here, each cited where it is obeyed, and `__tests__/consumer-rules.test.ts` is what
 * holds this to them.
 *
 * DESC-13, DESC-30, ENDP-13, ENDP-14, ENDP-21, ENDP-27, ENDP-28, ENDP-30, ENDP-31, TASK-18,
 * TASK-20 — that is the whole list, and a line below cites each.
 */

/** A Worker refused, and the refusal is the Worker's own statement about itself (ENDP-25). */
export class Refused extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    /** ENDP-25. `reject` will be wrong again; `retry` may not be. */
    readonly kind: "reject" | "retry",
    readonly url: string,
    message: string,
  ) {
    super(`${code} (${status}) at ${url}: ${message}`);
    this.name = "Refused";
  }
}

/**
 * A Worker answered something this protocol does not admit.
 *
 * It names the rule, because a consumer told *the response was invalid* cannot act on it and two
 * very different faults read identically — which is the whole reason the ids exist. What is
 * checked is only what `schemas/` fixes; a Task's payload, an Action's result and an event's data
 * are the Worker's own and this never looks inside them.
 */
export class Malformed extends Error {
  constructor(
    readonly rule: string,
    readonly url: string,
    readonly detail: string,
  ) {
    super(`${rule}: ${detail} — from ${url}`);
    this.name = "Malformed";
  }
}

/** A declared address that serves nothing, which DESC-30 makes a contract error and not a retry. */
export class Unserved extends Error {
  constructor(readonly url: string) {
    super(
      `DESC-30: ${url} is declared in the Descriptor and serves nothing. This is a contract error: the Descriptor says the Worker answers here and it does not.`,
    );
    this.name = "Unserved";
  }
}

export type Fetch = typeof globalThis.fetch;

export type CallerOptions = {
  /** REG-3. Presented as `Authorization: Bearer <token>`, and nowhere else. */
  credential?: string;
  /** ENDP-30 (recommended). How many times a `retry` is repeated before the caller gives up. */
  retries?: number;
  /** ENDP-30. The first wait, doubled each time. */
  backoffMs?: number;
  fetch?: Fetch;
  /** For a test that needs the clock still. Defaults to a real wait. */
  wait?: (ms: number) => Promise<void>;
};

export type Call = {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  /** TASK-20. The Claim this Action is performed under, where it answers a Task. */
  claim?: string;
  /** ENDP-15. Where the Action declares it reads a key from the header. */
  idempotencyKey?: string;
  /**
   * Whether a `404` here means the ADDRESS serves nothing (DESC-30) or that a resource is gone.
   *
   * The division is the one DESC-30 was narrowed to: a read of a Capability's own address asks
   * whether the Worker answers there at all, and a call naming a metric, an Action or a Task asks
   * about a thing — the first is a Descriptor that lied, the second is an ordinary refusal.
   */
  addressLevel?: boolean;
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function caller(descriptorUrl: string, options: CallerOptions = {}) {
  const send = options.fetch ?? globalThis.fetch;
  const wait = options.wait ?? sleep;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? 200;

  // DESC-13: a credential granted for this Worker is not presented to an address on an origin the
  // operator did not record as the Worker's own. An address may point away — a Worker whose Tasks
  // are held by one deployment and whose health is answered by another is a placement decision —
  // and the Descriptor is a document the Worker controls, so an address in it is an instruction to
  // send a request somewhere. Without this, a Worker could name any host and be handed the token.
  const ownOrigin = new URL(descriptorUrl).origin;

  /** DESC-30: addresses this consumer has found to serve nothing. It does not call them again. */
  const unserved = new Set<string>();

  /** ENDP-5. What the Worker last said produced an answer, for a caller that wants to notice. */
  let lastEdition: string | undefined;

  const once = async (call: Call): Promise<Response> => {
    const headers = new Headers();
    if (options.credential !== undefined) {
      if (new URL(call.url).origin === ownOrigin) {
        headers.set("authorization", `Bearer ${options.credential}`);
      }
      // Off-origin: the request still goes, and without the credential. DESC-13 forbids presenting
      // it, not calling the address — which the Worker declared and may well serve openly.
    }
    if (call.body !== undefined) headers.set("content-type", "application/json");
    // TASK-20: the holder names its Claim on the Action that answers its Task, in the header, so
    // that ACT-5 keeps the body as the input and nothing else.
    if (call.claim !== undefined) headers.set("worker-protocol-claim", call.claim);
    if (call.idempotencyKey !== undefined) {
      headers.set("idempotency-key", call.idempotencyKey);
    }
    return send(call.url, {
      method: call.method ?? "GET",
      headers,
      ...(call.body === undefined ? {} : { body: call.body }),
      redirect: "manual",
    });
  };

  /**
   * One call, classified, retried where the Worker said it may be, and never where it said not.
   *
   * ENDP-28 is the rule that costs the most to get wrong and it binds here: a caller that retries
   * a `reject` hammers a Worker with a request that will never succeed and buries the failure. So
   * a `reject` throws on the first answer, and only a `retry` comes round again.
   */
  const call = async (spec: Call): Promise<{ status: number; body: string; json: unknown }> => {
    if (unserved.has(spec.url)) throw new Unserved(spec.url);

    let waited = backoff;
    for (let attempt = 0; ; attempt++) {
      const response = await once(spec);
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      // ENDP-5: a caller that sees an edition it did not expect re-reads the Descriptor rather
      // than parsing the body. What it does about it is the caller's; noticing is this line.
      lastEdition = response.headers.get("worker-protocol-edition") ?? lastEdition;

      if (response.status < 400) return { status: response.status, body: text, json };

      // DESC-30: an address the Descriptor declares and that serves nothing is a contract error,
      // and a consumer stops. It is recorded so that nothing here calls it again, which is what
      // *does not retry* means when the same consumer keeps running.
      if (response.status === 404 && spec.addressLevel === true) {
        unserved.add(spec.url);
        throw new Unserved(spec.url);
      }

      // ENDP-14, ENDP-27: where the class and the status disagree, the class in the envelope wins
      // when an envelope is present and parses, and the status wins when it is not. ENDP-13: an
      // answer that can be classified by neither is `reject` — stopping loudly on something that
      // would have succeeded costs an alert, and retrying on something that never will costs the
      // work, silently.
      const envelope = errorSchema.safeParse(json);
      const kind: "reject" | "retry" = envelope.success
        ? envelope.data.class
        : RETRY_STATUS.has(response.status)
          ? "retry"
          : "reject";
      const code = envelope.success ? envelope.data.code : `http_${response.status}`;
      const message = envelope.success ? envelope.data.message : text.slice(0, 200);

      // ENDP-28: a caller does not retry a reject. The request is wrong and will be wrong again.
      if (kind === "reject" || attempt >= retries) {
        throw new Refused(code, response.status, kind, spec.url, message);
      }

      // ENDP-30 (recommended): a caller backs off and repeats a `retry` unchanged. Unchanged is
      // the load-bearing word — the same request, under the same key if it had one.
      await wait(waited);
      waited *= 2;
    }
  };

  /** A call whose answer is a document this protocol fixes the shape of. */
  const validated = async <T>(spec: Call, schema: z.ZodType<T>, rule: string): Promise<T> => {
    const answer = await call(spec);
    const parsed = schema.safeParse(answer.json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") || "(root)";
      throw new Malformed(rule, spec.url, `${where}: ${issue?.message ?? "did not validate"}`);
    }
    return parsed.data;
  };

  return {
    call,
    validated,
    /** DESC-12. Every address is resolved against the URL the Descriptor was read FROM. */
    resolve: (address: string) => new URL(address, descriptorUrl).toString(),
    edition: () => lastEdition,
  };
}

export type Caller = ReturnType<typeof caller>;

/** ENDP-29's `retry` rows, for an answer that carries no envelope to read a class off. */
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Every page of a collection, read the way ENDP-20 and ENDP-21 say.
 *
 * ENDP-31 is the rule this exists to obey and it is the one a caller breaks without noticing: it
 * reads how many items it RECEIVED, never how many it asked for. A caller that assumed a full page
 * meant more to come, or that a short page meant the end, silently loses the rest of a collection
 * — so the only thing that ends this loop is the cursor being absent.
 *
 * ENDP-21: the cursor is opaque, is produced only by the Worker, and is never constructed here. It
 * goes back exactly as it arrived.
 */
export async function* pages<T>(
  caller: Caller,
  url: string,
  schema: z.ZodType<{ items: T[]; nextCursor?: string }>,
  rule: string,
  parameters: Record<string, string> = {},
): AsyncGenerator<T[]> {
  let cursor: string | undefined;
  // A bound, because a Worker whose cursor never advances would otherwise spin a consumer forever.
  for (let page = 0; page < 10_000; page++) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
    if (cursor !== undefined) target.searchParams.set("cursor", cursor);

    const answered = await caller.validated(
      { url: target.toString(), addressLevel: Object.keys(parameters).length === 0 },
      schema,
      rule,
    );
    yield answered.items;
    // ENDP-20: absent at the end of the collection — absent, not null, and not an empty page.
    if (answered.nextCursor === undefined) return;
    cursor = answered.nextCursor;
  }
}
