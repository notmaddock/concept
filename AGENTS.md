# Repository guidance

Store all design documents, implementation plans, TODO lists, code reviews,
investigation notes, and other agent working documents in the root `codex/`
folder. Keep these documents out of source directories and the repository root.
The `codex/` folder is local-only and excluded through `.git/info/exclude`; do not
force-add its contents to Git.
