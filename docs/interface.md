# Interface

The interface lives in `web/`: Vite, React and TypeScript, built to `web/dist/` and served by the Risk API at http://localhost:3001. Role 3 owns it. This page is moved here from the old README; the only change is the Playwright install command, which now names the browser the tests actually need.

Everything on the page comes from the Risk API; the page computes no risk of its own.

## What each state means

- **Not researched**: an expected component (`web/src/lib/expected.ts`: motors, battery cells, flight controller chip, camera sensor, radio) that a model has no record for at all. It is shown grey, counted, never safe, and unknown in a cut-off, so it cannot silently disappear. **The expected list is provisional and still to be agreed.** `data-drop` reports the same gaps for the research role.
- **Unmapped** (`status: "unknown"`): a grey row, counted in the summary, no source, never shown as safe.
- **Partly unmapped** (`status: "mapped"` with an `unmapped` tier below the known ones): the known tiers and sources show, and the missing tier is a grey card.
- **Low confidence**: labelled on the row and on the weak source, with the source link visible.
- **Conflict**: the disagreeing suppliers sit side by side.
- **Cut-off**: `affected` and `fully_blocked` mark rows; `unknown` is listed separately as "not counted as unaffected".
- **Question box**: shows a loading state (3 to 10 seconds). "No mapped data to answer that." is shown as a normal answer. A 503 says the question box is not set up on the server.

## Checks

```bash
cd web
npm run typecheck
npm test                          # unit tests: view logic, brief checker, URL guard
npx playwright install chromium-headless-shell   # once
npm run test:e2e                  # browser tests on fixture data, answered by the real risk engine
E2E_API=real npm run test:e2e     # the data-agnostic tests against the real server and data/links.json
npm run data-drop                 # the real-API run plus a report in docs/test-reports/
```

`data-drop` writes two lists: UI failures, and data gaps (unmapped, partly unmapped, low confidence, conflicts, components not researched, or a `links.json` the API rejects) to hand to the research role. The real-API run makes one live `ask()` call.

## Risk briefs

With the API running and `.env` filled in, `cd web && npm run briefs` drafts one paragraph per model from the API output into `web/public/briefs/` (gitignored, so each machine generates its own). Each draft is checked: every number must come from the API output, every unmapped or partly unmapped component must be named and described as unmapped, and conflicts must be mentioned. A draft that fails twice is not written, and the interface says no brief has been drafted for that model.

The checker tests numbers and names, not meaning, so read the briefs before presenting them. **Regenerate them after every data drop**: a brief is a snapshot and does not update itself.
