import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const COPIED_MS = 1500;

export const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), COPIED_MS);
  };
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy';
  return (
    <button
      type="button"
      className="mt-0.5 inline-flex min-h-6 items-center gap-1 self-start rounded-xs px-1 font-mono text-[0.62rem] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-[900px]:min-h-11 max-[900px]:px-2"
      aria-label={state === 'idle' ? 'Copy message' : label}
      onClick={() => void copy()}
    >
      {state === 'copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {label}
    </button>
  );
};
