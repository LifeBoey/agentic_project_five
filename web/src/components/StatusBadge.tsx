export type BadgeKind =
  | 'single' | 'unmapped' | 'not-researched' | 'partly' | 'low' | 'conflict' | 'supplier'
  | 'affected' | 'blocked' | 'cutoff-unknown';

const BADGES: Record<BadgeKind, { glyph: string; label: string }> = {
  single: { glyph: '▲', label: 'Single country' },
  unmapped: { glyph: '?', label: 'Unmapped' },
  'not-researched': { glyph: '?', label: 'Not researched' },
  partly: { glyph: '?', label: 'Partly unmapped' },
  low: { glyph: '!', label: 'Low confidence' },
  conflict: { glyph: '≠', label: 'Sources disagree' },
  supplier: { glyph: '1', label: 'Single supplier' },
  affected: { glyph: '✕', label: 'Affected by cut-off' },
  blocked: { glyph: '✕', label: 'Fully blocked' },
  'cutoff-unknown': { glyph: '?', label: 'Unknown if affected' },
};

/** Status is always text plus a glyph, never colour alone. */
export function StatusBadge({ kind, detail }: { kind: BadgeKind; detail?: string }) {
  const { glyph, label } = BADGES[kind];
  return (
    <span className={`badge badge-${kind}`}>
      <span aria-hidden="true">{glyph}</span> {label}{detail ? `: ${detail}` : ''}
    </span>
  );
}
