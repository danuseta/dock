import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { GET_TICKET_CHANGES } from '../graphql/queries';
import { repoName } from '../changes/href';
import type { PullPatch } from './acSnippet';

interface ChangesData { ticketChanges?: { pulls?: Array<{ repo: string; tab: string; files: Array<{ path: string; patch: string | null }> | null }> } | null }

/** The changed files of the ticket's pull requests, through the same read query and cache as Perubahan kode; null until loaded. */
export function usePullPatches(ticketKey: string | null, repos: string[], enabled: boolean): PullPatch[] | null {
  const client = useApolloClient();
  const [files, setFiles] = useState<PullPatch[] | null>(null);
  const wanted = repos.join('|');
  useEffect(() => {
    setFiles(null);
    if (!ticketKey || !enabled) return undefined;
    let gone = false;
    const tabs: Array<string | null> = wanted ? wanted.split('|') : [null];
    Promise.all(tabs.map((tab) => client.query<ChangesData>({ query: GET_TICKET_CHANGES, variables: { ticketKey, tab }, fetchPolicy: 'cache-first' })
      .then(({ data }) => {
        const pull = data?.ticketChanges?.pulls?.find((item) => item.files);
        return pull?.files ? pull.files.map((file) => ({ repo: repoName(pull.repo), path: file.path, patch: file.patch })) : [];
      }, () => [] as PullPatch[])))
      .then((found) => { if (!gone) setFiles(found.flat()); });
    return () => { gone = true; };
  }, [client, ticketKey, wanted, enabled]);
  return files;
}
