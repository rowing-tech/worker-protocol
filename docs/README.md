# docs

The narrative: what this protocol is for, the architecture it assumes, and the reasoning that the
normative text leaves out. Nothing here is normative.

| File | What it holds |
|---|---|
| [architecture.md](architecture.md) | The model and why it is shaped this way — Workers, the Control Tower, Tasks and Claims, Services and Contracts — opening with the dictionary of terms the rest of the repository uses |
| [undecided.md](undecided.md) | What is open on purpose. An entry leaves it when a `spec/` section answers it |
| [roadmap.md](roadmap.md) | What is decided and not yet built, with what was rejected and why. An entry leaves it when the repository holds the thing |

Start with `architecture.md`. Its dictionary comes first and is ordered so that each term is
defined using only the ones above it, as far as the terms allow — Worker comes first and names what
hangs off it; the argument that follows earns each of them in turn.
