# Demo script (about 5 minutes)

Run on the real dataset. Before you start: `npm start` is running with `.env` filled in, the interface is open on the first model, and `npm run briefs` has been run on this data (briefs are snapshots).

## 1. The problem (30 s)
Say: "A procurement officer can see their drone's first-tier supplier, but not that the magnets inside the motor all come from one country. Mapping that by hand takes weeks per model, and we have not verified that figure."

## 2. Pick a model and read the risk (45 s)
- Open the model picker and choose a model.
- Point at the red headline: "N components depend on a single country."
- Point at the counts under it: unmapped, low confidence, conflicting. Say: "The count of unmapped parts is there so a lack of red is never read as safe."
- Read the risk brief aloud, then click Download .md to show it can be sent on.

## 3. Follow a red component to its source (60 s)
- Click a red component, for example Motors, where the tier 2 magnet supplier decides the verdict.
- In the chain panel, walk tier 1 to the last tier and read "Chain ends in: <country>".
- Click a source link and show the page it opens. Say: "Every claim has a link you can judge yourself."

## 4. The three error states (60 s)
- **Unmapped:** show a grey row. "No reliable source found. It is grey, counted, and never shown as safe. The prompt is to ask the vendor."
- **Low confidence:** show a labelled row with its source beside it. "The tool says when it is unsure, and shows why."
- **Conflict:** show a row with two suppliers side by side. "Two sources disagree, so we show both instead of picking one."

## 5. What if a country is cut off (45 s)
- Tick "What if China is cut off?".
- Show the affected rows marked on the current model and the list of affected models.
- Change the country to show it is not China-specific.

## 6. Ask a question (45 s)
- Ask: "Which models depend only on China for magnets?" Show the answer and the links it cites.
- Ask something the data cannot answer, for example "What is the weather in Paris?". Show that it refuses instead of guessing.

## 7. The result (30 s)
Read the numbers from `user-test-results.md`: median time on Task 1, how many finished under 2 minutes, and the unverified manual baseline next to it. Say plainly that the test covers using the map, not building it.

## If something breaks
- The question box fails or is slow: it needs the key and takes up to 10 seconds. If it shows "not set up", skip step 6 and say so.
- The page shows an error: the API rejects a `links.json` with a bad record and names it. Say so and show the message.
- A source link is dead: say so. It goes on the gap list for the research team.
