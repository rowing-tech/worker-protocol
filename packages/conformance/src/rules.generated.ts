// Generated from spec/ and conformance/verifiability.md by
// packages/conformance/src/generate-rules.ts. Do not edit: run `pnpm rules:generate`.
//
// The universe rules.json holds, as a module, so that the library imports it rather than
// reading a file: it is what lets verify() run where there is no filesystem.

import type { Attribution } from "./attribution.ts";
import type { Code } from "./checks/endpoints.ts";
import type { Rule } from "./report.ts";

export const UNIVERSE: { rules: Rule[]; codes: Code[]; attribution: Attribution } = {
  "rules": [
    {
      "id": "ACT-2",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-3",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-4",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-5",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-6",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-7",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-8",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-9",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACT-10",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-11",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACT-12",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACT-13",
      "file": "actions.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-14",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACT-15",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACT-16",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACT-17",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "ACT-18",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "ACT-19",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ACT-20",
      "file": "actions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "ACT-21",
      "file": "actions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ACTV-1",
      "file": "activity.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACTV-2",
      "file": "activity.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACTV-3",
      "file": "activity.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACTV-4",
      "file": "activity.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ACTV-5",
      "file": "activity.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ACTV-6",
      "file": "activity.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ACTV-7",
      "file": "activity.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.4"
    },
    {
      "id": "ALRT-1",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-2",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-3",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-4",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-5",
      "file": "alerts.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ALRT-6",
      "file": "alerts.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-7",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ALRT-8",
      "file": "alerts.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.4"
    },
    {
      "id": "ALRT-9",
      "file": "alerts.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.5"
    },
    {
      "id": "DESC-1",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-2",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-3",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-5",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-6",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-8",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-9",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-11",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-12",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-13",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-14",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-15",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-16",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-18",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-19",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-20",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-22",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-23",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-24",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-25",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-26",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-27",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-28",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-29",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "DESC-30",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "DESC-31",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.3"
    },
    {
      "id": "DESC-32",
      "file": "descriptor.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-33",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-34",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-35",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-36",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-37",
      "file": "descriptor.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "DESC-38",
      "file": "descriptor.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-1",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-2",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-3",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ENDP-4",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-5",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ENDP-6",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-11",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-12",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-13",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-14",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-15",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ENDP-16",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-17",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-18",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-19",
      "file": "endpoints.md",
      "class": "recommended",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-20",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-21",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-23",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-24",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-25",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ENDP-26",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-27",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-28",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-29",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "ENDP-30",
      "file": "endpoints.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-31",
      "file": "endpoints.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-32",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "ENDP-33",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.2"
    },
    {
      "id": "ENDP-34",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.3"
    },
    {
      "id": "ENDP-35",
      "file": "endpoints.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.3"
    },
    {
      "id": "ENDP-36",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-37",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-38",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-39",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-40",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "ENDP-41",
      "file": "endpoints.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "EVT-1",
      "file": "events.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-4",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-5",
      "file": "events.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-6",
      "file": "events.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-7",
      "file": "events.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-8",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-9",
      "file": "events.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "EVT-11",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "EVT-12",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "EVT-13",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "EVT-14",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "EVT-15",
      "file": "events.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "EVT-16",
      "file": "events.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.4"
    },
    {
      "id": "EVT-17",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.6"
    },
    {
      "id": "EVT-18",
      "file": "events.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.6"
    },
    {
      "id": "EVT-19",
      "file": "events.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.6"
    },
    {
      "id": "HLTH-1",
      "file": "health.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "HLTH-2",
      "file": "health.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "HLTH-3",
      "file": "health.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "HLTH-4",
      "file": "health.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "HLTH-5",
      "file": "health.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "LOG-1",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-2",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-3",
      "file": "logs.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-4",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-5",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-6",
      "file": "logs.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-7",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-8",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-9",
      "file": "logs.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.2"
    },
    {
      "id": "LOG-10",
      "file": "logs.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.2"
    },
    {
      "id": "MET-1",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-3",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-4",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-5",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-6",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-7",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-8",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-9",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-10",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-11",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-12",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-13",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-14",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-15",
      "file": "metrics.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-16",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-17",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-18",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-19",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-20",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "MET-21",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "MET-22",
      "file": "metrics.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "NAME-1",
      "file": "naming.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-2",
      "file": "naming.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-3",
      "file": "naming.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-4",
      "file": "naming.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-5",
      "file": "naming.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-6",
      "file": "naming.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-7",
      "file": "naming.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-8",
      "file": "naming.md",
      "class": "recommended",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-9",
      "file": "naming.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "NAME-10",
      "file": "naming.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "NDG-1",
      "file": "nudges.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "NDG-2",
      "file": "nudges.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "NDG-3",
      "file": "nudges.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-3",
      "file": "registration.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-7",
      "file": "registration.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-8",
      "file": "registration.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-13",
      "file": "registration.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "REG-14",
      "file": "registration.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-16",
      "file": "registration.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-19",
      "file": "registration.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-21",
      "file": "registration.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "REG-24",
      "file": "registration.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-26",
      "file": "registration.md",
      "class": "recommended",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-27",
      "file": "registration.md",
      "class": "recommended",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-28",
      "file": "registration.md",
      "class": "recommended",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-29",
      "file": "registration.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-30",
      "file": "registration.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-31",
      "file": "registration.md",
      "class": "recommended",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-32",
      "file": "registration.md",
      "class": "recommended",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-33",
      "file": "registration.md",
      "class": "recommended",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "REG-34",
      "file": "registration.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "REG-35",
      "file": "registration.md",
      "class": "required",
      "reach": "P",
      "introducedIn": "0.4"
    },
    {
      "id": "REG-36",
      "file": "registration.md",
      "class": "recommended",
      "reach": "P",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-1",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-2",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-3",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-4",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-5",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-6",
      "file": "subscriptions.md",
      "class": "recommended",
      "reach": "W",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-7",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-8",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-9",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-10",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-11",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-12",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-13",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-14",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-15",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-16",
      "file": "subscriptions.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "SUB-17",
      "file": "subscriptions.md",
      "class": "recommended",
      "reach": "H",
      "introducedIn": "0.4"
    },
    {
      "id": "TASK-4",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-5",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-6",
      "file": "tasks.md",
      "class": "required",
      "reach": "H",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-8",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-15",
      "file": "tasks.md",
      "class": "required",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-19",
      "file": "tasks.md",
      "class": "recommended",
      "reach": "N",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-27",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-28",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1"
    },
    {
      "id": "TASK-31",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "TASK-32",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.1",
      "withdrawnIn": "0.4"
    },
    {
      "id": "TASK-33",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4",
      "withdrawnIn": "0.5"
    },
    {
      "id": "TASK-34",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.4",
      "withdrawnIn": "0.5"
    },
    {
      "id": "TASK-35",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.5"
    },
    {
      "id": "TASK-36",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.5"
    },
    {
      "id": "TASK-37",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.5"
    },
    {
      "id": "TASK-38",
      "file": "tasks.md",
      "class": "required",
      "reach": "W",
      "introducedIn": "0.5"
    }
  ],
  "codes": [
    {
      "code": "conflict",
      "status": 409,
      "class": "reject"
    },
    {
      "code": "forbidden",
      "status": 403,
      "class": "reject"
    },
    {
      "code": "idempotency_key_required",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "idempotency_key_reused",
      "status": 409,
      "class": "reject"
    },
    {
      "code": "internal_error",
      "status": 500,
      "class": "retry"
    },
    {
      "code": "invalid_parameter",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "malformed_request",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "not_found",
      "status": 404,
      "class": "reject"
    },
    {
      "code": "rate_limited",
      "status": 429,
      "class": "retry"
    },
    {
      "code": "request_timeout",
      "status": 408,
      "class": "retry"
    },
    {
      "code": "schema_mismatch",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "unauthenticated",
      "status": 401,
      "class": "reject"
    },
    {
      "code": "unavailable",
      "status": 503,
      "class": "retry"
    },
    {
      "code": "unknown_filter",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "unprocessable_content",
      "status": 422,
      "class": "reject"
    },
    {
      "code": "unsupported_version",
      "status": 400,
      "class": "reject"
    },
    {
      "code": "upstream_error",
      "status": 502,
      "class": "retry"
    },
    {
      "code": "upstream_timeout",
      "status": 504,
      "class": "retry"
    }
  ],
  "attribution": {
    "action-declaration": {
      "": "ACT-2",
      "completesWithinCall": "ACT-4",
      "idempotency": "ACT-19",
      "idempotency/from": "ENDP-38",
      "idempotency/required": "ENDP-18",
      "input": "ACT-2",
      "readAddress": "ACT-21",
      "result": "ACT-3",
      "supersededBy": "NAME-10"
    },
    "actions-entry": {
      "": "ACT-16",
      "accepts": "ACT-16",
      "accepts/*": "ACT-2",
      "accepts/*/completesWithinCall": "ACT-4",
      "accepts/*/idempotency": "ACT-19",
      "accepts/*/idempotency/from": "ENDP-38",
      "accepts/*/idempotency/required": "ENDP-18",
      "accepts/*/input": "ACT-2",
      "accepts/*/readAddress": "ACT-21",
      "accepts/*/result": "ACT-3",
      "accepts/*/supersededBy": "NAME-10",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "activity-entry": {
      "": "ACTV-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "activity-page": {
      "": "ACTV-2",
      "items": "ACTV-2",
      "nextCursor": "ENDP-21"
    },
    "activity-state": {
      "": "ACTV-4"
    },
    "activity": {
      "": "ACTV-3",
      "id": "ACTV-3",
      "since": "ACTV-3",
      "state": "ACTV-4",
      "summary": "ACTV-3"
    },
    "alert-ended": {
      "": "EVT-15",
      "id": "EVT-15",
      "severity": "ALRT-4"
    },
    "alert-page": {
      "": "ALRT-2",
      "items": "ALRT-2",
      "nextCursor": "ENDP-21"
    },
    "alert-severity": {
      "": "ALRT-4"
    },
    "alert": {
      "": "ALRT-3",
      "id": "ALRT-3",
      "inputs": "ALRT-9",
      "severity": "ALRT-4",
      "since": "ALRT-3",
      "summary": "ALRT-3"
    },
    "alerts-entry": {
      "": "ALRT-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "capability-entry": {
      "": "DESC-22",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "capability-name": {
      "": "DESC-8"
    },
    "descriptor": {
      "": "DESC-1",
      "capabilities": "DESC-22",
      "capabilities/*": "DESC-22",
      "capabilities/*/address": "DESC-36",
      "capabilities/*/version": "DESC-9",
      "edition": "DESC-23",
      "id": "DESC-6",
      "skills": "TASK-36",
      "skills/*": "TASK-36",
      "skills/*/payload": "TASK-36",
      "skills/*/produces": "TASK-36"
    },
    "error": {
      "": "ENDP-39",
      "class": "ENDP-26",
      "code": "ENDP-39",
      "message": "ENDP-39"
    },
    "event-destination": {
      "": "EVT-13"
    },
    "event-type-declaration": {
      "": "EVT-12",
      "data": "EVT-12",
      "destination": "EVT-13",
      "extensions": "EVT-17",
      "supersededBy": "NAME-7"
    },
    "events-entry": {
      "": "EVT-13",
      "address": "DESC-36",
      "broker": "EVT-13",
      "destination": "EVT-13",
      "protocolBinding": "EVT-13",
      "publishes": "EVT-12",
      "publishes/*": "EVT-12",
      "publishes/*/data": "EVT-12",
      "publishes/*/destination": "EVT-13",
      "publishes/*/extensions": "EVT-17",
      "publishes/*/supersededBy": "NAME-7",
      "republishWindowSeconds": "EVT-8",
      "version": "DESC-9"
    },
    "health-entry": {
      "": "HLTH-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "health-status": {
      "": "HLTH-2"
    },
    "health": {
      "": "HLTH-2",
      "checks": "HLTH-2",
      "checks/*": "HLTH-2",
      "checks/*/detail": "HLTH-2",
      "checks/*/status": "HLTH-2",
      "status": "HLTH-2"
    },
    "idempotency-declaration": {
      "": "ACT-19",
      "from": "ENDP-38",
      "required": "ENDP-18"
    },
    "log-level": {
      "": "LOG-5"
    },
    "log-page": {
      "": "LOG-2",
      "nextCursor": "ENDP-21"
    },
    "log-record": {
      "": "LOG-4",
      "at": "LOG-4",
      "fields": "LOG-9",
      "level": "LOG-5",
      "message": "LOG-4"
    },
    "logs-entry": {
      "": "LOG-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "metric-bucket": {
      "": "MET-13",
      "dimensions": "MET-19",
      "end": "MET-13",
      "start": "MET-13"
    },
    "metric-declaration": {
      "": "MET-21",
      "additive": "MET-3",
      "dimensions": "MET-4",
      "dimensions/*": "MET-4",
      "dimensions/*/values": "MET-4",
      "granularities": "MET-3",
      "unit": "MET-3"
    },
    "metric-dimension": {
      "": "MET-4",
      "values": "MET-4"
    },
    "metric-granularity": {
      "": "MET-3"
    },
    "metric-page": {
      "": "MET-14",
      "items": "MET-14",
      "nextCursor": "ENDP-21"
    },
    "metrics-entry": {
      "": "MET-1",
      "address": "DESC-36",
      "publishes": "MET-21",
      "publishes/*": "MET-21",
      "publishes/*/additive": "MET-3",
      "publishes/*/dimensions": "MET-4",
      "publishes/*/dimensions/*": "MET-4",
      "publishes/*/dimensions/*/values": "MET-4",
      "publishes/*/granularities": "MET-3",
      "publishes/*/unit": "MET-3",
      "timeZone": "MET-6",
      "version": "DESC-9"
    },
    "nudge": {
      "": "NDG-2",
      "type": "NAME-7"
    },
    "nudges-entry": {
      "": "NDG-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "page": {
      "": "ENDP-20",
      "items": "ENDP-20",
      "nextCursor": "ENDP-21"
    },
    "qualified-name": {
      "": "NAME-7"
    },
    "skill-declaration": {
      "": "TASK-36",
      "payload": "TASK-36",
      "produces": "TASK-36"
    },
    "subscription-ended": {
      "": "SUB-15",
      "since": "SUB-15"
    },
    "subscription-filter": {
      "": "SUB-13",
      "exact": "SUB-13",
      "prefix": "SUB-13",
      "suffix": "SUB-13"
    },
    "subscription-page": {
      "": "SUB-8",
      "items": "SUB-8",
      "nextCursor": "ENDP-21"
    },
    "subscription-receipt": {
      "id": "SUB-2"
    },
    "subscription-request": {
      "": "SUB-2",
      "filters": "SUB-13",
      "sink": "SUB-5",
      "sinkCredential": "SUB-11",
      "types": "SUB-2"
    },
    "subscription": {
      "": "SUB-8",
      "endedAt": "SUB-15",
      "failingSince": "SUB-16",
      "filters": "SUB-13",
      "id": "SUB-8",
      "lastDeliveredAt": "SUB-16",
      "sink": "SUB-5",
      "types": "SUB-2"
    },
    "subscriptions-entry": {
      "": "SUB-1",
      "abandonAfterSeconds": "SUB-1",
      "address": "DESC-36",
      "version": "DESC-9"
    },
    "task-ended": {
      "": "EVT-15",
      "id": "EVT-15",
      "type": "NAME-7"
    },
    "task-page": {
      "": "TASK-5",
      "items": "TASK-5",
      "nextCursor": "ENDP-21"
    },
    "task-type-declaration": {
      "": "TASK-35",
      "answeredBy": "TASK-35",
      "payload": "TASK-35",
      "supersededBy": "NAME-7"
    },
    "task": {
      "": "TASK-28",
      "available": "TASK-38",
      "id": "TASK-28",
      "inputs": "TASK-37",
      "payload": "TASK-28",
      "since": "TASK-28",
      "type": "NAME-7"
    },
    "tasks-entry": {
      "": "TASK-27",
      "address": "DESC-36",
      "raises": "TASK-35",
      "raises/*": "TASK-35",
      "raises/*/answeredBy": "TASK-35",
      "raises/*/payload": "TASK-35",
      "raises/*/supersededBy": "NAME-7",
      "version": "DESC-9"
    }
  }
};
