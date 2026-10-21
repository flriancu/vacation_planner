# Vacation planner

A small web app for planning time off in Romania. It shows the year as one continuous calendar of weeks, marks weekends, public holidays and employer days off, suggests bridges ("1 leave day → 5 days off"), and tracks leave against yearly budgets.

- **Live demo:** https://flriancu.github.io/vacation_planner/ (in-memory: changes are not saved yet)
- **What it should do:** [REQUIREMENTS.md](REQUIREMENTS.md)
- **How it's built:** [DESIGN.md](DESIGN.md)

Planned storage is the user's own Google Drive; the app has no server. This repo contains no personal data: tests use a made-up plan.

## Develop

Node 24.

```sh
npm install
npm run dev        # http://localhost:5173/vacation_planner/
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright; first run: npx playwright install chromium)
npm run lint       # oxlint
npm run format     # Prettier
npm run build      # type-check + production build into dist/
```

Every push to `main` runs all checks and deploys to GitHub Pages.
