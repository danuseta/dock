import { useRef } from 'react';
import { Badge, Button, Textarea } from '../../components/ui';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, renderDiscordMessageTemplate } from '../../lib/discordTemplate';
import { sectionErrors, type SectionValues } from '../sections';
import { SettingsCard } from '../SettingsParts';

const TEMPLATE_FIELDS = ['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl'];

const previewData = {
  ticket: { key: 'QRD-1055', title: '[BE] Component Template: folder support', url: 'https://mysales.atlassian.net/browse/QRD-1055' },
  pullRequests: [{ repo: 'ms-admin-worker-backend', title: 'feat(QRD-1055): add folder support to the component template module', url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/969', status: 'OPEN' }],
  demoUrl: '- **QRD-1055:** https://docs.google.com/document/u/0/',
};

export const DiscordMessagesSection = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => {
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const template = values.discordMessageTemplate;
  const error = sectionErrors('messages', values)[0];

  const insert = (field: string) => {
    const area = templateRef.current;
    const token = `{{${field}}}`;
    const start = area?.selectionStart ?? template.length;
    const end = area?.selectionEnd ?? template.length;
    set('discordMessageTemplate', template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + token.length, start + token.length); });
  };

  return (
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
  );
};
