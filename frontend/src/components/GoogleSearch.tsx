import { CornerDownLeft, Search } from 'lucide-react';
import { Input } from './ui';

export function GoogleSearch() {
  return (
    <form action="https://www.google.com/search" method="get" role="search" className="mb-6">
      <label className="sr-only" htmlFor="home-google-search">Search Google</label>
      <div className="group relative flex items-center rounded-md border border-border bg-surface-0 shadow-card transition-colors focus-within:border-border-accent focus-within:ring-2 focus-within:ring-accent/25">
        <Search className="pointer-events-none absolute left-4 text-accent" size={18} aria-hidden="true" />
        <Input
          id="home-google-search"
          name="q"
          type="search"
          autoFocus
          autoComplete="off"
          required
          enterKeyHint="search"
          placeholder="Search Google..."
          className="h-12 border-0 bg-transparent pr-24 pl-12 font-mono text-[0.82rem] shadow-none focus-visible:border-transparent focus-visible:ring-0"
        />
        <span className="pointer-events-none absolute right-3 inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 py-1 font-mono text-[0.62rem] text-muted-foreground" aria-hidden="true">
          <CornerDownLeft size={11} /> Enter
        </span>
      </div>
    </form>
  );
}
