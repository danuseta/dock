import { useEffect, useMemo, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { getWebsiteIconSources } from '../lib/websiteIcon';

interface WebsiteIconProps {
  title: string;
  url: string;
}

const hashString = (value: string) => Array.from(value).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);

function FallbackMark({ title, url }: WebsiteIconProps) {
  const letter = title.trim().charAt(0).toUpperCase() || <Globe2 size={16} aria-hidden="true" />;
  const hue = hashString(`${title}:${url}`) % 360;

  return (
    <span
      className="grid size-7 place-items-center rounded-[6px] font-display text-xs font-extrabold"
      style={{ color: `hsl(${hue} 86% 74%)`, backgroundColor: `hsl(${hue} 42% 18%)` }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

export function WebsiteIcon({ title, url }: WebsiteIconProps) {
  const sources = useMemo(() => getWebsiteIconSources(url), [url]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => setSourceIndex(0), [url]);

  const source = sources[sourceIndex];
  if (!source) {
    return <FallbackMark title={title} url={url} />;
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
