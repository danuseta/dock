import { Lock } from 'lucide-react';
import { Checkbox, Input } from '../../components/ui';
import { REVIEW_NUMBERS } from '../../lib/reviewMessages';
import type { SectionValues } from '../sections';
import { SettingRow, SettingsCard } from '../SettingsParts';

export const ReviewSection = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => (
  <div className="flex flex-col gap-5">
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
  <SettingsCard title="Arena" caption="What happens after DOCK reviews: the post to the thread, the reply after a fix, and when the arena closes. The message formats are in Discord messages.">
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={values.autoReviewPostDiscord === 'true'} onChange={(event) => set('autoReviewPostDiscord', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Post the review to the thread</b><span className="block text-xs text-muted-foreground">After the verdict, DOCK posts the review message to the pr-review thread with its marker line. Until the delay is over, Blackboard › Review findings lets you cancel or edit it.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={values.reviewFindingsAutoReply === 'true'} onChange={(event) => set('reviewFindingsAutoReply', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Reply after a fix</b><span className="block text-xs text-muted-foreground">When a round is fixed, or every finding was not valid, DOCK posts the DOCK-FIX reply to the thread. It waits for the same delay.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={values.reviewReReviewOnCommit === 'true'} onChange={(event) => set('reviewReReviewOnCommit', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Re-review new commits without DOCK-FIX</b><span className="block text-xs text-muted-foreground">Off: DOCK reviews a pull request again only after the author's DOCK-FIX for its new head, so a merge of develop or a rebase starts no round. On: a new head is also reviewed once its last commit is Re-review wait old.</span></span>
      </label>
    </div>
    <div className="mt-4">
      <SettingRow label="Post delay" help="Minutes a post waits before it goes out. 0 sends it at once.">
        <Input type="number" min={REVIEW_NUMBERS.reviewPostDelayMinutes.min} max={REVIEW_NUMBERS.reviewPostDelayMinutes.max} aria-label="Post delay" className="h-9 w-24 font-mono" value={values.reviewPostDelayMinutes} onChange={(event) => set('reviewPostDelayMinutes', event.target.value)} />
      </SettingRow>
      <SettingRow label="Re-review wait" help="With Re-review new commits on: minutes after the last commit before DOCK reviews the new head without a DOCK-FIX.">
        <Input type="number" min={REVIEW_NUMBERS.reviewReReviewWaitMinutes.min} max={REVIEW_NUMBERS.reviewReReviewWaitMinutes.max} aria-label="Re-review wait" className="h-9 w-24 font-mono" value={values.reviewReReviewWaitMinutes} onChange={(event) => set('reviewReReviewWaitMinutes', event.target.value)} />
      </SettingRow>
      <SettingRow label="Max rounds" help="After this many rounds the arena closes and you are told, with the blockers that remain.">
        <Input type="number" min={REVIEW_NUMBERS.reviewMaxRounds.min} max={REVIEW_NUMBERS.reviewMaxRounds.max} aria-label="Max rounds" className="h-9 w-24 font-mono" value={values.reviewMaxRounds} onChange={(event) => set('reviewMaxRounds', event.target.value)} />
      </SettingRow>
      <SettingRow label="Stop word" help="Anyone can write it in the thread to close the arena. It cannot be changed.">
        <span className="inline-flex items-center gap-2 rounded-xs border border-border bg-surface-0 px-2.5 py-1.5 font-mono text-xs text-secondary-foreground"><Lock size={12} aria-hidden="true" />stop dock</span>
      </SettingRow>
    </div>
  </SettingsCard>
  </div>
);
