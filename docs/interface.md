# Interface

The interface lives in `web/`: Vite, React and TypeScript, built to `web/dist/` and served by the Risk API at http://localhost:3001. Role 3 owns it. This page is moved here from the old README; the only change is the Playwright install command, which now names the browser the tests actually need.

Everything on the page comes from the Risk API; the page computes no risk of its own.

## Views

The page opens on the **Graph** tab. **Chains and list** is the other: one model's tiers drawn left to right, then every component as a row with its sources. Both read the same API data, and the summary, cut-off and brief above them are shared.

### Graph

A force-directed network of every model, in the manner of Obsidian's graph. Built with `react-force-graph` (d3-force layout; canvas for 2D, Three.js for 3D). `web/src/lib/graph.ts` builds the nodes and links from the API data and is covered by unit tests.

- **Nodes:** a drone model is a hub, a component a ring, a supplier a dot, a country a square, and an unmapped tier a dashed ring. A supplier shared by several models is one node, so models are joined through it. Size follows how connected a node is.
- **Colour:** red marks only the path from a model to a single-country dependency, and the country itself. Amber rings mark low confidence or disagreeing sources. Shape, not colour, says what a node is.
- **Navigate:** drag to pan, scroll to zoom, hover a node to light up its neighbours, drag a node to move it. Fit, zoom buttons and a search box (any supplier, component or country) are in the panel. Clicking a node opens its sources; a component opens the same chain as the list. A country offers "What if it is cut off?".
- **Cut-off:** with the toggle on, rings mark what depends on the country (red) and what cannot be told (grey).
- **2D / 3D:** 2D is the default. 3D loads only when selected.
- **Without a mouse:** the stage is a canvas, so the search box and the Chains and list tab are the keyboard route to every component.

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
