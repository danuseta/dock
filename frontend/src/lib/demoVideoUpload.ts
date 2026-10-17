import { apiOrigin } from './apollo';
import type { DemoVideo } from './demoVideos';

/** Streams an MP4 to the workspace DOCK, which puts it in the bucket as <KEY>.mp4 and sets the ticket's demo link. */
export function uploadDemoVideo(ticketKey: string, file: File, onProgress: (fraction: number) => void): Promise<DemoVideo> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiOrigin}/api/demo-videos/${encodeURIComponent(ticketKey)}`);
    request.withCredentials = true;
    request.setRequestHeader('x-dock-upload', '1');
    request.setRequestHeader('content-type', 'video/mp4');
    request.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total); };
    request.onerror = () => reject(new Error('The upload could not reach DOCK'));
    request.onload = () => {
      let body: { result?: DemoVideo; error?: string } = {};
      try { body = JSON.parse(request.responseText); } catch { /* the status says enough */ }
      if (request.status >= 200 && request.status < 300 && body.result) resolve(body.result);
      else reject(new Error(body.error || `The upload was refused (${request.status})`));
    };
    request.send(file);
  });
}
