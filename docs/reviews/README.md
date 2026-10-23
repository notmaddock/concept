> Remediation completed on `fix/cloud-fixes`, branched from `feat/cloud-saving`. All eight domain reports have per-finding triage outcomes. Confirmed issues were fixed in atomic commits; rejected findings retain evidence. Integration corrections preserved offline recovery, concurrent IndexedDB writes, peer-tab saves, and session boundaries. Final validation is recorded in `codex/cloud-fixes-orchestration.md`. No merge or deployment was performed. Migrations `0005` and `0006` must be applied independently to production and Preview before rollout. Original severity counts below describe the initial audit, not remaining defects.

# Comprehensive Codebase Scan & Audit Reports

This directory contains the complete, unabridged findings from the 8-domain concurrent subagent codebase review conducted on October 23, 2026.

## Executive Summary

- **Total Issues Identified**: 90
  - **Critical**: 12
  - **High**: 25
  - **Medium**: 34
  - **Low**: 19

---

## Domain Reports

| #     | Domain / Area                                   | Target Scope                                    | Critical | High | Medium | Low | Full Report                                                                                                  |
| ----- | ----------------------------------------------- | ----------------------------------------------- | :------: | :--: | :----: | :-: | ------------------------------------------------------------------------------------------------------------ |
| **1** | **Document Storage, Sync & Serialization**      | `src/lib/documents/`                            |    1     |  6   |   5    |  2  | [01-document-storage-and-sync.md](file:///home/maddock/concept/docs/reviews/01-document-storage-and-sync.md) |
| **2** | **Authentication, Security & Session Handling** | `src/lib/auth/`, `/api/auth/`                   |    0     |  0   |   4    |  1  | [02-auth-and-security.md](file:///home/maddock/concept/docs/reviews/02-auth-and-security.md)                 |
| **3** | **Nova Rich-Text Editor Subsystem**             | `src/components/nova/`                          |    2     |  3   |   4    |  2  | [03-nova-editor-subsystem.md](file:///home/maddock/concept/docs/reviews/03-nova-editor-subsystem.md)         |
| **4** | **Document UI Components & Custom Hooks**       | `src/components/documents/`, `src/hooks/`       |    3     |  5   |   6    |  4  | [04-document-ui-and-hooks.md](file:///home/maddock/concept/docs/reviews/04-document-ui-and-hooks.md)         |
| **5** | **Account Management & UI Primitives**          | `src/components/account/`, `src/components/ui/` |    0     |  0   |   5    |  3  | [05-account-and-shared-ui.md](file:///home/maddock/concept/docs/reviews/05-account-and-shared-ui.md)         |
| **6** | **Routing, Pages & Cloudflare Worker Runtime**  | `src/routes/`, `src/worker.ts`                  |    2     |  4   |   4    |  3  | [06-routing-and-worker.md](file:///home/maddock/concept/docs/reviews/06-routing-and-worker.md)               |
| **7** | **Config, Database Migrations & Environment**   | `migrations/`, `wrangler.jsonc`                 |    1     |  3   |   4    |  4  | [07-config-and-migrations.md](file:///home/maddock/concept/docs/reviews/07-config-and-migrations.md)         |
| **8** | **Test Suite Infrastructure & Coverage Audit**  | `src/**/*.test.ts*`, `src/test/`                |    3     |  4   |   7    |  3  | [08-test-suite-and-coverage.md](file:///home/maddock/concept/docs/reviews/08-test-suite-and-coverage.md)     |

---

## Top Priority Fix List

1. **Multi-Tab Infinite Google Drive Save Loop**: [`src/lib/documents/workspace-storage.ts#L48`](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L48)
2. **Nova Slash Menu Regex Crash (`SyntaxError`)**: [`src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L27`](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L27)
3. **Database Sign-in Trigger Bricks Better Auth User Deletion**: [`migrations/0003_sign_in_guards.sql#L2`](file:///home/maddock/concept/migrations/0003_sign_in_guards.sql#L2)
4. **`TanStackDevtools` Mounted in Production**: [`src/routes/__root.tsx#L9`](file:///home/maddock/concept/src/routes/__root.tsx#L9)
5. **Browser Back-Button Infinite Creation Loop on `/new`**: [`src/routes/new/index.tsx#L4`](file:///home/maddock/concept/src/routes/new/index.tsx#L4)
6. **Broken Storage Import Path Causing 4 Failing Tests**: [`src/components/documents/DocumentDetails.test.tsx#L16`](file:///home/maddock/concept/src/components/documents/DocumentDetails.test.tsx#L16)
7. **OAuth Callback Authorization Codes Leaked to Cloudflare Logs**: [`wrangler.jsonc#L41`](file:///home/maddock/concept/wrangler.jsonc#L41)
8. **30-Second Edit Blackout & Potential Data Loss**: [`src/lib/documents/workspace-storage.ts#L88`](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L88)
