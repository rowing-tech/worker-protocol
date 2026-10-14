import type { Fetch } from "../src/source.ts";

/** An instant a reading can carry, a whole second so that it survives the round trip intact. */
export const NOW = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

/**
 * A source that answers `positions` as `source.ts` reads them, and records what it was asked.
 *
 * The cycle takes its `fetch` as a parameter for this: a test hands it the source, and a deployment
 * hands it nothing and gets the global one.
 */
export const source = (
  positions: unknown[],
  answer: { status?: number; body?: string } = {},
): Fetch & { asked: { url: string; authorization: string | null }[] } => {
  const asked: { url: string; authorization: string | null }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    asked.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return new Response(answer.body ?? JSON.stringify({ positions }), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return Object.assign(fetch, { asked });
};
