import { useEffect } from 'react';
import { useLazyQuery, useMutation } from '@apollo/client';
import { Zap } from 'lucide-react';
import { GET_JIRA_PROJECTS } from '../../graphql/queries';
import { VALIDATE_JIRA } from '../../graphql/mutations';
import { Badge, Button, Checkbox, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { splitList, type SavedSettings, type SectionValues, type TestResult } from '../sections';
import { ConnectionStatus, Field, SecretInput, SettingsCard, TestResultText } from '../SettingsParts';

interface JiraProject { id: string; key: string; name: string }

export const JiraSection = ({ values, set, settings, test, onTested }: {
  values: SectionValues;
  set: (key: string, value: string) => void;
  settings: SavedSettings;
  test?: TestResult;
  onTested: (result: TestResult) => void;
}) => {
  const [validate, { loading: testing }] = useMutation(VALIDATE_JIRA);
  const [loadProjects, { data, loading: loadingProjects }] = useLazyQuery(GET_JIRA_PROJECTS, { fetchPolicy: 'network-only' });
  const connected = Boolean(settings.hasJiraApiToken && settings.jiraUrl && settings.jiraEmail);
  const selected = splitList(values.jiraProjectKeys);
  const projects: JiraProject[] = data?.jiraProjects ?? [];

  // Blank arguments make the server use the saved credentials.
  useEffect(() => {
    if (connected) void loadProjects();
  }, [connected, loadProjects]);

  const credentials = { url: values.jiraUrl, email: values.jiraEmail, token: values.jiraApiToken };

  const handleTest = async () => {
    try {
      const result = (await validate({ variables: credentials })).data?.validateJira;
      onTested({ ok: Boolean(result?.success), message: result?.success && !values.jiraApiToken ? `${result.message} (saved token)` : result?.message ?? 'No answer' });
      if (result?.success) void loadProjects({ variables: credentials });
    } catch (error) {
      onTested({ ok: false, message: error instanceof Error ? error.message : 'Jira test failed' });
    }
  };

  const toggle = (key: string) => set('jiraProjectKeys', (selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]).join(', '));

  return (
    <div className="flex flex-col gap-5">
      {test && !test.ok
        ? <ConnectionStatus tone="bad" title="Jira rejected the credentials" detail={test.message} />
        : connected
          ? <ConnectionStatus tone="ok" title={`Connected as ${settings.jiraEmail}`} detail={`${settings.jiraUrl} · token saved · ${splitList(settings.jiraProjectKeys || '').length || 'all'} projects`} />
          : <ConnectionStatus tone="off" title="Not connected" detail="Add the domain, the email and an API token, then save" />}

      <SettingsCard title="Account" caption="Saved with the Jira save bar.">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">
            <Field label="Domain URL"><Input className="font-mono" placeholder="company.atlassian.net" value={values.jiraUrl} onChange={(event) => set('jiraUrl', event.target.value)} /></Field>
            <Field label="User email"><Input type="email" className="font-mono" placeholder="developer@company.com" value={values.jiraEmail} onChange={(event) => set('jiraEmail', event.target.value)} /></Field>
          </div>
          <SecretInput label="API token" saved={Boolean(settings.hasJiraApiToken)} value={values.jiraApiToken} onChange={(value) => set('jiraApiToken', value)} placeholder="ATATT3xFfGF0…" hint="Create one at id.atlassian.com › Security › API tokens." />
          <div className="flex flex-wrap items-center gap-3"><Button onClick={handleTest} disabled={testing || (!settings.hasJiraApiToken && !values.jiraApiToken) || !values.jiraUrl || !values.jiraEmail}><Zap size={16} aria-hidden="true" />Test connection</Button><TestResultText busy={testing} result={test} /></div>
        </div>
      </SettingsCard>

      <SettingsCard title="Projects on the board" caption="None selected shows every ticket assigned to you." aside={<Badge>{selected.length} selected</Badge>}>
        {loadingProjects ? <p className="text-sm text-muted-foreground">Loading projects…</p>
          : projects.length > 0 ? (
            <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface-0 p-2">
              {projects.map((project) => {
                const on = selected.includes(project.key);
                return <label key={project.id} className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5', on && 'bg-accent-dim')}><Checkbox checked={on} onChange={() => toggle(project.key)} /><strong className="font-mono text-xs">{project.key}</strong><span className="truncate text-xs text-secondary-foreground">{project.name}</span></label>;
              })}
            </div>
          ) : <p className="text-pretty text-sm text-muted-foreground">{selected.length ? `Saved selection: ${selected.join(', ')}. ` : ''}{connected ? 'Jira returned no projects.' : 'Projects load once the account is saved.'}</p>}
      </SettingsCard>
    </div>
  );
};
