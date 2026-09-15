# Indicators

`open`

The few named quantities a Worker exposes for deciding whether it is worth running — cost, volume,
outcomes — each carrying the period it covers.

To answer here:

- The envelope: name, value, unit, and the period, which is what separates an indicator from an
  instantaneous measurement.
- How a Worker declares which indicators it publishes and what each means, so a console can label
  one it has never seen.
- Which periods are expressible, and how a consumer asks for a past one rather than the current.
- Whether an indicator may be absent, and what that means to whoever reads it.
