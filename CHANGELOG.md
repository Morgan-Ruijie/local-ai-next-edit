# Changelog

All notable changes to this project will be documented in this file.

## 0.1.1 - 2026-09-09

- Added correction-first Tab handling while preserving Continue autocomplete when no rewrite is pending.
- Added an explicit inline replacement preview and Esc dismissal.
- Added diagnostic-aware local identifier correction, including `pkt` → `plt` when nearby context is unambiguous.
- Hardened model-output validation and incomplete-fragment retry behavior.
- Kept all inference local to loopback Ollama and the configured existing model.

## 0.1.0 - 2026-09-09

- Initial Python-focused MVP.
- Added diagnostic-gated rewrites, debounce, cancellation, Quick Fix support, and local Ollama integration.
