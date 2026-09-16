# Registration and credentials

`open`

How a Worker comes to be known by the Hub, and how the two sides of every call prove who they are.
Enrollment is settled in shape: an operator gives the Hub a URL and a credential, the Hub reads the
[Descriptor](descriptor.md) it finds there, and the registry follows from that.

To answer here:

- What the credential an operator gives at enrollment is, and how it relates to the ones a
  Contract carries.
- What the Hub does when the Descriptor at an enrolled URL answers with a different id than before.
- How the Hub authenticates when it polls, and how a consumer authenticates against an owner under
  a Contract.
- What kind of credential a Contract carries, how it is presented on a request, and how it is
  rotated and revoked — including while a Task is claimed under it, which is open in
  [undecided](../docs/undecided.md).
- What a Worker does with a caller it does not recognize, and what it reveals to one.
