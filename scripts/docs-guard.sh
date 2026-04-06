#!/usr/bin/env bash
set -euo pipefail

# Fails when core project files changed but project docs were not updated.

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  changed_files="$(git diff --name-only HEAD)"
else
  changed_files="$(git ls-files -m -o --exclude-standard)"
fi

if [[ -z "${changed_files}" ]]; then
  exit 0
fi

tracked_regex='^(package\.json|\.env\.example|drizzle\.config\.ts|src/app/layout\.tsx|src/app/\(app\)/layout\.tsx|src/components/layout/AppShell\.tsx|src/components/chat/(ChatInterface|ChatSidebar|SettingsPanel|SourcesPanel)\.tsx|src/app/api/chat/route\.ts|src/app/api/search/route\.ts|src/app/api/conversations/route\.ts|src/app/api/conversations/\[id\]/route\.ts|src/lib/db/(schema|index)\.ts|src/lib/types\.ts|src/lib/rag/(retriever|embedder|cache|system-prompt|scripture-reference|citation-links)\.ts)$'
docs_regex='^(AGENTS\.md|docs/PROJECT_INFO\.md)$'

if echo "${changed_files}" | grep -Eq "${tracked_regex}"; then
  if ! echo "${changed_files}" | grep -Eq "${docs_regex}"; then
    echo "[docs-guard] Core project files changed but docs were not updated." >&2
    echo "[docs-guard] Update AGENTS.md or docs/PROJECT_INFO.md in the same change." >&2
    echo "" >&2
    echo "Changed core tooling files:" >&2
    echo "${changed_files}" | grep -E "${tracked_regex}" >&2 || true
    exit 1
  fi
fi

exit 0
