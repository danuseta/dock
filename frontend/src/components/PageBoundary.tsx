import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card, Page } from './ui';

/** A page whose code is loaded on first visit could not be fetched: DOCK was unreachable or a deploy replaced the files. */
const isLoadFailure = (error: Error | null) => Boolean(error && /dynamically imported module|Loading chunk|Failed to fetch|Importing a module script failed/i.test(error.message));

/**
 * Catches a page that could not be shown: its code could not be fetched (DOCK unreachable, or a deploy replaced the files
 * the running app points at), or the page itself hit an error. The message says which, with the error text, and the
 * error goes to the console. Give it a `key` that changes with the route so moving to another page clears the message.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean; error: Error | null }> {
  state: { failed: boolean; error: Error | null } = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const loadFailure = isLoadFailure(this.state.error);
    return (
      <Page width="medium">
        <Card className="py-10 text-center" role="alert">
          <h2 className="text-balance font-display text-xl font-bold">This page could not be loaded</h2>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-muted-foreground">
            {loadFailure
              ? 'It is not saved on this device yet, or DOCK was updated since this app was opened. Reload once DOCK can be reached.'
              : 'The page hit an error. Reload it; if it happens again, report it with the error below.'}
          </p>
          {this.state.error && <p className="mx-auto mt-2 max-w-xl break-words font-mono text-xs text-muted-foreground">{this.state.error.message}</p>}
          <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>Reload</Button>
        </Card>
      </Page>
    );
  }
}
