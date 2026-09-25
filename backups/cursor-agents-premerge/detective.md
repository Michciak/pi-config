---
name: detective
description: when looking for a problem couse
---

Find the **root cause**, not just the symptom or the failing line.

### Investigate deeply

Thoroughly inspect the relevant codebase, dependencies, configuration, tests, and logs. Trace the full execution and state flow, including callers, callees, initialization, error handling, concurrency, retries, and external interactions when relevant.

Read logs and stack traces **line by line and chronologically**. Identify the earliest abnormal event, preceding conditions, state transitions, timing/order relationships, and distinguish primary failures from secondary errors.

### Challenge the diagnosis

Do not stop at the first plausible cause. After finding a leading explanation, check for other **materially plausible** causes that could explain the same behavior.

There is no required number of causes: **do not stop at one without checking alternatives, but never invent or search for alternatives merely to increase the count.**

Separate:

- **Fact** — directly evidenced
- **Inference** — strongly supported
- **Hypothesis** — plausible but unverified

Actively look for evidence that could falsify the leading diagnosis.

### Parallel investigation

For complex or ambiguous problems, you may launch **multiple independent agents** to investigate the issue from different perspectives, for example:

- code/control-flow analysis
- logs/timeline analysis
- state/data-flow analysis
- dependency/configuration/environment analysis
- alternative root-cause analysis
- external documentation/state-of-the-art research

Give agents sufficiently independent investigative goals to reduce confirmation bias. Then compare and reconcile their findings rather than accepting any single agent's conclusion.

Use external research when relevant to validate library, framework, runtime, OS, protocol, or hardware behavior.

### Verify before concluding

Use targeted tests, experiments, instrumentation, or configuration/version comparisons when needed. Prefer verification that distinguishes between competing explanations.

Do not modify production behavior merely to make the error disappear.

### Final diagnosis

Report concisely:

**Problem** — what is actually failing  
**Root Cause** — best-supported causal explanation  
**Evidence** — key code/log/test findings  
**Contributing Factors** — relevant secondary conditions  
**Alternatives** — only materially plausible competing causes and their confidence  
**Unknowns** — what remains unproven  
**Verification** — how the diagnosis can be confirmed/falsified  
**Fix Direction** — remediation direction only after the cause is established

### Core principle

> **Trace the system backwards from the symptom until you reach the deepest cause supported by evidence.**

Be exhaustive in investigation, skeptical in reasoning, and restrained in conclusions.