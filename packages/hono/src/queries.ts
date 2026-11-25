/**
 * `queries`: the reads a Worker defines, declared once and answered by `mount()`.
 *
 * It is `actions` for the other half, and divided the same way. What this protocol fixes is here:
 * the Query named in a parameter (QRY-13), the refusal for one that is not declared (QRY-6), for a
 * request that names none (QRY-7), for a credential that does not cover it (QRY-10, QRY-11), for parameters
 * its schema refuses (QRY-14) and for one it does not declare at all (ENDP-24), and the page envelope
 * a collection travels in (QRY-9). What is left with the Worker is what only it knows: what the
 * Query takes, what it answers, and the read itself.
 */
import * as z from "zod";
import { jsonSchema } from "./actions.ts";
import type { ErrorCode } from "./codes.ts";
import { type Covered, within } from "./grants.ts";
import type { CallContext, Refusal } from "./worker.ts";

/** What a read knows about the call it arrived on, beyond its parameters. */
export type QueryCall = CallContext & {
  /** The Query's own name, for a read shared between several. */
  name: string;
};

/** What the read of a collection is told beside that: where to resume, and how much to answer. */
export type QueryPageCall = QueryCall & {
  /** ENDP-21. Exactly the string this Worker last answered as `nextCursor`, or absent for the first page. */
  cursor?: string;
  /** ENDP-19. The most items one page carries. */
  limit: number;
};

/**
 * One page of a collection, as the Worker answers it.
 *
 * The cursor is the Worker's, as it is for `logs`, because the position it names is a position in
 * the Worker's own store. ENDP-33 is what it owes in return: a page reached through one carries no
 * item the page before it carried, which a cursor naming a position in the order gives for free
 * and an offset cannot give at all. ENDP-23's order is the Worker's too, and nothing here re-sorts.
 */
export type QueryPage = {
  items: unknown[];
  /** ENDP-20. Absent at the end of the collection — absent, not null. */
  nextCursor?: string;
};

/**
 * QRY-12. The parameters of a Query: a Zod object each of whose members is a string or an array of
 * strings, because a GET carries them in its query string — an array as the key repeated, once per
 * element (QRY-13). Narrow a string with `z.enum`, a `regex` or a format; an optional member is
 * `z.string().optional()`, and a list is `z.array(z.string())`.
 *
 * A list never reaches `read` empty, because a query string cannot carry one: no key is the
 * parameter absent. Required, that is QRY-14's `400` and `read` is not called. Optional —
 * `z.array(z.string()).optional()` — it is `undefined`, which means *no filter* and not *none of
 * them*, so test for `undefined` and not for a length. `mount()` refuses a list that defaults to
 * an empty one, which would hand `read` exactly that.
 */
export type QueryParameters = z.ZodObject;

type Declared = {
  /** QRY-12. Left out, the Query takes none. */
  parameters?: QueryParameters;
};

/**
 * What a Worker declares about one Query, and how it reads it.
 *
 * QRY-4: `result` or `items`, and never both. They are Zod objects here and JSON Schema in the
 * Descriptor; `mount()` converts them, so nothing is declared twice and nothing can drift.
 *
 * **`read` changes nothing a later reader could observe (ENDP-2).** That is the whole difference
 * from an Action's `run`, and it is not something this package can check: a read that marks
 * something seen, advances a position or consumes what it returned is an Action that answers a
 * result, and is declared as one.
 *
 * **A read about something this Worker does not hold answers that, and refuses nothing.** `404` on
 * this address means the Query is not declared (QRY-6), so a plate nobody registered is said inside
 * what `result` declares — a flag, a member left out — and is an empty page under `items`. That is
 * why the first `read` below has no way to refuse. The second has one for the reason `logs` does:
 * the cursor is the Worker's, so only the Worker can say that one it is handed is not one it
 * answered, and it says so with `invalid_parameter`.
 */
export type Query =
  | (Declared & {
      /** QRY-4. The one document a read answers. */
      result: z.ZodType;
      items?: undefined;
      /** The parameters have already been validated against `parameters` above. */
      read: (parameters: never, call: QueryCall) => unknown | Promise<unknown>;
    })
  | (Declared & {
      /** QRY-4. One item of the collection a read answers, in the shared page envelope (QRY-9). */
      items: z.ZodType;
      result?: undefined;
      /** One page, from the position `call.cursor` names, of at most `call.limit` items. */
      read: (
        parameters: never,
        call: QueryPageCall,
      ) => QueryPage | Refusal | Promise<QueryPage | Refusal>;
    });

export type QueryDeclarations = Record<string, Query>;

