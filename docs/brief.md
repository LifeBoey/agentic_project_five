# Drone dependency map: product brief
In one line: Shows a procurement officer where a drone model depends on a single country, before a disruption does.

## Problem
Procurement officers cannot see a drone's dependencies beyond the first-tier supplier. Sub-tier data is scattered across public sources and no team maps it, so hand mapping takes weeks. Diversification decisions therefore miss hidden single-country risks, and the next export control arrives as a surprise.

## Evidence
- Industry reporting says drone makers buy motors, batteries and electronics domestically while the magnets and battery materials inside come from China.
- You said vendors disclose only direct suppliers, with sub-tier detail in teardowns, trade data and news.
- Not checked yet: the 2 to 3 weeks per model baseline.

## Success
- Metric: Hours to identify a drone model's single-country dependencies.
- Today: About 2 to 3 weeks per model by hand, unverified.
- Target: Under 1 hour per model. Date: not set.
- Must not get worse: At least 80% of flagged dependencies backed by a verifiable source.

## Riskiest bet
Public sources hold enough reliable sub-tier supplier information for AI research to map a drone's dependencies accurately.
- Test: Pick one drone model and ask an AI chat assistant for six key components (motors, magnets, battery cells, flight controller, camera sensor), each with supplier, country and source link. Open every link and check it supports the claim.
- Pass mark: At least 4 of 6 components have a sub-tier supplier and country backed by a checkable source, with no more than 1 invented or unsupported claim.
- Result: not run yet

## First version
1. As a procurement officer, I see supplier, country and source link for each component of one drone model. Done when every component shows a cited source or a grey "Unmapped" label.
2. As a procurement officer, I open any source link and judge it. Done when weak links are marked "Low confidence" and disagreeing sources sit side by side.
3. As a procurement officer, I see which components depend on a single country. Done when those are counted at the top and in red.

## Walkthrough
1. Picks a drone model.
2. Sees a risk summary ("3 components depend on a single country"), with those in red.
3. Taps a red component to follow its chain to the country, source link at each step.
4. Toggles "What if China is cut off?" to see affected components and models.

If it goes wrong: unmapped components show grey as "Unmapped: no reliable source found", never as safe, with a prompt to ask the vendor. Weak links read "Low confidence"; conflicting sources sit side by side.

## Not building
- More than one drone model at the start.
- Plain-English questions over the map.
- Guesses where no source exists.

## Open questions
- When does the one hour target need to be reached?
- Which model will you test first?
- Who owns keeping the map current?
