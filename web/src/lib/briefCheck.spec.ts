import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getChain, getModelRisk, parseLinks, simulateCutoff } from '../../../src/risk.js';
import type { Chain, Cutoff, ModelRisk } from '../api';
import { buildFacts, checkBrief, type BriefFacts } from './briefCheck';

const links = parseLinks(JSON.parse(readFileSync(new URL('../../tests/fixtures/links.json', import.meta.url), 'utf8')));

function factsFor(model: string): BriefFacts {
  const risk = getModelRisk(links, model) as ModelRisk;
  const chains = risk.components.map(c => getChain(links, model, c) as Chain);
  return buildFacts(risk, chains, [simulateCutoff(links, 'CN') as Cutoff]);
}

const GOOD = 'Falcon X has 2 components that depend on a single country: motors, where the tier 2 magnet supplier is in China, and radio, in the United States at tier 1. '
  + 'The camera sensor is unmapped and the radio is partly unmapped at tier 2, so neither is shown as safe. '
  + 'Battery cells have conflicting sources. A China cut-off would affect 2 components, 1 of them fully blocked, and leaves 2 unknown.';

describe('buildFacts', () => {
  const f = factsFor('Falcon X');

  it('classifies unmapped, partly unmapped and mapped components', () => {
    const status = Object.fromEntries(f.components.map(c => [c.name, c.status]));
    expect(status).toEqual({
      motors: 'mapped', 'battery cells': 'mapped', 'camera sensor': 'unmapped',
      'flight controller chip': 'mapped', radio: 'partly_unmapped',
    });
  });

  it('keeps this model\'s cut-off lists only', () => {
    expect(f.cutoffs).toEqual([{ country: 'CN', affected: ['motors', 'battery cells'], fully_blocked: ['motors'], unknown: ['camera sensor', 'radio'] }]);
  });

  it('lists suppliers shared with other models', () => {
    expect(f.shared_suppliers.map(s => s.supplier).sort()).toEqual(['AeroMotor Inc', 'ChipFab', 'NdMag Ltd', 'RadioWorks']);
  });
});

describe('checkBrief', () => {
  it('accepts a faithful paragraph', () => {
    expect(checkBrief(GOOD, factsFor('Falcon X'))).toEqual([]);
  });

  it('rejects a number that is not in the data', () => {
    expect(checkBrief(GOOD.replace('2 components that', '7 components that'), factsFor('Falcon X')))
      .toEqual(['number 7 does not appear in the data']);
  });

  it('does not read digits in model names as claims', () => {
    const f = factsFor('Hawk 2');
    const text = 'Hawk 2 has 3 components that depend on a single country, including motors with low confidence evidence. '
      + 'Battery cells and camera sensor are not researched, so they are not shown as safe.';
    expect(checkBrief(text, f)).toEqual([]);
  });

  it('requires naming components that have no record at all', () => {
    const f = factsFor('Hawk 2');
    expect(f.components.filter(c => c.status === 'not_researched').map(c => c.name)).toEqual(['battery cells', 'camera sensor']);
    const text = 'Hawk 2 has 3 components that depend on a single country, including motors with low confidence evidence.';
    expect(checkBrief(text, f)).toEqual([
      'unmapped component "battery cells" is not mentioned',
      'unmapped component "camera sensor" is not mentioned',
      'unmapped components are not described as unmapped',
    ]);
  });

  it('rejects a brief that leaves out an unmapped or partly unmapped component', () => {
    const f = factsFor('Falcon X');
    const without = GOOD.replace('The camera sensor is unmapped and the radio is partly unmapped at tier 2, so neither is shown as safe. ', '');
    expect(checkBrief(without, f)).toEqual([
      'unmapped component "camera sensor" is not mentioned',
      'unmapped components are not described as unmapped',
    ]);
  });

  it('rejects internal labels in the prose', () => {
    const leaky = GOOD.replace('is partly unmapped at tier 2', 'is partly_unmapped at tier 2');
    expect(checkBrief(leaky, factsFor('Falcon X'))).toEqual(['uses an internal label instead of plain words']);
  });

  it('rejects naming a gap without saying it is unmapped', () => {
    const vague = GOOD.replace('The camera sensor is unmapped and the radio is partly unmapped at tier 2, so neither is shown as safe. ', 'The camera sensor is worth a look. ');
    expect(checkBrief(vague, factsFor('Falcon X'))).toEqual(['unmapped components are not described as unmapped']);
  });

  it('rejects a brief that ignores conflicts', () => {
    expect(checkBrief(GOOD.replace('Battery cells have conflicting sources. ', ''), factsFor('Falcon X')))
      .toEqual(['conflicting sources exist but are not mentioned']);
  });

  it('rejects lists, headings and long text', () => {
    const f = factsFor('Falcon X');
    expect(checkBrief(`${GOOD}\n\nSecond paragraph.`, f)).toContain('must be one plain paragraph');
    expect(checkBrief(`- ${GOOD}`, f)).toContain('must be one plain paragraph');
    expect(checkBrief(`${GOOD} ${'word '.repeat(170)}`, f)).toContain('longer than 160 words');
  });
});
