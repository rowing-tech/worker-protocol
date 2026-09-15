# conformance

Request and response fixtures, in plain JSON, independent of any language: what a worker is asked
and what a conformant answer looks like.

They are the evidence behind every claim of compliance, and they are kept here rather than inside a
package so that a verifier in any language can use them. `packages/conformance` is the one that
runs them over HTTP against a live worker.
