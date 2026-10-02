# The surface to write when there is no SDK for the language

Everything here is fixed by a rule and is identical in every Worker. Write it once, behind whatever
the language calls middleware, and never in a handler. In TypeScript, `mount()` in
`@worker-protocol/hono` is this file already written — load the `worker-protocol-hono` skill
instead.

## 1. Serve the Descriptor

At `/.well-known/worker-protocol`, validated against `schemas/descriptor.json`: the `id`, the
`edition`, `capabilities` with an address each, and `skills` at the root if this Worker answers
Tasks. Every other address is declared there and assembled by nobody (ENDP-1).

## 2. Two headers on every protocol response

`Worker-Protocol-Edition` and `Worker-Protocol-Capability-Version` (ENDP-5), on refusals as well as
on answers. A caller that sees an edition it did not expect re-reads the Descriptor rather than
parsing the body.

## 3. The credential

`Authorization: Bearer <token>` (REG-3), accepted on every address the protocol defines (REG-21).
`401` when it cannot be read, `403` when it is understood and carries no right (ENDP-29). What makes
a token good is the Worker's own business and may be a network call.

## 4. The error envelope

`schemas/error.json`: `{ code, message, class }` (ENDP-25). The code fixes both the status and the
class, so neither is chosen beside it (ENDP-26).

| class | codes |
|---|---|
| `reject` | `malformed_request`, `schema_mismatch`, `invalid_parameter`, `unknown_filter`, `unsupported_version`, `idempotency_key_required`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `idempotency_key_reused`, `unprocessable_content` |
| `retry` | `request_timeout`, `rate_limited`, `internal_error`, `unavailable`, `upstream_error`, `upstream_timeout` |

A caller does not repeat a `reject` unchanged (ENDP-28); it may back off and repeat a `retry`.

## 5. The page envelope

`schemas/page.json`: `{ items, nextCursor? }` (ENDP-20), with a cap the Worker declares rather than
negotiates (ENDP-19) and an order it holds (ENDP-23). The cursor names a position and never an
offset (ENDP-33) — see the rule in SKILL.md for why an offset loses records invisibly.

## 6. Version negotiation

A caller may send `Worker-Protocol-Capability-Version` on any request (ENDP-6). A version the Worker
cannot answer is refused whole with `unsupported_version`, never answered with a different one.

## 7. Idempotency, where an Action declares it

Declared per Action (ENDP-15):

- a required key that is absent is `400` (ENDP-18);
- a key reused with a different body is `409` (ENDP-17);
- a repeat inside the window replays the recorded outcome rather than performing again (ENDP-16);
- a key in use is `503` `unavailable`, `retry` rather than `reject` (ENDP-32).

**Whose a key is follows where it is read from.** A key from the `Idempotency-Key` header belongs to
the caller that sent it, so the same string from two callers is two keys (ENDP-34): record it under
the caller your authentication found, not under the token, which changes on rotation. A key read
from a declared member of the input belongs to the Action, so any caller sending it names the same
performance (ENDP-35). A Worker that cannot tell its callers apart has one caller.

**Record outcomes where they outlive one process.** A map in memory is correct in one long-lived
process and silently wrong anywhere that scales horizontally: the repeat reaches an instance that
recorded nothing, the work runs twice, and both calls answer `200`, so nothing observable says it
happened.

**A Worker that performs an Action by calling another sends a key derived from the caller's.** A
repeat reaches the work again only after an earlier attempt failed or refused, and the Worker
downstream may already have acted; a key made from the caller's lets ENDP-16 answer it there too.
Derive it from the caller's key and the caller together — two callers may send the same header
key and mean two performances (ENDP-34) — and keep the derivation stable across deployments.

## 8. Input validation

Against the JSON Schema published for that Action (ACT-2). A body that parses and does not match is
`schema_mismatch`; one that matches and the Worker's own rules refuse is `unprocessable_content`
(ACT-9). Publish the schema and validate against the same declaration, so the form a console renders
and the validation a request meets cannot drift apart.
