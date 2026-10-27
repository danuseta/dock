import fs from 'node:fs';
import { CHANNEL_KINDS, type Channel, type ChannelKind, type ChannelStore } from './discord-threads';

/** The team's Discord defaults a workspace brings: the server and the forums every teammate's DOCK follows. */
export interface DiscordTeam { guild: string; channels: Array<{ id: string; name: string | null; kind: ChannelKind }> }

const SNOWFLAKE = /^\d{15,25}$/;

/** The `discord` block of the kit's team file, or null when it is missing or not usable. */
export function parseDiscordTeam(text: string): DiscordTeam | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const discord = (raw as { discord?: { guild?: unknown; channels?: unknown } } | null)?.discord;
  if (!discord || typeof discord.guild !== 'string' || !SNOWFLAKE.test(discord.guild) || !Array.isArray(discord.channels)) return null;
  const channels = discord.channels.flatMap((entry: unknown) => {
    const channel = entry as { id?: unknown; name?: unknown; kind?: unknown } | null;
    if (!channel || typeof channel.id !== 'string' || !SNOWFLAKE.test(channel.id)) return [];
    if (typeof channel.kind !== 'string' || !(CHANNEL_KINDS as readonly string[]).includes(channel.kind)) return [];
    return [{ id: channel.id, name: typeof channel.name === 'string' ? channel.name : null, kind: channel.kind as ChannelKind }];
  });
  return { guild: discord.guild, channels };
}

let loaded: { path: string | undefined; team: DiscordTeam | null } | null = null;

/** The team file named by `DOCK_TEAM_FILE`, read once; a bad file is reported once and ignored. */
export function discordTeam(env: NodeJS.ProcessEnv = process.env, read: (path: string) => string = (path) => fs.readFileSync(path, 'utf8')): DiscordTeam | null {
  const path = env.DOCK_TEAM_FILE;
  if (loaded && loaded.path === path) return loaded.team;
  let team: DiscordTeam | null = null;
  if (path) {
    try {
      team = parseDiscordTeam(read(path));
      if (!team) console.warn(`[Discord] ${path} has no usable discord block; the team defaults are off`);
    } catch (error) {
      console.warn(`[Discord] ${path} could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  loaded = { path, team };
  return team;
}

/** What the workspace gives in place of an empty setting: the bot token from the template, the server from the team file. */
export function workspaceDiscordSetting(key: string, env: NodeJS.ProcessEnv = process.env, team: DiscordTeam | null = discordTeam(env)): string | null {
  if (key === 'discordBotToken') return env.DOCK_DISCORD_BOT_TOKEN?.trim() || null;
  if (key === 'discordGuildId') return team?.guild ?? null;
  return null;
}

/**
 * Follows every team forum: a missing one is added and switched on, a known one is marked as the team's.
 * A forum the user switched off stays off, and the user's own channels are left alone. Returns how many rows changed.
 */
export async function ensureTeamChannels(store: Pick<ChannelStore, 'list' | 'save'>, team: DiscordTeam | null): Promise<number> {
  if (!team) return 0;
  const known = new Map((await store.list()).map((channel) => [channel.id, channel]));
  let changed = 0;
  for (const wanted of team.channels) {
    const have = known.get(wanted.id);
    if (have?.team) continue;
    const channel: Channel = have ? { ...have, team: true } : { id: wanted.id, name: wanted.name, kind: wanted.kind, thread: false, enabled: true, team: true };
    await store.save(channel);
    changed += 1;
  }
  return changed;
}

/** A team forum is switched off, never removed: removing it would only bring it back on the next check. */
export const isTeamChannel = (channels: Array<Pick<Channel, 'id' | 'team'>>, id: string) => channels.some((channel) => channel.id === id && channel.team);
