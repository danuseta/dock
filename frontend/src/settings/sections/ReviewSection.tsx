import { Checkbox } from '../../components/ui';
import type { SectionValues } from '../sections';
import { SettingsCard } from '../SettingsParts';

export const ReviewSection = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => (
  <SettingsCard title="Auto review" caption="When you say on it in a pr-review thread, DOCK opens a Review session that runs the sous review of its pull request. Nothing is posted to the PR, Jira or Discord by the review.">
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={values.autoReviewOnIt === 'true'} onChange={(event) => set('autoReviewOnIt', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Review when I say on it</b><span className="block text-xs text-muted-foreground">Once per pull request head commit; it waits for a cron slot. Needs your Discord user id above.</span></span>
      </label>
      <label className={`flex items-start gap-3 text-sm ${values.autoReviewOnIt === 'true' ? '' : 'opacity-50'}`}>
        <Checkbox checked={values.autoLgtm === 'true'} disabled={values.autoReviewOnIt !== 'true'} onChange={(event) => set('autoLgtm', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">LGTM when the review is clean</b><span className="block text-xs text-muted-foreground">An approve verdict with no open blocker gets the same LGTM as the button on Agents: your Pass label in Jira and a GitHub approval. You are told, so you can say it in the thread.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={values.reviewFindingsToTask === 'true'} onChange={(event) => set('reviewFindingsToTask', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Send review findings to the Task session</b><span className="block text-xs text-muted-foreground">A teammate's notes in your pr-review thread go to the ticket's Task session, which fixes the valid ones and pushes to the PR. Nothing is posted to Discord.</span></span>
      </label>
    </div>
  </SettingsCard>
);
