import { Component, type ReactNode } from 'react';
import { Button, Card, Page } from './ui';

/**
 * Catches a page that could not be shown. The usual cause is a page whose code is loaded on first visit being opened
 * for the first time while DOCK cannot be reached, or after a deploy replaced the files the running app points at.
 * Give it a `key` that changes with the route so moving to another page clears the message.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Page width="medium">
        <Card className="py-10 text-center" role="alert">
          <h2 className="text-balance font-display text-xl font-bold">This page could not be loaded</h2>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-muted-foreground">It is not saved on this device yet, or DOCK was updated since this app was opened. Reload once DOCK can be reached.</p>
          <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>Reload</Button>
        </Card>
      </Page>
    );
  }
}
