# Agent Guidelines & Rules

This document outlines the operational rules and standards that all AI agents must strictly follow when working in this codebase.

---

## 1. Package Management

- **Strictly use `pnpm`**: Always use `pnpm` for installing packages, running scripts, and executing tools (`pnpm add`, `pnpm dlx`, `pnpm run <script>`).
- **Never use alternative package managers**: Do not use `npm`, `yarn`, or `bun` under any circumstances.
- **Example commands**:
  - Run scripts: `pnpm run <script>` (e.g., `pnpm run dev`, `pnpm run build`)
  - Install dependencies: `pnpm add <pkg>` / `pnpm add -D <pkg>`
  - Run one-off CLI tools: `pnpm dlx <package>`

---

## 2. UI Components & shadcn CLI

- **Always use the official shadcn CLI to add components**:
  - Run `pnpm dlx shadcn@latest add <component>` to add any component from the registry.
  - **NEVER** write or manually recreate components that belong in the component library. All base UI primitives and shadcn components must be installed via the CLI.
- **Component Modifications (`src/components/ui/`)**:
  - **Never edit shadcn components directly without asking**: Do not edit files inside `src/components/ui/` unless you have explicitly asked the user and received confirmation.
  - **Only ask when strictly necessary**: Only request permission to edit a shadcn component if it is absolutely necessary to complete functionality that cannot be achieved via composition, wrapping, custom hooks, or props.
  - **Prefer composition**: Wrap or extend shadcn components from features or higher-level components outside `src/components/ui/` (e.g., in `src/components/` or feature directories).

---

## 3. Code Comments & Documentation

- **Comment only when code is not self-explanatory**: Code should be clean, declarative, and self-documenting through clear naming and modular structure.
- **Avoid redundant comments**: Do not add comments that state the obvious or mirror what the code syntax already conveys (e.g., do not write `// handle click`, `// define user state`, or `// export component`).
- **When comments are warranted**:
  - Documenting the _why_ behind non-intuitive logic, edge cases, or architectural constraints.
  - Complex algorithms, subtle state synchronizations, or non-obvious workarounds for upstream library quirks.

---

## 4. Code Quality & Standards

- **Validation**: Ensure code passes formatting, linting, and typechecking:
  - `pnpm run check` (Prettier check)
  - `pnpm run lint` (ESLint)
  - `pnpm run typecheck` (TypeScript)
  - `pnpm run build` (Vite build)
- **TypeScript**: Write strict, strongly-typed code without resorting to `any` unless integrating with untyped third-party boundaries.

---

## 5. Commit Messages

- **Follow the repository's conventional commit style**: Use a lowercase type, optional lowercase scope, and concise lowercase summary in the format `<type>(<scope>): <summary>` (e.g., `feat(nova): add format popup plugin`, `clean(editor): remove debug border`, or `test: configure vitest environment`).
- **Match the scope to the affected area** and choose a type that describes the change, such as `feat`, `fix`, `clean`, or `test`.
