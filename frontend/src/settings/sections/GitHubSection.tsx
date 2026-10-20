import { useEffect, useState } from 'react';
import { useLazyQuery, useMutation } from '@apollo/client';
import { Zap } from 'lucide-react';
import { GET_GITHUB_REPOS } from '../../graphql/queries';
import { VALIDATE_GITHUB } from '../../graphql/mutations';
import { Badge, Button, Checkbox, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { splitList, type SavedSettings, type SectionValues, type TestResult } from '../sections';
import { ConnectionStatus, SecretInput, SettingsCard, TestResultText } from '../SettingsParts';

interface GitHubRepo { id: string; fullName: string; description?: string | null; private?: boolean }

export const GitHubSection = ({ values, set, settings, test, onTested }: {
  values: SectionValues;
  set: (key: string, value: string) => void;
  settings: SavedSettings;
  test?: TestResult;
  onTested: (result: TestResult) => void;
}) => {
  const [validate, { loading: testing }] = useMutation(VALIDATE_GITHUB);
  const [loadRepos, { data, loading: loadingRepos }] = useLazyQuery(GET_GITHUB_REPOS, { fetchPolicy: 'network-only' });
  const [filter, setFilter] = useState('');
  const connected = Boolean(settings.hasGithubToken);
  const token = values.githubToken;
  const selected = splitList(values.githubRepos);
  const kept = splitList(settings.githubRepos || '');
  const repos: GitHubRepo[] = [...(data?.githubRepos ?? [])].sort((a: GitHubRepo, b: GitHubRepo) => Number(kept.includes(b.fullName)) - Number(kept.includes(a.fullName)));

  // A blank token makes the server list with the saved one.
  useEffect(() => {
    if (connected) void loadRepos();
  }, [connected, loadRepos]);

  useEffect(() => {
    if (token.length <= 15) return undefined;
    const timer = setTimeout(() => void loadRepos({ variables: { token } }), 600);
    return () => clearTimeout(timer);
  }, [token, loadRepos]);

  const handleTest = async () => {
    try {
      const result = (await validate({ variables: { token } })).data?.validateGitHub;
      onTested({ ok: Boolean(result?.success), message: result?.success && !token ? `${result.message} (saved token)` : result?.message ?? 'No answer' });
      if (result?.success) void loadRepos({ variables: { token } });
    } catch (error) {
      onTested({ ok: false, message: error instanceof Error ? error.message : 'GitHub test failed' });
    }
  };

  const toggle = (name: string) => set('githubRepos', (selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]).join(', '));
  const shown = repos.filter((repo) => repo.fullName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-5">
      {test && !test.ok
        ? <ConnectionStatus tone="bad" title="GitHub rejected the token" detail={test.message} />
        : connected
          ? <ConnectionStatus tone="ok" title="Connected" detail={`token saved · ${kept.length} repositories monitored`} />
          : <ConnectionStatus tone="off" title="Not connected" detail="Add a personal access token, then save" />}

      <SettingsCard title="Token" caption="Saved with the GitHub save bar.">
        <div className="flex flex-col gap-3">
          <SecretInput label="Personal access token" saved={connected} value={token} onChange={(value) => set('githubToken', value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" hint="Needs the repo and read:org scopes." />
          <div className="flex flex-wrap items-center gap-3"><Button onClick={handleTest} disabled={testing || (!connected && !token)}><Zap size={16} aria-hidden="true" />Test token</Button><TestResultText busy={testing} result={test} /></div>
        </div>
      </SettingsCard>

      <SettingsCard title="Monitored repositories" caption="The saved selection comes first." aside={<Badge>{selected.length} selected</Badge>}>
        {loadingRepos ? <p className="text-sm text-muted-foreground">Loading repositories…</p>
          : repos.length > 0 ? (
            <>
              <Input aria-label="Filter GitHub repositories" className="mb-2 font-mono text-xs" placeholder="Filter by repository or organization" value={filter} onChange={(event) => setFilter(event.target.value)} />
              <div className="flex max-h-[300px] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface-0 p-2">
                {shown.map((repo) => {
                  const on = selected.includes(repo.fullName);
                  return (
                    <label key={repo.id} className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-sm border px-2.5 py-1.5', on ? 'border-accent/40 bg-accent-dim' : 'border-transparent')}>
                      <span className="flex min-w-0 items-center gap-2"><Checkbox checked={on} onChange={() => toggle(repo.fullName)} /><span className={cn('truncate font-mono text-xs', on && 'text-accent')}>{repo.fullName}</span>{repo.private && <Badge>Private</Badge>}</span>
                      {repo.description && <span className="max-w-[200px] truncate text-xs text-muted-foreground max-[620px]:hidden">{repo.description}</span>}
                    </label>
                  );
                })}
                {shown.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No repository matches the filter.</p>}
              </div>
            </>
          ) : <p className="text-pretty text-sm text-muted-foreground">{connected || token ? 'No repositories found. Check the token scopes.' : 'Repositories load once a token is saved or typed.'}</p>}
        <details className="mt-3"><summary className="cursor-pointer font-mono text-xs text-muted-foreground">Advanced: type repositories by hand</summary><Input aria-label="Monitored repositories, comma separated" className="mt-1.5 font-mono text-xs" placeholder="myorg/frontend-app, myorg/backend-api" value={values.githubRepos} onChange={(event) => set('githubRepos', event.target.value)} /></details>
      </SettingsCard>
    </div>
  );
};
