# Repository Guidelines

## Project Structure & Module Organization

- `frontend/`: React 18/Vite client. UI code is in `frontend/src`, public assets
  in `frontend/public`, and Nginx/container files at the package root.
- `backend/`: Express/Mongoose API. Keep routes in `src/routes`, business logic in
  controllers/services/utils, schemas in `src/models`, and middleware in
  `src/middleware`.
- `backend/test/`: Node test runner suites (`*.test.js`).
- `backend/scripts/`: migrations, environment checks, Drive checks, and QA tools.
- `docs/` and `qa-report/`: architecture, operations, release evidence, and
  production runbooks.

## Build, Test, and Development Commands

Use npm with the committed lockfiles and Node `>=20.18 <21`.

```bash
npm run dev              # start backend and Vite together
npm run lint             # lint backend, frontend, tests, and scripts
npm test                 # run all backend Node tests
npm run build:release    # build frontend and scan artifacts
npm run env:check        # validate current environment
npm run drive:check      # read-only Drive credential/root check
```

Run `npm run check` before opening a PR. Migrations default to dry-run. Never set
`MIGRATION_CONFIRM` without a reviewed backup and change window.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and existing double-quote
style. React components use `PascalCase`; functions, variables, and route helpers
use `camelCase`; Mongoose model files use `PascalCase`. Keep API system keys in
English and user-facing copy bilingual where the surrounding UI supports it.
Prefer small services over adding more logic to route files. ESLint is the source
of truth; do not disable rules globally.

## Testing Guidelines

Use `node:test` and name suites `backend/test/<area>.test.js`. Add regression
coverage for authorization, idempotency, credit/quota changes, download ownership,
workers, and migrations. Tests must use memory fixtures or mocks, never real
payments or production databases.

## Commit & Pull Request Guidelines

History uses concise imperative subjects, for example
`Fix marketplace download ownership`. Prefer scoped Conventional Commit messages
for new work, such as `fix(auth): revoke sessions on logout`. PRs should include
the problem, risk, test commands/results, migration or env changes, and screenshots
for UI changes. Link the issue and call out manual staging checks.

## Security & Configuration

Never commit `.env`, tokens, Drive links, dumps, cookies, or private keys. Start
from the production examples, keep `ALLOW_DEV_LOGIN=false` in production, and
require `NODE_ENV=production npm run env:check` to pass before deployment.
