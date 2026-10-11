import { useEffect, useRef, useState } from 'react';

export function useThrottledText(text: string, ms: number): string {
  const [shown, setShown] = useState('');
  const shownRef = useRef('');
  const shownAt = useRef(0);
  useEffect(() => {
    if (text === shownRef.current) return undefined;
    const timer = window.setTimeout(() => {
      shownRef.current = text;
      shownAt.current = Date.now();
      setShown(text);
    }, Math.max(0, shownAt.current + ms - Date.now()));
    return () => window.clearTimeout(timer);
  }, [text, ms]);
  return shown;
}
