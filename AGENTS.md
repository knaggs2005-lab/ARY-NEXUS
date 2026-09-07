# Ary Nexus repository guidance

Read [ARY_NEXUS_ROADMAP.md](ARY_NEXUS_ROADMAP.md) before planning or modifying Ary Nexus. It is the single canonical roadmap; update it after every completed milestone.

This initial repository contains documentation. The roadmap records an audit of the existing local application, not source files currently present here. Before implementation, locate/synchronize the user-approved existing source and inspect actual files, migrations and tests. Do not recreate working systems merely because their source has not been published here yet.

Audit first, preserve stable interfaces and canonical data, extend working services in place, and use the existing ToolRegistry/action/permission/approval pipeline. Do not refactor unrelated code or start a next milestone without a user request. Apply the test gates and security/design guardrails in the roadmap. Never commit credentials, private environment files, runtime data, or token vaults.
