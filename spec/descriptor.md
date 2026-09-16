# Descriptor

`open`

The document a Worker serves at a route this spec fixes, and the first thing anyone reads about
it: the Worker's own id, distinct from where it lives; the Capabilities it implements, each with
the address it answers at and the schemas it answers with; the edition of this protocol it speaks,
and a version per Capability. The Control Tower's registry is read from here, and the Tower keeps a
dated copy of the last one it saw.

To answer here:

- The route, and whether a Worker may serve it anywhere else.
- The envelope: how the id, the Capabilities and the versions are laid out.
- How the two versions are expressed — the edition of this specification, and the version of each
  Capability — and how a reader tells which Capabilities an edition may contain.
- How each Capability declares its address, and whether an address may point away from the host
  that serves the Descriptor.
- The prefix under which a Worker declares a Capability of its own, and what a verifier does with
  one it does not know.
- What a Descriptor that declares a Capability the Worker does not serve means to a verifier, to
  the Tower, and to a consumer that trusted it.
