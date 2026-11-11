# User test protocol

Goal: show that a person can find a drone model's single-country dependencies and open the source behind each one in under 2 minutes, and compare that with the manual baseline.

## What this measures, and what it does not

- It measures the time to **use the finished map**. It does not include the research time to build the map (Role 1's pipeline), which the brief's one-hour target also covers. Report the two separately.
- The manual baseline (2 to 3 weeks per model) is **unverified**. Do not state a percentage improvement. State the measured time and the unverified baseline side by side.
- Run the timed test only on **real data** (`data/links.json` from the research role). A run on the fake dataset is a dry run of this script, not a result.

## Setup

- 3 to 5 participants. Prefer people who read supply-chain or procurement material; note each person's background.
- One laptop, the interface open on the model under test, brief panel visible, no hints given.
- A stopwatch and the answer key: the list of red components for that model, taken from `get_model_risk` before the session.
- Do not demo the tool. Read the task aloud and start the timer on "go".

## Tasks

**Task 1 (timed): find the dependencies and the sources.**
"For this drone, find every component that depends on a single country, and open the source behind each one."
- Stop the timer when the participant says they are done.
- Pass when the list matches the answer key **and** a source link was opened for every red component, in under 120 seconds.

**Task 2 (comprehension, untimed):**
- "Is the flight controller chip a safe supplier choice?" Pass: says it is unknown or unmapped, not safe.
- "Which battery cell sources disagree?" Pass: names both suppliers.
- "Which source would you trust least here?" Pass: picks a component labelled Low confidence, and says why.

**Task 3 (timed, short): cut-off.**
"If China were cut off, which components of this drone are affected?" Pass: matches the answer key from `simulate_cutoff('CN')`.

## Baseline question

At the end, ask: "How long would this take you without the tool, and how would you do it?" Record the estimate and the method, in their words. This is anecdotal support for the baseline, not proof.

## What to record per participant

| Field | Notes |
|---|---|
| Background | Role, years in procurement or supply chain |
| Task 1 time (s) | From "go" to "done" |
| Task 1 list correct? | Against the answer key |
| Sources opened | Count, and how many red components had one opened |
| Task 2 pass (3 items) | Which were missed |
| Task 3 time (s) and correct? | |
| Where they hesitated | What they said or looked for |
| Wrong readings | e.g. read grey as safe, missed a conflict |
| Own baseline estimate | Time and method |

## Reporting

In `user-test-results.md`: each participant's row, the median and range for Task 1, how many finished under 120 seconds with a correct list, every wrong reading of an error state, and the unverified baseline note. Any bug or confusing label found becomes a fix in the interface. Any missing or weak data goes in the gap report to Role 1.
