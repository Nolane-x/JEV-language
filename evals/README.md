# Evaluations

Evaluation is separated from ordinary unit testing.

The evaluation substrate is implemented in `packages/evaluation-core`. Dataset manifests use explicit domains and the four-way split discipline required by the master specification:

- development
- calibration
- validation
- test

Evaluation domains currently represented by the common reporter/runner ABI are:

- semantic
- NLU
- NLG
- dialogue
- multilingual
- synthesis
- repair

Decision evaluation reports candidate recall separately from selection accuracy conditioned on the correct candidate being present and from end-to-end accuracy. Calibration reports reliability bins, Brier score, expected calibration error, coverage/selective accuracy, and risk-coverage points.

Jev-native benchmark runs must emit a zero-generative audit. Any generative-model call or external generation service invalidates the Jev-native label. Embedding calls are zero by default; a profile that explicitly permits non-zero embedding calls must name that profile.

Recorded deterministic evaluations are safe for CI. Live Jev evaluations require explicit opt-in and must report usage separately from deterministic compute.

Human-only measurements such as naturalness are not synthesized from proxy metrics. When no human labels exist, those fields remain unobserved rather than being assigned a fabricated score.

The current T276-T288 wave is an evaluation **foundation plus controlled integrations**. It does not claim that broad open-domain semantic/NLU/NLG/dialogue/synthesis/repair benchmark corpora are already complete.
