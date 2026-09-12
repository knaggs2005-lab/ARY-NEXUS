# Realtime microphone capture (Stage 2E-A)

Capture contracts and pure conversion utilities are local-only. Canonical frames are mono PCM16 at 24 kHz. Frames use a bounded 20 ms duration (480 samples). Float32 samples are clamped, NaN becomes silence, and linear interpolation performs deterministic sample-rate conversion. Audio remains in memory and is never logged, persisted, audited, or sent over the network in this stage.

Lifecycle supports capturing, pause/resume, and idempotent stop. Browser/Electron wiring and realtime forwarding remain disconnected for Stage 2E-B.
