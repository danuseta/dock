export const mockUrl = (env: NodeJS.ProcessEnv = process.env) => env.DOCK_MOCK_URL?.trim().replace(/\/+$/, '') || '';

export const githubApiBase = (env: NodeJS.ProcessEnv = process.env) => (mockUrl(env) ? `${mockUrl(env)}/github` : 'https://api.github.com');

export const discordApiBase = (env: NodeJS.ProcessEnv = process.env) => (mockUrl(env) ? `${mockUrl(env)}/discord/api/v10` : 'https://discord.com/api/v10');

export const discordGatewayUrl = (real: string, env: NodeJS.ProcessEnv = process.env) => (mockUrl(env)
  ? `${mockUrl(env).replace(/^http/i, 'ws')}/discord/gateway/?v=10&encoding=json`
  : real);

export const atlassianMockBase = (env: NodeJS.ProcessEnv = process.env) => (mockUrl(env) ? `${mockUrl(env)}/jira` : '');

export const isMockDiscordWebhookUrl = (value: string, env: NodeJS.ProcessEnv = process.env) => {
  const root = mockUrl(env);
  if (!root || !value.startsWith(`${root}/discord/api/webhooks/`)) return false;
  try {
    return /\/discord\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(new URL(value).pathname);
  } catch {
    return false;
  }
};
