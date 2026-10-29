import React, { useId, useState } from 'react';
import { useApolloClient, useMutation, useQuery } from '@apollo/client';
import { ExternalLink, Send } from 'lucide-react';
import { GET_DOCK_BUILD, GET_DOCK_ISSUES, GET_DOCK_ISSUE_DRAFT_URL } from '../graphql/queries';
import { REPORT_DOCK_ISSUE } from '../graphql/mutations';
import { Button, Card, Dialog, Input, Textarea } from './ui';
import { Toast } from './Toast';
import { environmentPreview, imageLinksOf } from '../lib/dockIssues';
import { useDockMode } from '../lib/dockMode';

interface ReportDockIssueProps { open: boolean; onClose: () => void; onNavigate: (path: string) => void }

const FIELD = 'flex flex-col gap-1.5 text-xs font-semibold text-secondary-foreground';

/** The bug form: posts an issue to the DOCK repo, or opens GitHub's new-issue page filled in so a screenshot can be pasted. */
export const ReportDockIssue: React.FC<ReportDockIssueProps> = ({ open, onClose, onNavigate }) => {
  const id = useId();
  const client = useApolloClient();
  const mode = useDockMode();
  const { data } = useQuery(GET_DOCK_ISSUES, { variables: { filter: 'OPEN' }, skip: !open });
  const { data: build } = useQuery(GET_DOCK_BUILD, { skip: !open });
  const [post, { loading: posting }] = useMutation(REPORT_DOCK_ISSUE, { refetchQueries: ['GetDockIssues'] });
  const [title, setTitle] = useState('');
  const [happened, setHappened] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [images, setImages] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ number: number; url: string } | null>(null);
  const tokenMissing = Boolean(data?.dockIssues?.tokenMissing);
  const page = window.location.pathname;
  const ready = title.trim() !== '' && happened.trim() !== '';
  const variables = () => ({ title: title.trim(), happened: happened.trim(), steps: steps.trim() || null, expected: expected.trim() || null, imageLinks: imageLinksOf(images), page });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || posting || tokenMissing) return;
    setError(null);
    try {
      const result = await post({ variables: variables() });
      setPosted(result.data.reportDockIssue);
      setTitle(''); setHappened(''); setSteps(''); setExpected(''); setImages('');
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not post the issue.');
    }
  };

  const continueOnGitHub = async () => {
    if (!ready) return;
    setError(null);
    const tab = window.open('about:blank', '_blank');
    try {
      const result = await client.query({ query: GET_DOCK_ISSUE_DRAFT_URL, variables: variables(), fetchPolicy: 'no-cache' });
      if (!tab) throw new Error('The browser blocked the new tab.');
      tab.opener = null;
      tab.location.href = result.data.dockIssueDraftUrl;
    } catch (failure) {
      tab?.close();
      setError(failure instanceof Error ? failure.message : 'Could not open GitHub.');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} dismissible={!posting} labelledBy={`${id}-title`}>
        <Card className="max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto">
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5">
            <h2 id={`${id}-title`} className="font-display text-xl font-bold">Report a bug</h2>
            <label className={FIELD}>Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
            </label>
            <label className={FIELD}>What happened
              <Textarea value={happened} onChange={(event) => setHappened(event.target.value)} required />
            </label>
            <label className={FIELD}>Steps to reproduce
              <Textarea value={steps} onChange={(event) => setSteps(event.target.value)} />
            </label>
            <label className={FIELD}>Expected
              <Textarea value={expected} onChange={(event) => setExpected(event.target.value)} className="min-h-16" />
            </label>
            <label className={FIELD}>Image links (one URL per line)
              <Textarea value={images} onChange={(event) => setImages(event.target.value)} className="min-h-16 font-mono text-xs" placeholder="https://" />
            </label>
            <label className={FIELD}>Environment
              <Textarea readOnly value={environmentPreview(page, mode, build?.dockBuild ?? null)} className="min-h-16 font-mono text-xs text-muted-foreground" />
            </label>
            {tokenMissing && (
              <p className="text-xs text-status-warn" role="status">
                Add a GitHub token in Settings to post from DOCK.{' '}
                <button type="button" className="border-0 bg-transparent p-0 text-status-warn underline" onClick={() => { onClose(); onNavigate('/settings'); }}>Open Settings</button>
              </p>
            )}
            {error && <p className="text-xs text-status-conflict" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2 max-[760px]:sticky max-[760px]:bottom-0 max-[760px]:-mx-6 max-[760px]:-mb-6 max-[760px]:border-t max-[760px]:border-border max-[760px]:bg-surface-1 max-[760px]:px-6 max-[760px]:py-3">
              <Button onClick={onClose} disabled={posting}>Cancel</Button>
              <Button onClick={() => void continueOnGitHub()} disabled={!ready || posting}><ExternalLink size={14} aria-hidden="true" />Continue on GitHub</Button>
              <Button type="submit" variant="primary" disabled={!ready || posting || tokenMissing}><Send size={14} aria-hidden="true" />{posting ? 'Posting' : 'Post to GitHub'}</Button>
            </div>
            <p className="text-[0.7rem] text-muted-foreground max-[760px]:text-xs">Have a screenshot? Use Continue on GitHub - the form is filled in, just paste the image.</p>
          </form>
        </Card>
      </Dialog>
      {posted && <Toast message={`Posted #${posted.number}`} type="success" link={{ href: posted.url, label: 'Open' }} onClose={() => setPosted(null)} />}
    </>
  );
};
