# Architecture

`enabledModels` is the hard availability boundary. The router may filter and score
only entries in `settings/model-capabilities.json` that are also in the runtime scope.
A manually selected `/model` is never replaced by routing policy.

Local providers are OpenAI-compatible llama.cpp endpoints. Provider credentials stay
in `~/.pi/agent/auth.json` or server secret files. Extensions run with Pi's user
permissions; browser and bash guard are opt-in and are not a sandbox.
