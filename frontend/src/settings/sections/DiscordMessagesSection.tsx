import { useRef } from 'react';
import { Lock } from 'lucide-react';
import { Badge, Button, Checkbox, Input, Select, Textarea } from '../../components/ui';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, DEFAULT_PR_TAG_TEMPLATE, MAX_PR_TAG_ROLE_LENGTH, MAX_PR_TAG_TEMPLATE_LENGTH, getPrTagError, renderDiscordMessageTemplate, renderPrTag } from '../../lib/discordTemplate';
import { DEFAULT_REVIEW_POST_TEMPLATE, DEFAULT_REVIEW_REPLY_TEMPLATE, DEFAULT_REVIEW_SKILL, MAX_TEMPLATE_CHARS, MESSAGE_FORMATS, MESSAGE_KEYS, MESSAGE_MARKER, TEMPLATE_PLACEHOLDERS, previewMessage, type MessageKind } from '../../lib/reviewMessages';
import { sectionErrors, type SectionValues } from '../sections';
import { SettingRow, SettingsCard } from '../SettingsParts';

const TEMPLATE_FIELDS = ['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl'];

const previewData = {
  ticket: { key: 'QRD-1055', title: '[BE] Component Template: folder support', url: 'https://mysales.atlassian.net/browse/QRD-1055' },
  pullRequests: [{ repo: 'ms-admin-worker-backend', title: 'feat(QRD-1055): add folder support to the component template module', url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/969', status: 'OPEN' }],
  demoUrl: '- **QRD-1055:** https://docs.google.com/document/u/0/',
};

const REVIEW_MESSAGES: Record<MessageKind, { title: string; caption: string; fallback: string }> = {
  post: { title: 'Review post', caption: 'The message DOCK posts to the pr-review thread after a review. A skill writes it; the DOCK template needs no model.', fallback: DEFAULT_REVIEW_POST_TEMPLATE },
  reply: { title: 'Review reply', caption: 'The reply DOCK posts after a fix, or when every finding was not valid.', fallback: DEFAULT_REVIEW_REPLY_TEMPLATE },
};

const ReviewerTagCard = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => {
  const on = values.prTagEnabled === 'true';
  const error = getPrTagError(values.prTagTemplate, values.prTagRole);
  return (
    <SettingsCard title="Reviewer tag" caption="A second message DOCK sends in the new pull request thread right after the post, so the team is pinged. Notes typed when posting by hand go before it.">
      <label className="mb-3 flex items-start gap-3 text-sm">
        <Checkbox checked={on} onChange={(event) => set('prTagEnabled', String(event.target.checked))} />
        <span><b className="font-semibold text-foreground">Tag reviewers after the PR post</b><span className="block text-xs text-muted-foreground">{'{{slots}}'} is -1 when every posted ticket is a Bug in Jira, -2 otherwise. When Jira or the role cannot be read, you are told.</span></span>
      </label>
      <div className={on ? '' : 'opacity-50'}>
        <SettingRow label="Message" help="{{role}} is the role, {{slots}} is -1 or -2.">
          <Input aria-label="Reviewer tag message" className="font-mono text-xs" value={values.prTagTemplate} maxLength={MAX_PR_TAG_TEMPLATE_LENGTH} disabled={!on} aria-invalid={Boolean(error)} onChange={(event) => set('prTagTemplate', event.target.value)} />
        </SettingRow>
        <SettingRow label="Role" help="The Discord role name, found with the DOCK bot and pinged.">
          <Input aria-label="Reviewer tag role" className="w-48 font-mono text-xs" value={values.prTagRole} maxLength={MAX_PR_TAG_ROLE_LENGTH} disabled={!on} onChange={(event) => set('prTagRole', event.target.value)} />
        </SettingRow>
        {error && <p className="mt-2 text-pretty text-xs text-status-conflict" role="alert">{error}</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="m-0 font-mono text-xs text-muted-foreground" aria-live="polite">{renderPrTag(values.prTagTemplate, values.prTagRole, '-2')}</p>
          <Button size="sm" variant="ghost" disabled={!on} onClick={() => set('prTagTemplate', DEFAULT_PR_TAG_TEMPLATE)}>Restore default</Button>
        </div>
      </div>
    </SettingsCard>
  );
};

const ReviewMessageCard = ({ kind, values, set, skills }: { kind: MessageKind; values: SectionValues; set: (key: string, value: string) => void; skills: string[] }) => {
  const keys = MESSAGE_KEYS[kind];
  const info = REVIEW_MESSAGES[kind];
  const format = values[keys.format];
  const skill = values[keys.skill];
  const template = values[keys.template];
  const names = skills.includes(skill) ? skills : [skill, ...skills];
  return (
    <SettingsCard title={info.title} caption={info.caption}>
      <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${info.title} format`}>
        {MESSAGE_FORMATS[kind].map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={format === option.value} onClick={() => set(keys.format, option.value)} className={`inline-flex items-center rounded-xs border px-2.5 py-1.5 text-[0.78rem] max-[900px]:min-h-11 ${format === option.value ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-1 text-secondary-foreground hover:border-border-glow'}`}>{option.label}</button>
        ))}
      </div>
      {format === 'skill' && (
        <div className="mb-3">
          <Select aria-label={`${info.title} skill`} value={skill} onValueChange={(value) => set(keys.skill, value)} options={names.map((name) => ({ value: name, label: name === DEFAULT_REVIEW_SKILL ? `${name} (default)` : name }))} />
          <p className="mt-1 text-pretty text-xs text-muted-foreground">Any installed skill, your own included. The session writes the message with it and DOCK posts it. A skill that is gone, or an empty message, falls back to the DOCK template and you are told.</p>
        </div>
      )}
      {format === 'template' && (
        <div className="mb-3">
          <div className="mb-2 flex flex-wrap gap-1.5">{TEMPLATE_PLACEHOLDERS[kind].map((field) => <Badge key={field} variant="accent" className="font-mono text-[0.7rem]">{`{{${field}}}`}</Badge>)}</div>
          <Textarea aria-label={`${info.title} template`} className="min-h-[96px] bg-surface-0 font-mono text-xs leading-5" value={template} maxLength={MAX_TEMPLATE_CHARS} onChange={(event) => set(keys.template, event.target.value)} />
          <div className="mt-2 flex items-center justify-between gap-2"><Badge>{template.length}/{MAX_TEMPLATE_CHARS}</Badge><Button size="sm" variant="ghost" onClick={() => set(keys.template, info.fallback)}>Restore default</Button></div>
        </div>
      )}
      {format === 'builtin' && <p className="mb-3 text-pretty text-xs text-muted-foreground">DOCK writes the reply from the round: what was fixed at which commit, and what was left as is and why.</p>}
      <div className="rounded-md border border-border bg-[oklch(0.19_0.01_265)] p-4">
        <p className="mb-2 flex items-center gap-2 font-display text-sm font-bold"><span className="size-6 rounded-full bg-status-discord" aria-hidden="true" />DOCK <Badge className="px-1.5 py-0 text-[0.6rem]">APP</Badge><Badge variant="accent" className="ml-auto px-1.5 py-0 text-[0.6rem]">preview</Badge></p>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground" aria-live="polite">{previewMessage(kind, format, template)}</pre>
        <p className="mt-2 mb-0 flex items-center gap-1.5 border-t border-border pt-2 font-mono text-[0.7rem] text-muted-foreground"><Lock size={11} aria-hidden="true" className="flex-none" />{MESSAGE_MARKER[kind]}</p>
      </div>
      <p className="mt-2 text-pretty text-xs text-muted-foreground">The marker line is added by DOCK and cannot be changed: a teammate's DOCK reads the review through it.</p>
    </SettingsCard>
  );
};

export const DiscordMessagesSection = ({ values, set, skills = [] }: { values: SectionValues; set: (key: string, value: string) => void; skills?: string[] }) => {
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const template = values.discordMessageTemplate;
  const tagError = getPrTagError(values.prTagTemplate, values.prTagRole);
  const error = sectionErrors('messages', values).find((message) => message !== tagError);

  const insert = (field: string) => {
    const area = templateRef.current;
    const token = `{{${field}}}`;
    const start = area?.selectionStart ?? template.length;
    const end = area?.selectionEnd ?? template.length;
    set('discordMessageTemplate', template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + token.length, start + token.length); });
  };

  return (
    <div className="flex flex-col gap-5">
    <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
      <SettingsCard title="Message template" caption="Markdown. A line with a ticket field repeats per ticket in a group." aside={<Badge>{template.length}/2000</Badge>}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {TEMPLATE_FIELDS.map((field) => <Button key={field} size="sm" variant="ghost" className="h-7 border-accent/30 bg-accent-dim px-2 font-mono text-[0.7rem] text-accent" onClick={() => insert(field)}>{`{{${field}}}`}</Button>)}
        </div>
        <Textarea ref={templateRef} aria-label="Message template" className="min-h-[260px] bg-surface-0 font-mono text-xs leading-5" value={template} maxLength={2000} aria-invalid={Boolean(error)} aria-describedby={error ? 'discord-template-error' : undefined} onChange={(event) => set('discordMessageTemplate', event.target.value)} />
        {error && <p id="discord-template-error" className="mt-2 text-pretty text-xs text-status-conflict" role="alert">{error}</p>}
        <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => set('discordMessageTemplate', DEFAULT_DISCORD_MESSAGE_TEMPLATE)}>Restore default</Button></div>
      </SettingsCard>

      <SettingsCard title="Preview" caption="With a sample ticket, as Discord shows it." aside={<Badge>live</Badge>}>
        <div className="min-h-[260px] rounded-md border border-border bg-[oklch(0.19_0.01_265)] p-4">
          <p className="mb-2 flex items-center gap-2 font-display text-sm font-bold"><span className="size-6 rounded-full bg-status-discord" aria-hidden="true" />DOCK <Badge className="px-1.5 py-0 text-[0.6rem]">APP</Badge></p>
          {error
            ? <p className="text-pretty text-sm text-status-conflict">Fix the template error to see the preview.</p>
            : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground" aria-live="polite">{renderDiscordMessageTemplate(template, previewData)}</pre>}
        </div>
        <p className="mt-3 text-pretty text-xs text-muted-foreground">The ticket page lets you post to an existing thread or start a new one in a forum channel.</p>
      </SettingsCard>
    </div>
    <ReviewerTagCard values={values} set={set} />
    <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
      <ReviewMessageCard kind="post" values={values} set={set} skills={skills} />
      <ReviewMessageCard kind="reply" values={values} set={set} skills={skills} />
    </div>
    </div>
  );
};
