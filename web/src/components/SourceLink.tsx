import { isSafeUrl } from '../lib/safeUrl';

export function SourceLink({ url, children }: { url: string; children?: React.ReactNode }) {
  if (!isSafeUrl(url)) {
    return <span className="source-missing">No usable source link</span>;
  }
  return (
    <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">
      {children ?? 'Source'}<span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}
