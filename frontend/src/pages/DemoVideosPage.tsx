import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Copy, RefreshCw, Trash2, Upload, Video } from 'lucide-react';
import { GET_DEMO_VIDEOS } from '../graphql/queries';
import { DELETE_DEMO_VIDEO } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Card, IconButton, Input, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { formatSize, type DemoVideo } from '../lib/demoVideos';
import { uploadDemoVideo } from '../lib/demoVideoUpload';

const DemoVideosPage = ({ onTicketClick }: { onTicketClick: (key: string) => void }) => {
  const { data, loading, error, refetch } = useQuery(GET_DEMO_VIDEOS, CACHED_QUERY_OPTIONS);
  const [deleteVideo] = useMutation(DELETE_DEMO_VIDEO);
  const [ticketKey, setTicketKey] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const configured: boolean = data?.demoVideos?.configured ?? false;
  const videos: DemoVideo[] = data?.demoVideos?.videos || [];

  const upload = async (key: string, chosen: File) => {
    setNotice(null);
    setProgress(0);
    try {
      const video = await uploadDemoVideo(key.trim().toUpperCase(), chosen, setProgress);
      setNotice({ text: `${video.ticketKey} uploaded. Its ticket now links ${video.url}`, error: false });
      setTicketKey('');
      setFile(null);
      await refetch();
    } catch (uploadError: any) {
      setNotice({ text: uploadError.message || 'The upload failed', error: true });
    } finally {
      setProgress(null);
    }
  };

  const remove = async (key: string) => {
    setNotice(null);
    try {
      await deleteVideo({ variables: { ticketKey: key } });
      if (preview?.includes(key)) setPreview(null);
      await refetch();
    } catch (removeError: any) {
      setNotice({ text: removeError.message || 'The video could not be removed', error: true });
    }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setNotice({ text: 'Link copied', error: false }); } catch { setNotice({ text: 'Copy failed. Select the link and copy it by hand.', error: true }); }
  };

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Demo videos</h1><p className="mt-1 text-pretty text-secondary-foreground">One video per ticket in the bucket folder demo-qonflo. Its link shows on the ticket page of both DOCKs and goes into the Discord broadcast.</p></div>
        <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {!configured && <Card className="mb-4 text-pretty text-sm text-secondary-foreground" role="status">Demo storage is not configured yet. Set DEMO_S3_ACCESS_KEY and DEMO_S3_SECRET_KEY for the workspace DOCK, then restart it.</Card>}
      {notice && <Card className={cn('mb-4 text-pretty text-sm', notice.error ? 'border-status-conflict text-status-conflict' : 'text-status-merged')} role={notice.error ? 'alert' : 'status'}>{notice.text}</Card>}

      <Card className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Upload size={18} aria-hidden="true" />Upload</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (file) void upload(ticketKey, file); }}>
          <label className="min-w-[140px]"><span className="mb-1 block text-sm font-medium">Ticket</span><Input value={ticketKey} onChange={(event) => setTicketKey(event.target.value)} placeholder="QRD-1363" pattern="[A-Za-z][A-Za-z0-9]*-[0-9]+" required /></label>
          <label className="min-w-[240px] flex-1"><span className="mb-1 block text-sm font-medium">MP4 file</span><Input type="file" accept="video/mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
          <Button type="submit" variant="primary" disabled={!configured || !file || !ticketKey.trim() || progress !== null}>{progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Upload'}</Button>
        </form>
        <p className="mt-2 text-pretty text-xs text-muted-foreground">Uploading for a ticket that already has a video replaces it; the link stays the same.</p>
      </Card>

      {preview && <Card className="mb-6 p-0"><video className="w-full rounded-sm" src={preview} controls preload="metadata" /></Card>}

      <Card className="overflow-hidden p-0">
        {videos.length === 0 ? <div className="py-12 text-center"><Video className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">No demo video yet.</p></div> : (
          <ul className="flex flex-col">
            {videos.map((video) => (
              <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0" key={video.ticketKey}>
                <span className="min-w-0">
                  <button type="button" className="border-0 bg-transparent p-0 font-mono text-sm font-extrabold text-accent hover:underline" onClick={() => onTicketClick(video.ticketKey)}>{video.ticketKey}</button>
                  <small className="block truncate font-mono text-[0.68rem] text-muted-foreground">{formatSize(video.size)}{video.updatedAt ? ` · ${new Date(video.updatedAt).toLocaleString('en-GB')}` : ''} · {video.url}</small>
                </span>
                <span className="flex items-center gap-1">
                  <IconButton variant="ghost" aria-label={`Play ${video.ticketKey}`} title="Play" onClick={() => setPreview(video.url)}><Video size={15} aria-hidden="true" /></IconButton>
                  <IconButton variant="ghost" aria-label={`Copy the link of ${video.ticketKey}`} title="Copy link" onClick={() => void copy(video.url)}><Copy size={15} aria-hidden="true" /></IconButton>
                  <label className="cursor-pointer" title="Replace"><span className="sr-only">Replace the video of {video.ticketKey}</span><input type="file" accept="video/mp4" className="sr-only" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) void upload(video.ticketKey, chosen); }} /><Upload size={15} className="m-2 text-secondary-foreground" aria-hidden="true" /></label>
                  <IconButton variant="ghost" className="text-status-conflict" aria-label={`Delete the video of ${video.ticketKey}`} title="Delete" onClick={() => void remove(video.ticketKey)}><Trash2 size={15} aria-hidden="true" /></IconButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};

export default DemoVideosPage;
