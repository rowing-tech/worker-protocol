# Metrics

`open`

The few named quantities a Worker exposes for deciding whether it is worth running — cost, volume,
outcomes — each carrying the period it covers. A metric carries no valuation: it is a Fact the
Worker derived and is authoritative over, and where health says whether a Worker works, a metric
says what it did.

An **indicator** is a metric read against a level: once a level has been configured into the Worker,
it publishes a status beside the value, and a value outside the level is an Alert. A level is a
setting, so it arrives the one way this protocol writes into a Worker — the `configure` Action — and
comparing a metric against it is the Worker evaluating its own settings, which is a Fact of its own.
A Worker never reads a Contract to do it. The indicator is a shape inside this Capability, not a
second Capability and not a second endpoint.

Trend is why both live in the Worker. Reading a quantity against a level needs the history behind
it, the history is the Worker's, and the Tower holds no Worker's state.

A Contract is where a level comes from, one step removed: an operator, or a Tower acting on a
Contract it brokered, configures it. Two things keep it at that distance. A Contract is made over a
Service and a Service may span several Workers, so no one Worker's status is the Contract's verdict;
and a level a consumer agreed to is not something the Worker derived, so it arrives as a setting
somebody wrote rather than as a Fact the Worker claims. Whether a Contract carries service levels at
all, and how one agreed over a Service reaches the settings of the Workers behind it, is
[open](../docs/undecided.md).

To answer here:

- The envelope: name, value, unit, and the period, which is what separates a metric from an
  instantaneous measurement.
- How a Worker declares which metrics it publishes and what each means, so a console can label one
  it has never seen.
- Which periods are expressible, and how a consumer asks for a past one rather than the current.
- Whether a metric may be absent, and what that means to whoever reads it.
- How a metric declares that it accepts a level — and whether a Descriptor may carry a default one,
  or the level exists only once `configure` has written it, so that a Worker nobody has configured
  shows quantities and no judgments.
- What a metric's status is once a level is configured: whether the level is one bound or two, and
  whether the status takes three values the way health's does. The shape is health's — one value and
  a short detail — so that a console rendering a health check renders an indicator.
- Whether a metric is broken down by Contract, and whether that breakdown is declared per metric or
  is part of every metric's envelope. A Worker sees the credential on every request, so it is
  authoritative over which Contract each Claim, Action and Response came under, and a total split
  that way is still its own Fact. One declared breakdown, not labels: labels are how a metric turns
  into a time series.
- Whether the Alert a crossed level raises carries the Action that would reconfigure the level,
  since an Alert may carry Actions and `configure` is one.

A Worker that answers several Contracts has one set of settings and therefore one configured level,
and nothing here tries to express two. The level configured into a Worker is the Worker's and
operational; the judgment against what a particular consumer agreed belongs to whoever holds that
Contract, reading the Service's metrics under it. A level per Contract, with a status and an Alert
per Contract, is a possible later addition and nothing here blocks it.

**A Prometheus-style `/metrics` endpoint is not this Capability.** A Worker may serve one — like
anything else it serves undeclared, it is invisible here — and the two answer different questions.
This Capability is a few named quantities over a period each of them declares; a scrape is a time
series over whatever window the reader chooses. The period is the distinction.
