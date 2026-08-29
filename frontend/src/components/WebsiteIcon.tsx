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
      className="size-6 rounded-[5px] object-contain"
      src={source}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
