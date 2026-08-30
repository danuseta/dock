import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Chrome,
  Container,
  Figma,
  Github,
  Gitlab,
  Globe2,
  MessageCircle,
  Package,
  Server,
  Slack,
  Trello,
  type LucideIcon,
} from 'lucide-react';
import { getWebsiteIconKind, getWebsiteIconSources, type WebsiteIconKind } from '../lib/websiteIcon';

interface WebsiteIconProps {
  title: string;
  url: string;
}

const LOCAL_ICON_MARKS: Record<Exclude<WebsiteIconKind, 'jira'>, { icon: LucideIcon; className: string }> = {
  calendar: { icon: CalendarDays, className: 'text-[#4285f4]' },
  discord: { icon: MessageCircle, className: 'text-[#5865f2]' },
  docker: { icon: Container, className: 'text-[#2496ed]' },
  figma: { icon: Figma, className: 'text-[#f24e1e]' },
  github: { icon: Github, className: 'text-foreground' },
  gitlab: { icon: Gitlab, className: 'text-[#fc6d26]' },
  google: { icon: Chrome, className: 'text-[#4285f4]' },
  npm: { icon: Package, className: 'text-[#cb3837]' },
  server: { icon: Server, className: 'text-status-merged' },
  slack: { icon: Slack, className: 'text-[#36c5f0]' },
  trello: { icon: Trello, className: 'text-[#0c66e4]' },
};

function JiraMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fill="#1868DB" d="M12.02 2.15a.8.8 0 0 0-1.36.57c0 3.24-2.63 5.87-5.87 5.87a.8.8 0 0 0-.56 1.37l8.82 8.82a.8.8 0 0 0 1.37-.56c0-3.24 2.63-5.87 5.87-5.87a.8.8 0 0 0 .56-1.37l-8.83-8.83Z" />
      <path fill="#0C66E4" d="M8.64 8.18a.8.8 0 0 0-1.36.57c0 2.55-2.07 4.62-4.62 4.62a.8.8 0 0 0-.56 1.37l6.93 6.93a.8.8 0 0 0 1.37-.56c0-2.55 2.07-4.62 4.62-4.62a.8.8 0 0 0 .56-1.37L8.64 8.18Z" />
    </svg>
  );
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
  const localIconKind = useMemo(() => getWebsiteIconKind(url, title), [title, url]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => setSourceIndex(0), [url]);

  if (localIconKind) {
    if (localIconKind === 'jira') {
      return (
        <span className="grid size-7 place-items-center rounded-[6px] bg-[#0C66E4]/10" aria-hidden="true">
          <JiraMark className="size-6" />
        </span>
      );
    }

    const { icon: LocalIcon, className } = LOCAL_ICON_MARKS[localIconKind];
    return (
      <span className="grid size-7 place-items-center rounded-[6px] bg-surface-2" aria-hidden="true">
        <LocalIcon className={`size-5 ${className}`} strokeWidth={1.8} />
      </span>
    );
  }

  const source = sources[sourceIndex];
  if (!source) {
    return <FallbackMark title={title} url={url} />;
  }

  const isVectorSource = source.endsWith('.svg');

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
      onLoad={(event) => {
        if (!isVectorSource && (event.currentTarget.naturalWidth < 48 || event.currentTarget.naturalHeight < 48)) {
          setSourceIndex((current) => current + 1);
        }
      }}
    />
  );
}
