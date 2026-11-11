# Riskiest bet test

Can public sources map a drone's sub-tier suppliers? See [the brief](../docs/brief.md#riskiest-bet).

Pass: at least 4 of 6 rows show a supplier and country backed by the source, with no more than 1 invented or unsupported claim.

Drone model: **Skydio X10**. Run on 2026-11-11 by the Role 1 pipeline (`python -m pipeline.run --models "Skydio X10"`). It made 111 deepseek-v4.1-flash calls and cost $0.14. The full trail is in [raw/skydio-x10/](raw/skydio-x10/).

How each row was checked: a research agent found the source. A verifier agent opened the page and gave a verdict. Code confirmed that the verifier's quoted sentence is really on the page and names the supplier. Then the quotes below were read by hand against the claim.

| Component | Supplier | Country | Source link | Source supports it? |
|---|---|---|---|---|
| Motors (tier 1) | Nidec Corporation | JP (HQ) | [Nidec press release](https://www.nidec.com/v=1777635136/files/topics/33851_ext_3_en_0.pdf) | **yes**: "Skydio X10 … uses Nidec motors in propulsion motors". The country is not on the page. |
| Magnets (tier 2) | not found | | | **unmapped**: no teardown, filing or trade record names the motor magnets |
| Battery cells (tier 1) | Dongguan Poweramp (TDK subsidiary) | CN (made) | [crucibeljournal.com](https://crucibeljournal.com/the-battery-wars/) | **yes, but stale and not X10-specific**. The same article says China ordered Poweramp to cut ties with Skydio, so it is the *former* supplier. |
| Flight controller chip (tier 1) | NVIDIA (Jetson Orin) | US (HQ) | [skydio.com/x10](https://www.skydio.com/x10) | **yes**: "Backed by an onboard NVIDIA Jetson Orin GPU". The tier-2 foundry (Samsung 8nm) was rejected: sources cover Orin in general, not this drone. |
| Camera sensor (tier 1) | Sony (IMX989 / IMX686), Samsung (nav cameras), Teledyne FLIR (thermal) | JP / KR / US (HQ) | [X10 datasheet](https://thecyberhawk.com/uploads/resource/file/Skydio-X10_Data-Sheet_Print_10_09_2023-1.pdf), [X10 specs](https://www.skydio.com/x10/technical-specs) | **yes**: the datasheet lists "Sony IMX989, 1", 50.3 MP, CMOS" |
| Radio (tier 1) | Skydio, Inc. (in-house SkydioLink module) | US (HQ) | [FCC ID 2ATQRSMODBV3S](https://fccid.io/2ATQRSMODBV3S) | **yes**. The RF chipset inside (tier 2) was not found. |

Invented or unsupported claims that reached `links.json`: **0**. The verifier rejected 8 candidates, including 4 sub-tier guesses about foundries and fabs that did not mention Skydio.

## Result: **FAIL** on sub-tier, pass on tier 1

- **Sub-tier suppliers backed by a source: 0 of 6.** The brief's pass mark asks for sub-tier suppliers, and public sources gave none for the X10. Magnets, cell materials, chip and sensor fabs, and the radio chipset are all `unmapped`.
- **Tier-1 suppliers backed by a source: 5 of 5 tier-1 components**, with 0 invented. Every one is only `low` confidence: no page states where the part is made, so all countries come from HQ, apart from the battery article.
- **What this means:** AI research over public pages answers "who does the drone maker buy from" well and cheaply (about $0.02 per component). It does **not** answer "what is inside the part", which is the hidden single-country risk the brief cares about. As predicted, that sits in paid teardowns, customs and trade data, and supplier disclosures that are not on the open web.

## What to try next

1. Sub-tier sources for magnets, cells and fabs: customs and bill-of-lading data (e.g. ImportYeti), FCC internal photos (component markings), and paid teardown reports.
2. Ask the vendor. The product already shows "Ask the vendor" on unmapped components, and these results show that's where most of the value lies.
3. Run the other 3 models anyway. Tier-1 mapping plus honest unmapped gaps is still a usable demo, and the DJI model will show the contrast.
