import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, Lock } from 'lucide-react';
import { GET_OPS_RULES, GET_ORCHESTRATOR_CRON_SETTINGS, SET_STATUS_AFTER_MERGE, SET_WORKTREE_MERGED } from '../../graphql/queries';
import { UPDATE_ORCHESTRATOR_CRON_SETTINGS } from '../../graphql/mutations';
import { Button, Checkbox, Input, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  NEXT_STATUSES, readCronRules, readStatusAfterMerge, readWorktreeMerged, withCronRules,
  type BlockedManualMode, type CronRules, type StatusAfterMerge, type WorktreeMerged, type WorktreeMode,
} from '../../lib/opsRules';
import { SettingRow, SettingsCard } from '../SettingsParts';

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : 'Aturan nggak kesimpen');
const seg = (on: boolean) => cn('inline-flex items-center rounded-xs border px-2.5 py-1.5 text-[0.78rem] disabled:cursor-not-allowed disabled:opacity-45 max-[900px]:min-h-11',
  on ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-1 text-secondary-foreground hover:border-border-glow');

const BLOCKED_MODES: Array<[BlockedManualMode, string]> = [['tell', 'Kasih tahu aja'], ['stop', 'Jangan mulai'], ['off', 'Nggak dicek']];
const WORKTREE_MODES: Array<[WorktreeMode, string]> = [['notify', 'Kasih tahu aja'], ['auto', 'Hapus otomatis'], ['off', 'Mati']];
const WORKTREE_HELP: Record<WorktreeMode, string> = {
  notify: 'Tiap hari kasih tahu di Workspace dan Home. Nggak pernah ngehapus sendiri.',
  auto: 'Tiap hari 07:00 WIB, worktree yang udah merged lebih dari batas hari dihapus lewat wt.sh.',
  off: 'Nggak dicek sama sekali.',
};

/**
 * Settings › Sous flow › Aturan: blocked-by for manual sessions, stacked PR, the Jira move after merge, merged worktrees.
 * Saves on each change. `merge` is the laptop DOCK's part: only the Jira move, which each DOCK keeps in its own settings.
 */
export const RulesCard = ({ scope = 'all', onOpenWorktrees }: { scope?: 'all' | 'merge'; onOpenWorktrees?: () => void }) => {
  const all = scope === 'all';
  const { data: opsData, loading: opsLoading } = useQuery<{ opsRules: { statusAfterMerge: string; worktreeMerged: string } }>(GET_OPS_RULES, { fetchPolicy: 'cache-and-network' });
  const { data: cronData, loading: cronLoading } = useQuery<{ orchestratorCronSettings: { config: string } }>(GET_ORCHESTRATOR_CRON_SETTINGS, { fetchPolicy: 'cache-and-network', skip: !all });
  const [saveStatus, statusSaving] = useMutation(SET_STATUS_AFTER_MERGE, { refetchQueries: [GET_OPS_RULES], awaitRefetchQueries: true });
  const [saveWorktree, worktreeSaving] = useMutation(SET_WORKTREE_MERGED, { refetchQueries: [GET_OPS_RULES], awaitRefetchQueries: true });
  const [saveCron, cronSaving] = useMutation(UPDATE_ORCHESTRATOR_CRON_SETTINGS, { refetchQueries: [GET_ORCHESTRATOR_CRON_SETTINGS], awaitRefetchQueries: true });
  const [error, setError] = useState<string | null>(null);
  const status = readStatusAfterMerge(opsData?.opsRules.statusAfterMerge);
  const worktree = readWorktreeMerged(opsData?.opsRules.worktreeMerged);
  const config = cronData?.orchestratorCronSettings.config ?? null;
  const cron = readCronRules(config);
  const busy = opsLoading || (all && cronLoading) || statusSaving.loading || worktreeSaving.loading || cronSaving.loading;

  const store = (work: () => Promise<unknown>) => {
    setError(null);
    work().catch((failure: unknown) => setError(errorText(failure)));
  };
  const setStatus = (next: Partial<StatusAfterMerge>) => store(() => saveStatus({ variables: { value: JSON.stringify({ ...status, ...next }) } }));
  const setWorktree = (next: Partial<WorktreeMerged>) => store(() => saveWorktree({ variables: { value: JSON.stringify({ ...worktree, ...next }) } }));
  const setCron = (next: Partial<CronRules>) => config && store(() => saveCron({ variables: { config: withCronRules(config, next) } }));
  const nextOptions = [...new Set([...NEXT_STATUSES, status.next])].map((value) => ({ value, label: `PR Review → ${value}` }));

  return (
    <SettingsCard title="Aturan" caption="Kapan sous boleh mulai tiket, apa yang terjadi di Jira setelah PR merge, dan worktree yang udah merged. Tiap aturan kesimpen langsung.">
      {all && <SettingRow label="Kalau tiket ke-block" help="Buat sesi yang kamu buka sendiri dari tiket. Cron selalu nunggu dependency-nya beres.">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kalau tiket ke-block">
          {BLOCKED_MODES.map(([mode, label]) => <button key={mode} type="button" role="radio" aria-checked={cron.blockedManual === mode} className={seg(cron.blockedManual === mode)} disabled={busy || !config} onClick={() => setCron({ blockedManual: mode })}>{label}</button>)}
        </div>
      </SettingRow>}
      {all && <SettingRow label="Stacked PR boleh jalan" help="Tiket boleh mulai di atas branch tiket induk yang belum merge (PR Review atau PR yang masih open).">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={cron.stackedAllowed} disabled={busy || !config} onChange={(event) => setCron({ stackedAllowed: event.target.checked })} />Boleh</label>
      </SettingRow>}
      <SettingRow label="Pindah status setelah merge" help="Waktu semua PR tiket di PR Review merge, status Jira pindah ke:">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox aria-label="Pindah status setelah merge" checked={status.enabled} disabled={busy} onChange={(event) => setStatus({ enabled: event.target.checked })} />
          <span className="min-w-0 flex-1"><Select aria-label="Status tujuan" value={status.next} options={nextOptions} disabled={busy || !status.enabled} onValueChange={(next) => setStatus({ next })} /></span>
        </div>
      </SettingRow>
      <SettingRow label="Abaikan PR docs-sync" help="PR docs-sync dari bot (docs/auto-update/…) yang masih open nggak nahan perpindahan status.">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={status.ignoreDocsSync} disabled={busy || !status.enabled} onChange={(event) => setStatus({ ignoreDocsSync: event.target.checked })} />Abaikan</label>
      </SettingRow>
      <SettingRow label="Jalan juga di DOCK laptop" help="Biasanya cuma DOCK workspace. Kalau dua-duanya nyala, status Jira dicek ulang sebelum pindah, jadi tiketnya nggak pindah dua kali.">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={status.laptop} disabled={busy || !status.enabled} onChange={(event) => setStatus({ laptop: event.target.checked })} />Nyala di laptop</label>
      </SettingRow>
      {all && <SettingRow label="Worktree merged" help="Apa yang DOCK lakuin ke worktree yang tiketnya udah merged.">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Worktree merged">
            {WORKTREE_MODES.map(([mode, label]) => <button key={mode} type="button" role="radio" aria-checked={worktree.mode === mode} className={seg(worktree.mode === mode)} disabled={busy} onClick={() => setWorktree({ mode })}>{label}</button>)}
          </div>
          <p className="text-xs text-muted-foreground">{WORKTREE_HELP[worktree.mode]}</p>
          {worktree.mode === 'auto' && (
            <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface-0 p-3 text-xs">
              <label className="flex flex-wrap items-center gap-2"><span className="w-28 text-muted-foreground">Merged lebih dari</span>
                <Input aria-label="Hari" inputMode="numeric" className="h-8 w-16 text-center font-mono text-xs" defaultValue={String(worktree.days)} key={worktree.days} disabled={busy}
                  onBlur={(event) => { const days = Number(event.target.value); if (Number.isInteger(days) && days !== worktree.days) setWorktree({ days }); }} />
                <span className="text-muted-foreground">hari</span></label>
              <ul className="flex flex-col gap-0.5">{['Nggak ada perubahan lokal', 'Nggak dipakai sesi aktif', 'Nggak ada dev server yang jalan'].map((line) => <li key={line} className="flex items-center gap-1.5 text-secondary-foreground"><Lock size={11} aria-hidden="true" className="text-muted-foreground" />{line}</li>)}</ul>
              <p className="flex items-center gap-1.5 text-status-warn"><AlertTriangle size={12} aria-hidden="true" />Worktree yang dihapus nggak bisa dibalikin. Branch tetap ada di remote.</p>
            </div>
          )}
          {onOpenWorktrees && <div><Button size="sm" variant="ghost" onClick={onOpenWorktrees}>Buka Worktrees</Button></div>}
        </div>
      </SettingRow>}
      {error && <p className="mt-3 text-sm text-status-conflict" role="alert">{error}</p>}
    </SettingsCard>
  );
};
