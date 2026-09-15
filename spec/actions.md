# Actions

`open`

How a Worker declares the operations it accepts, and how somebody performs one. An Action is
published with a schema and an address, and is the only way to act on a Worker.

To answer here:

- How an Action is declared: name, input schema, address, and what it answers.
- How `configure` works on both sides — the Action that writes settings, and the reading surface
  that lets a console show a form with the current values in it.
- What a Worker answers when an input fails its own schema, and what it answers when the operation
  fails for its own reasons.
- Whether performing an Action is synchronous, and what a caller gets if it is not.
