import { describe, expect, it } from 'vitest';
import { isSafeUrl } from './safeUrl';

describe('isSafeUrl', () => {
  it('allows http and https', () => {
    expect(isSafeUrl('https://example.com/a')).toBe(true);
    expect(isSafeUrl('http://example.com/a')).toBe(true);
  });

  it('rejects script, data and empty values', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', '', '#', '//evil.com']) {
      expect(isSafeUrl(bad), bad).toBe(false);
    }
  });
});
