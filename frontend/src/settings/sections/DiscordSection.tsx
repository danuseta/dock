import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { Building2, Zap } from 'lucide-react';
import { TEST_DISCORD_READER, VALIDATE_DISCORD } from '../../graphql/mutations';
import { Button, Input } from '../../components/ui';
import type { SavedSettings, SectionValues, TestResult } from '../sections';
import { ConnectionStatus, Field, SecretInput, SettingsCard, TestResultText } from '../SettingsParts';

/** A value the workspace brings: shown, not edited here. */
const Managed = ({ label, value }: { label: string; value: string }) => (
  <p className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
    <Building2 size={14} aria-hidden="true" /><span className="font-medium text-secondary-foreground">{label}</span><span className="min-w-0 truncate font-mono">{value}</span><span className="ml-auto whitespace-nowrap">set by the workspace</span>
  </p>
);

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
  const saved = Boolean(settings.hasDiscordWebhookUrl);

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

      <SettingsCard title="Forum reader" caption={settings.discordTeamChannels ? `This workspace follows the team's ${settings.discordTeamChannels} forums for you. Add your Discord user id so DOCK can tell which threads are yours; add more channels on the Discord page.` : 'Discord sends DOCK each change in the channels you follow on the Discord page as it happens. Add and remove channels there.'}>
        <div className="flex flex-col gap-3">
          {settings.discordManagedToken ? <Managed label="Bot token" value="••••••••" /> : <SecretInput label="Bot token" saved={Boolean(settings.hasDiscordBotToken)} value={values.discordBotToken} onChange={(value) => set('discordBotToken', value)} placeholder="Bot token" hint="The bot needs View Channel, Read Message History and the Message Content intent on the channels you follow." />}
          {settings.discordManagedGuild ? <Managed label="Server" value={settings.discordManagedGuild} /> : <Field label="Server id" hint="Developer Mode on, right click the server name, Copy Server ID."><Input className="font-mono text-xs" inputMode="numeric" value={values.discordGuildId} onChange={(event) => set('discordGuildId', event.target.value.trim())} placeholder="1389235158414000200" /></Field>}
          <Field label="Your Discord user id" hint="Right click your name, Copy User ID. Threads that mention you or that you wrote in are sorted with it."><Input className="font-mono text-xs" inputMode="numeric" value={values.discordUserId} onChange={(event) => set('discordUserId', event.target.value.trim())} placeholder="123456789012345678" /></Field>
          <div className="flex flex-wrap items-center gap-3"><Button onClick={handleReaderTest} disabled={testingReader || !(settings.hasDiscordBotToken || settings.discordManagedToken)}><Zap size={16} aria-hidden="true" />Test saved reader</Button><TestResultText busy={testingReader} result={readerTest} /></div>
        </div>
      </SettingsCard>
    </div>
  );
};
