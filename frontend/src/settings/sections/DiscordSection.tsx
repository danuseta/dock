import { useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Zap } from 'lucide-react';
import { TEST_DISCORD_READER, VALIDATE_DISCORD } from '../../graphql/mutations';
import { Badge, Button, Input, Textarea } from '../../components/ui';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, renderDiscordMessageTemplate } from '../../lib/discordTemplate';
import { sectionErrors, type SavedSettings, type SectionValues, type TestResult } from '../sections';
import { ConnectionStatus, Field, SecretInput, SettingsCard, TestResultText } from '../SettingsParts';

const TEMPLATE_FIELDS = ['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl'];

const previewData = {
  ticket: { key: 'QRD-1055', title: '[BE] Component Template: folder support', url: 'https://mysales.atlassian.net/browse/QRD-1055' },
  pullRequests: [{ repo: 'ms-admin-worker-backend', title: 'feat(QRD-1055): add folder support to the component template module', url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/969', status: 'OPEN' }],
  demoUrl: '- **QRD-1055:** https://docs.google.com/document/u/0/',
};

export const DiscordSection = ({ values, set, settings, test, onTested }: {
  values: SectionValues;
  set: (key: string, value: string) => void;
  settings: SavedSettings;
  test?: TestResult;
  onTested: (result: TestResult) => void;
}) => {
  const [validate, { loading: testing }] = useMutation(VALIDATE_DISCORD);
  const [testReader, { loading: testingReader }] = useMutation(TEST_DISCORD_READER);
  const [readerTest, setReaderTest] = useState<TestResult>();
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const saved = Boolean(settings.hasDiscordWebhookUrl);
  const template = values.discordMessageTemplate;
  const error = sectionErrors('discord', values)[0];

  const handleTest = async () => {
    try {
      // A blank URL makes the server test the saved webhook.
      const result = (await validate({ variables: { webhookUrl: values.discordWebhookUrl } })).data?.validateDiscord;
      onTested({ ok: Boolean(result?.success), message: result?.success && !values.discordWebhookUrl ? `${result.message} (saved webhook)` : result?.message ?? 'No answer' });
    } catch (testError) {
      onTested({ ok: false, message: testError instanceof Error ? testError.message : 'Discord test failed' });
    }
  };

  // The server tests the saved reader settings, so a change is saved first.
  const handleReaderTest = async () => {
    try {
      const result = (await testReader()).data?.testDiscordReader;
      setReaderTest({ ok: Boolean(result?.success), message: result?.message ?? 'No answer' });
    } catch (testError) {
      setReaderTest({ ok: false, message: testError instanceof Error ? testError.message : 'Discord test failed' });
    }
  };

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
      {test && !test.ok
        ? <ConnectionStatus tone="bad" title="Discord rejected the webhook" detail={test.message} />
        : saved
          ? <ConnectionStatus tone="ok" title="Webhook saved" detail="Ticket summaries post to it" />
          : <ConnectionStatus tone="off" title="No webhook" detail="Add a channel webhook URL, then save" />}

      <SettingsCard title="Webhook" caption="Saved with the Discord save bar.">
        <div className="flex flex-col gap-3">
          <SecretInput label="Webhook URL" saved={saved} value={values.discordWebhookUrl} onChange={(value) => set('discordWebhookUrl', value)} placeholder="https://discord.com/api/webhooks/..." hint="Leave it blank and Test checks the saved webhook." />
          <div className="flex flex-wrap items-center gap-3"><Button onClick={handleTest} disabled={testing || (!saved && !values.discordWebhookUrl)}><Zap size={16} aria-hidden="true" />Test webhook</Button><TestResultText busy={testing} result={test} /></div>
        </div>
      </SettingsCard>

      <SettingsCard title="Forum reader" caption="DOCK reads the channels you follow on the Discord page every 5 minutes. Add and remove channels there.">
        <div className="flex flex-col gap-3">
          <SecretInput label="Bot token" saved={Boolean(settings.hasDiscordBotToken)} value={values.discordBotToken} onChange={(value) => set('discordBotToken', value)} placeholder="Bot token" hint="The bot needs View Channel, Read Message History and the Message Content intent on the channels you follow." />
          <Field label="Server id" hint="Developer Mode on, right click the server name, Copy Server ID."><Input className="font-mono text-xs" inputMode="numeric" value={values.discordGuildId} onChange={(event) => set('discordGuildId', event.target.value.trim())} placeholder="1389235158414000200" /></Field>
          <Field label="Your Discord user id" hint="Right click your name, Copy User ID. Threads that mention you or that you wrote in are sorted with it."><Input className="font-mono text-xs" inputMode="numeric" value={values.discordUserId} onChange={(event) => set('discordUserId', event.target.value.trim())} placeholder="123456789012345678" /></Field>
          <div className="flex flex-wrap items-center gap-3"><Button onClick={handleReaderTest} disabled={testingReader || !settings.hasDiscordBotToken}><Zap size={16} aria-hidden="true" />Test saved reader</Button><TestResultText busy={testingReader} result={readerTest} /></div>
        </div>
      </SettingsCard>

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
    </div>
  );
};