/**
 * Write a Query, and have `read` typed by the schemas above it — what `action()` does for an
 * Action, for the same reason: a record of Queries cannot carry one type parameter per entry, so
 * annotating the record would make every author write the parameters a second time by hand.
 *
 * ```ts
 * answers: {
 *   position: query({
 *     parameters: z.object({ vehicle: z.string() }),
 *     result: z.object({ lat: z.number(), lng: z.number(), at: z.string() }),
 *     read: ({ vehicle }) => …,   // vehicle is a string, from two lines above
 *   }),
 *   positions: query({
 *     items: z.object({ vehicle: z.string(), lat: z.number(), lng: z.number() }),
 *     read: (_, { cursor, limit }) => …,   // one page: { items, nextCursor? }
 *   }),
 * }
 * ```
 *
 * Like `action()` and `defineWorker`, it returns its argument and no rule id can be cited for it.
 */
export function query<P extends QueryParameters, R extends z.ZodType>(declaration: {
  parameters?: P;
  result: R;
  read: (parameters: z.infer<P>, call: QueryCall) => z.input<R> | Promise<z.input<R>>;
}): Query;
export function query<P extends QueryParameters, I extends z.ZodType>(declaration: {
  parameters?: P;
  items: I;
  read: (
    parameters: z.infer<P>,
    call: QueryPageCall,
  ) =>
    | { items: z.input<I>[]; nextCursor?: string }
    | Refusal
    | Promise<{ items: z.input<I>[]; nextCursor?: string } | Refusal>;
}): Query;
export function query(declaration: object): Query {
  return declaration as Query;
}

