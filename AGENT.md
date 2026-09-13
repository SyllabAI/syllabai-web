# SyllabAI Web — Multi-Agent Rules

The project-wide multi-agent operating system is canonical in `SyllabAI/syllabai` (`AGENT.md` + `.syllabai/`).

Web-specific rules:

1. UI owns presentation and interaction; domain/authorization/business rules remain in core.
2. Core↔web API changes are a shared contract: coordinate breaking changes and keep representative fixtures/tests aligned.
3. Frontend checks are never authorization. Do not infer learner mastery or educational truth from UI state.
4. Record task ID, owner/surface and base commit before substantial work.
5. If main advances and touched contract files overlap, reconcile before completion and rerun affected checks.
6. Keep changes small and independently mergeable; unrelated teacher/student work may proceed in parallel.
7. Completion claims must be labeled VERIFIED / INFERRED / REPORTED / UNVERIFIED and material milestones need durable evidence.
