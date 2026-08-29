import { useEffect, useMemo, useState } from 'react';
import { getWebsiteIconSources } from '../lib/websiteIcon';

interface WebsiteIconProps {
  title: string;
  url: string;
}

export function WebsiteIcon({ title, url }: WebsiteIconProps) {
  const sources = useMemo(() => getWebsiteIconSources(url), [url]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => setSourceIndex(0), [url]);

  const source = sources[sourceIndex];
  if (!source) {
    return <span className="font-display text-sm font-extrabold uppercase text-muted-foreground" aria-hidden="true">{title.trim().charAt(0) || '?'}</span>;
  }

  return (
    <img
      className="size-7 rounded-[6px] object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      src={source}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
