import { useEffect, useState } from 'react';
import { briefSlug } from '../lib/briefSlug';

async function loadBrief(model: string): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}briefs/${briefSlug(model)}.md`);
  const text = await res.text();
  // The dev server answers unknown paths with index.html, so check the content as well as the status.
  return res.ok && !text.trimStart().startsWith('<') ? text.trim() : null;
}

export function RiskBrief({ model }: { model: string }) {
  const [brief, setBrief] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;
    setBrief(undefined);
    setCopied(false);
    loadBrief(model).then(b => current && setBrief(b), () => current && setBrief(null));
    return () => { current = false; };
  }, [model]);

  function download() {
    const url = URL.createObjectURL(new Blob([`# ${model}: risk brief\n\n${brief}\n`], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${briefSlug(model)}-risk-brief.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(brief ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label="Risk brief" className="brief">
      <h3>Risk brief</h3>
      {brief === undefined && <p className="note">Loading brief…</p>}
      {brief === null && <p className="note">No brief has been drafted for this model yet.</p>}
      {brief && (
        <>
          <p data-testid="brief-text">{brief}</p>
          <div className="actions">
            <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" onClick={download}>Download .md</button>
          </div>
        </>
      )}
    </section>
  );
}