export type QueryFacts = {
  /** QRY-1. Every Query this Worker answers, keyed by name. */
  answers: QueryDeclarations;
  /**
   * QRY-10. Which Queries the credential presented covers, by name, or `undefined` for all of them.
   *
   * The same shape as the `covers` of Actions, and asked the same way: once per call, with the
   * call's context. A declared Query left out is `403` before its parameters are judged. A Worker
   * holding one static secret leaves this out and covers everything with it. A credential issued
   * through `grants` is bounded by the Queries its grant names (QRY-11), and this may only narrow
   * inside them.
   */
  covers?: (call: CallContext) => string[] | undefined | Promise<string[] | undefined>;
  /** ENDP-19 (recommended). The most items one page of a collection carries. */
  pageSize?: number;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** QRY-3. The two parameters this read defines itself, which no Query may declare. */
const RESERVED = new Set(["query", "cursor"]);

const NO_PARAMETERS = z.object({});

type ParameterSchema = { type?: unknown; items?: { type?: unknown } };

/** The members a Query declares, as their JSON Schema. */
const declaredParameters = (declared: Query): Record<string, ParameterSchema> =>
  (parametersSchema(declared).properties as Record<string, ParameterSchema> | undefined) ?? {};

/** QRY-12: a list of strings, which travels as the key repeated (QRY-13). */
const isList = (schema: ParameterSchema | undefined): boolean =>
  schema?.type === "array" && schema.items?.type === "string";

/** The JSON Schema of what a Query takes: an object with no members where it declared none. */
export const parametersSchema = (declared: Query): Record<string, unknown> =>
  jsonSchema(declared.parameters ?? NO_PARAMETERS);

/**
 * A Query this package cannot serve as the specification says, or `null`.
 *
 * Each is a mistake in how the Worker was written and none is one a request could reveal: a
 * parameter that is not a string validates against whatever the author's schema says and travels
 * as text anyway (QRY-12), and one named `cursor` would be taken by the envelope before the Worker
 * saw it (QRY-3). So they are found when the Worker is first read, where somebody can act on them.
 *
 * The last is a list that is empty when it is not sent, as `.default([])` makes it. No rule names
 * it; QRY-13 gives an empty list no spelling, so absent is *no filter* to every caller, and a
 * `read` handed `[]` would answer none of them — the opposite, in a shape nobody could tell apart.
 * A default that holds elements is a choice the Query may make, and is left alone.
 */
export function unreadable(answers: QueryDeclarations): string | null {
  for (const [name, declared] of Object.entries(answers)) {
    if ((declared.result === undefined) === (declared.items === undefined)) {
      return `QRY-4: the Query \`${name}\` declares exactly one of \`result\` and \`items\`.`;
    }
    for (const [parameter, schema] of Object.entries(declaredParameters(declared))) {
      if (RESERVED.has(parameter)) {
        return `QRY-3: the Query \`${name}\` declares a parameter named \`${parameter}\`, which this read defines itself.`;
      }
      if (schema.type !== "string" && !isList(schema)) {
        return `QRY-12: the parameter \`${parameter}\` of the Query \`${name}\` is neither a string nor an array of strings. A GET carries its parameters in the query string, so each is declared as one of the two.`;
      }
      // Asked of the schema itself and not read off its JSON Schema, so `.default([])`,
      // `.prefault([])` and `.catch([])` are all the same answer to the same question.
      const absent = isList(schema)
        ? (declared.parameters?.shape[parameter] as z.ZodType | undefined)?.safeParse(undefined)
        : undefined;
      if (absent?.success && Array.isArray(absent.data) && absent.data.length === 0) {
        return `QRY-13: the list \`${parameter}\` of the Query \`${name}\` is an empty list when it is not sent. A query string cannot carry an empty list, so no caller could mean one: left out is no filter, and \`read\` would select nothing where everything was asked for. Declare it \`.optional()\` and read \`undefined\` as no filter.`;
      }
    }
  }
  return null;
}

export function queries(facts: QueryFacts) {
  const cap = facts.pageSize ?? 100;

  // Which parameters of a Query are lists, read off its schema once and not once per request.
  const lists = new Map<Query, Set<string>>();
  const listsOf = (declared: Query): Set<string> => {
    let known = lists.get(declared);
    if (known === undefined) {
      known = new Set(
        Object.entries(declaredParameters(declared))
          .filter(([, schema]) => isList(schema))
          .map(([parameter]) => parameter),
      );
      lists.set(declared, known);
    }
    return known;
  };

  return async function read(asked: {
    search: URLSearchParams;
    context: CallContext;
    /**
     * QRY-11. The Queries the grant names, where a grant issued the credential — none where it
     * names none — and `undefined` for a credential no grant issued.
     */
    granted: Covered | undefined;
  }): Promise<Refusal | { body: unknown }> {
    const { search, context, granted } = asked;

    // QRY-7 before QRY-6: a request that names nothing has not said what it wants, which is a
    // parameter fault and nothing to do with what this Worker answers.
    const name = search.get("query");
    if (name === null || name === "") {
      return refuse("invalid_parameter", "Name the Query to read in `query`.");
    }
    const declared = Object.hasOwn(facts.answers, name) ? facts.answers[name] : undefined;
    if (declared === undefined) return refuse("not_found", `No Query named ${name}.`);

    // QRY-10, QRY-11: after QRY-6, because which Queries exist is no secret (REG-8), and before
    // the parameters, so a caller that may not read one learns nothing about what it takes.
    const covered = within(granted, await facts.covers?.(context));
    if (covered !== undefined && !covered.includes(name)) {
      return refuse("forbidden", "Not covered by this credential.");
    }

    // ENDP-24, then QRY-14. A parameter the Query does not declare is unknown here, `cursor` on a
    // Query that answers one document among them; a string parameter sent twice is sent wrongly,
    // and a list is read as its elements, in the order they came (QRY-13).
    const paged = declared.items !== undefined;
    const parameters = declared.parameters ?? NO_PARAMETERS;
    const listed = listsOf(declared);
    const sent: Record<string, string | string[]> = {};
    for (const key of new Set(search.keys())) {
      if (key === "query") {
        if (search.getAll(key).length > 1) {
          return refuse("invalid_parameter", "A read names one Query.");
        }
        continue;
      }
      const values = search.getAll(key);
      if (key === "cursor" && paged) {
        if (values.length > 1) return refuse("invalid_parameter", "A read carries one cursor.");
        continue;
      }
      if (!Object.hasOwn(parameters.shape, key)) {
        return refuse("unknown_filter", `The Query ${name} takes no parameter named ${key}.`);
      }
      if (listed.has(key)) {
        sent[key] = values;
        continue;
      }
      if (values.length > 1) {
        return refuse("invalid_parameter", `The parameter ${key} is sent at most once.`);
      }
      sent[key] = values[0] as string;
    }
    const parsed = parameters.safeParse(sent);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") || "the parameters";
      return refuse("invalid_parameter", `${where}: ${issue?.message ?? "refused"}.`);
    }

    const call: QueryCall = { ...context, name };
    if (declared.items === undefined) {
      return { body: await declared.read(parsed.data as never, call) };
    }
    const cursor = search.get("cursor") ?? undefined;
    const page = await declared.read(parsed.data as never, {
      ...call,
      ...(cursor === undefined ? {} : { cursor }),
      limit: cap,
    });
    if ("code" in page) return page;
    // ENDP-20: the cursor is absent at the end of the collection — absent, not null.
    return {
      body:
        page.nextCursor === undefined
          ? { items: page.items }
          : { items: page.items, nextCursor: page.nextCursor },
    };
  };
}
