import React from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Page } from '../components/ui';

interface GuidePageProps { onNavigate: (path: string) => void }

/** One setting: where it is, its default, its range and what it does. */
type Row = [setting: string, defaultValue: string, range: string, meaning: string];

const Settings: React.FC<{ rows: Row[] }> = ({ rows }) => (
  <div className="my-3 overflow-x-auto rounded-sm border border-border">
    <table className="w-full min-w-[560px] border-collapse text-left text-xs">
      <thead className="bg-surface-1 font-mono text-[0.66rem] uppercase tracking-wide text-muted-foreground">
        <tr><th className="px-3 py-2">Setting</th><th className="px-3 py-2">Default</th><th className="px-3 py-2">Range</th><th className="px-3 py-2">Meaning</th></tr>
      </thead>
      <tbody>
        {rows.map(([setting, value, range, meaning]) => (
          <tr key={setting} className="border-t border-border align-top">
            <td className="px-3 py-2 font-semibold text-foreground">{setting}</td>
            <td className="whitespace-nowrap px-3 py-2 font-mono text-secondary-foreground">{value}</td>
            <td className="whitespace-nowrap px-3 py-2 font-mono text-secondary-foreground">{range}</td>
            <td className="px-3 py-2 text-secondary-foreground">{meaning}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The same settings on a phone: one card each, so nothing scrolls sideways. */
const SettingCards: React.FC<{ rows: Row[] }> = ({ rows }) => (
  <div className="my-3 flex flex-col gap-2">
    {rows.map(([setting, value, range, meaning]) => (
      <div key={setting} className="rounded-sm border border-border bg-surface-0 px-3 py-2.5 text-xs">
        <p className="!mb-1 font-semibold text-foreground">{setting}</p>
        <p className="!mb-1 font-mono text-[0.7rem] text-muted-foreground">default {value} · {range}</p>
        {meaning && <p className="!mb-0 text-secondary-foreground">{meaning}</p>}
      </div>
    ))}
  </div>
);

const SettingsBlock: React.FC<{ rows: Row[] }> = ({ rows }) => (
  <>
    <div className="max-[760px]:hidden"><Settings rows={rows} /></div>
    <div className="min-[761px]:hidden"><SettingCards rows={rows} /></div>
  </>
);

const Go: React.FC<{ to: string; label: string; onNavigate: (path: string) => void }> = ({ to, label, onNavigate }) => (
  <button type="button" className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-semibold text-accent hover:underline" onClick={() => onNavigate(to)}>{label}<ArrowRight size={13} aria-hidden="true" /></button>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-6 border-t border-border pt-6 [&_li]:mb-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
    <h2 className="mb-3 font-display text-lg font-bold">{title}</h2>
    {children}
  </section>
);

const Flow: React.FC<{ steps: string[] }> = ({ steps }) => (
  <p className="flex flex-wrap items-center gap-1.5 font-mono text-[0.72rem] max-[760px]:flex-col max-[760px]:items-start text-secondary-foreground">
    {steps.map((step, index) => <React.Fragment key={step}>{index > 0 && <ArrowRight size={12} className="text-muted-foreground max-[760px]:hidden" aria-hidden="true" />}<span className="rounded-xs border border-border bg-surface-1 px-1.5 py-0.5">{step}</span></React.Fragment>)}
  </p>
);

const SECTIONS = [
  ['tiket', 'Working a ticket'],
  ['slot', 'Slots & capacity'],
  ['review', "Reviewing a teammate's PR"],
  ['akun', 'Claude account'],
  ['awasi', 'Watching & when stuck'],
  ['discord', 'Discord'],
  ['workspace', 'Workspace & update'],
  ['judge', 'Retro Judge'],
] as const;

/** How DOCK works day to day: the flows, the settings that steer them, their defaults and limits. */
const GuidePage: React.FC<GuidePageProps> = ({ onNavigate }) => (
  <Page width="medium">
    <header className="mb-6">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><BookOpen size={14} aria-hidden="true" />HOW TO USE</p>
      <h1 className="font-display text-3xl font-bold">How DOCK works</h1>
      <p className="mt-2 text-sm text-muted-foreground">The ticket, review and agent flows in DOCK, the settings that steer them, and their defaults and limits.</p>
      <nav aria-label="Contents"className="mt-4 flex flex-wrap gap-2 max-[760px]:flex-nowrap max-[760px]:overflow-x-auto">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-pill border border-border px-3 py-1 text-xs max-[760px]:flex max-[760px]:min-h-11 max-[760px]:shrink-0 max-[760px]:items-center max-[760px]:whitespace-nowrap max-[760px]:px-4 text-secondary-foreground hover:border-border-glow hover:text-foreground">{label}</a>)}
      </nav>
    </header>

    <div className="flex flex-col gap-8 text-sm leading-relaxed text-secondary-foreground">
      <Section id="tiket" title="A. Working a ticket">
        <h3 className="mb-2 font-semibold text-foreground">1. Cron: tickets run on their own</h3>
        <p>Open <Go to="/agents" label="Agents" onNavigate={onNavigate} />, press <b>Cron</b>, and switch it on. Every minute during work hours, cron takes a To Do ticket from the active sprint and opens a <code className="font-mono text-xs">Task-QRD-xxx</code> session.</p>
        <Flow steps={['To Do', 'cron picks', 'Task-QRD-xxx', 'plan', 'code', 'review', 'video', 'PR']} />
        <SettingsBlock rows={[
          ['Agents at once', '2', '1–5', 'Cron tickets (auto review included) that run at the same time. Manual chats do not count here.'],
          ['New tickets per day', '6', '1–50', 'New tickets started per day (WIB). The same number also caps parked tickets.'],
          ['From hour / Until hour', '9 / 17', '0–24 WIB', 'Outside these hours cron starts no new ticket; tickets already running still finish.'],
          ['Work days', 'Mon–Fri', '1–7', 'Days cron may start a ticket.'],
          ['Active from / until', 'empty', 'date', 'Optional: cron is active only in this date range.'],
          ['Tickets from', 'active sprint', 'active / any', 'The sprint tickets are taken from.'],
          ['Jira statuses to pick up', 'To Do', 'list', 'Jira statuses that count as ready to work on.'],
          ['Move a started ticket to', 'In Progress', 'status', 'The Jira status once a ticket starts.'],
          ['Usage brake (%)', '70', '0–100', 'When 5-hour usage reaches this, cron stops starting new tickets. Ultra accounts have no 5-hour window, so this limit is skipped.'],
          ['Weekly brake (%)', '90', '0–100', 'When 7-day usage reaches this, cron stops starting new tickets.'],
        ]} />
        <h3 className="mb-2 mt-4 font-semibold text-foreground">2. Manual tickets</h3>
        <p>Open a session from the chat panel or from a ticket. The difference from cron: a manual session stops at the <b>gate</b> and asks before it writes code; cron keeps going without asking when the ticket's AC is complete. A ticket without AC is parked and waits for you.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">3. Order & dependencies</h3>
        <p>On the <Go to="/dashboard" label="Board" onNavigate={onNavigate} />, set the work order, mark tickets <b>manual</b> (cron does not take them), and add dependencies. Cron follows that order and skips tickets whose dependencies are not done.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">4. The agent asks</h3>
        <p>Agent questions arrive as notifications and show in <Go to="/decisions" label="Decisions" onNavigate={onNavigate} /> and Agents. Your answer goes to the front of the queue and takes the first free slot.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">5. Done</h3>
        <p>A ticket finishes with an open PR (draft when asked), a demo video in Demo Videos, its Jira status moved, and its run in Agents marked Done.</p>
      </Section>

      <Section id="slot" title="B. Slots & capacity">
        <SettingsBlock rows={[
          ['Turns at once (Settings → Chat)', '3', '1–6', 'Total turns that run at the same time on this machine: cron, auto review and manual chat.'],
          ['Agents at once (Cron)', '2', '1–5', 'The part of Turns at once that cron and auto review may use.'],
        ]} />
        <p>Example: Turns at once 4 and Agents at once 2 means 2 slots for cron tickets or auto reviews (shared) and the other 2 for manual chat. When Agents at once is larger than Turns at once, Turns at once still applies.</p>
        <p>Subagents inside one session (worker, reviewer, verifier) take no slot, but they still use the Claude account's quota.</p>
      </Section>

      <Section id="review" title="C. Reviewing a teammate's PR">
        <p>Set it up in <Go to="/settings?section=discord" label="Settings → Discord" onNavigate={onNavigate} />, card <b>Auto review</b>.</p>
        <SettingsBlock rows={[
          ['Review when I say on it', 'off', 'on / off', 'You say "on it" in a pr-review thread → a Review-QRD-xxx session runs in a cron slot. Requires: the "on it" is yours, it is under 72 hours old and said after the setting was turned on, and the PR is still open. An on it said while the workspace was off runs when it starts again. Once per head commit.'],
          ['LGTM when the review is clean', 'off', 'on / off', 'Can be on only when auto review is on. An approve verdict with no open blocker → DOCK runs the same LGTM as the button.'],
        ]} />
        <Flow steps={['on it', 'Review-QRD-xxx', 'verdict', 'clean? LGTM', 'notifies you']} />
        <ul>
          <li><b>Review result</b>: verdict and findings in <Go to="/agents" label="Agents" onNavigate={onNavigate} />; the PR diff with findings on their lines through the <b>Changes</b> button.</li>
          <li><b>LGTM</b>: your Pass label in Jira plus an approve on GitHub. A PR that is already merged only gets the label. Nothing is posted to Discord, so reply in the thread yourself.</li>
          <li><b>Manual review</b>: ask in chat; it uses a chat slot, not a cron slot.</li>
        </ul>
        <p><b>Local QA.</b> Shows only on a DOCK workspace that has <code>qonflo-qa-local</code> (<code>~/qa-local</code>). The <b>QA local</b> card is in the right panel of a ticket session.</p>
        <SettingsBlock rows={[
          ['Run after PR', 'off', 'on / off', 'A ticket built on the cron machine gets a PR → a QA-QRD-xxx session runs: it writes tests from the Jira AC (read only) when none exist, then runs qonflo-qa-local. Once per PR set; a new PR triggers it again.'],
        ]} />
        <Flow steps={['PR', 'QA-QRD-xxx', 'write tests', 'local stack + Playwright', 'LOLOS / REVISION / ESCALATED']} />
        <ul>
          <li><b>Progress</b>: Stack, Login, Tests n/total, Verdict; each TC with its status and video.</li>
          <li><b>Run again</b>: run QA now without waiting for a new PR.</li>
          <li>Nothing is written to Jira, UAT or <code>~/qa</code>; the verdict is only a prediction.</li>
        </ul>
      </Section>

      <Section id="akun" title="D. Claude account">
        <p>In <Go to="/settings?section=claude" label="Settings → Claude account" onNavigate={onNavigate} />. Accounts come from <code className="font-mono text-xs">/cycle</code> on the workspace (a Coder token parameter).</p>
        <SettingsBlock rows={[
          ['Use', '–', 'per account', 'Switch accounts. Applies from the next turn; a turn already running finishes on the old account.'],
          ['Rotate automatically', 'off', 'on / off', 'Move to the next account when the active one reaches the 5h or 7d limit, whichever comes first.'],
          ['Rotate when 5h reaches', '90%', '50–100', ''],
          ['Rotate when 7d reaches', '95%', '50–100', ''],
          ['Back to main when it resets', 'on', 'on / off', 'After an automatic rotation, go back to main once main is under the limit again.'],
          ['Rotate when 5h reaches (%)', '-', '50–100', 'Ultra accounts have no 5-hour window; they rotate only on the 7d limit.'],
        ]} />
        <p>An account's usage is known only while it is in use. An account never used yet reads "no usage seen yet" until its first turn.</p>
      </Section>

      <Section id="awasi" title="E. Watching & when stuck">
        <ul>
          <li><Go to="/sessions" label="Sessions" onNavigate={onNavigate} />: session contents, the workers and tools running, and the stop button.</li>
          <li><Go to="/blackboard" label="Blackboard" onNavigate={onNavigate} />: the agents' working board per ticket. <b>Log</b> holds the execution trail (stage, gate, agent, tool, LGTM); <code className="font-mono text-xs">video-scenario.md</code> holds the video scenario.</li>
          <li>Stuck session: stop the turn in Sessions and send it again, or reset the run in Agents.</li>
        </ul>
      </Section>

      <Section id="discord" title="F. Discord">
        <ul>
          <li><b>Setup</b>: just fill in your Discord user id in <Go to="/settings?section=discord" label="Settings → Discord" onNavigate={onNavigate} />. The bot token, server and the three team forums (bug, UAT, PR) come from the workspace.</li>
          <li><b>Thread flow</b>: Needs you, Your turn, Waiting. "On it" means a claim. The agent can read the thread and the PDF/txt files in it.</li>
          <li><b>"updated" does not move</b>: DOCK only receives events from Discord, with no periodic refresh. When it is quiet, the clock stays still.</li>
          <li>Team forums can be turned off in Channels, not deleted.</li>
        </ul>
      </Section>

      <Section id="workspace" title="G. Workspace & updates">
        <ul>
          <li><b>DOCK code and the kit</b> follow the stable branch through the updater, about every 5 minutes, while the workspace is on.</li>
          <li><b>A new Coder template</b> (for example a Discord bot token) only arrives after you click <b>Update</b> on the workspace page in Coder.</li>
          <li><Go to="/workspace?tab=servers" label="Workspace → Servers" onNavigate={onNavigate} />: run BE/FE per worktree to test or record a video.</li>
          <li>Something looks off: check for an outdated workspace, empty settings, <Go to="/workspace?tab=health" label="Workspace → Health" onNavigate={onNavigate} /> for the chat connection, then report it through the bug icon at the bottom left.</li>
        </ul>
      </Section>

      <Section id="judge" title="H. Retro Judge">
        <p>Judge is a separate agent that reads the transcripts of the sprint's ticket sessions, records what the agent did wrong, and feeds the retro. It never touches tickets or code. Switch it on in <Go to="/settings?section=judge" label="Settings → Judge" onNavigate={onNavigate} />; it is off until you do.</p>
        <Flow steps={['session quiet 30 min', 'queued', '21:00 and DOCK quiet', 'Judge-xxxx', 'findings + grade', 'you answer the day']} />
        <h3 className="mb-2 mt-4 font-semibold text-foreground">What Judge reads</h3>
        <ul>
          <li>Sessions that work on a ticket: Task, Review, QA, and a chat whose first message names a ticket key. Never Plan, Planning, Retro, Judge or a chat without a ticket.</li>
          <li>Your messages and the assistant's in full, tool calls by name with the refused and failed ones, the ticket ledger, the checkpoints, the execution log, Ticket → code coverage, other people's messages in the PR thread after their on it, and Jira status changes.</li>
          <li>A session used again later is read again only from the last judged message; its new findings are added.</li>
        </ul>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">When it runs</h3>
        <p>From 21:00 to 23:30 WIB, and the leftovers from 08:00 to 09:00, one session at a time, only while no chat turn, auto review or cron ticket runs. A run cut off by a shutdown stays queued and is read again from the start; three failures mark it failed. <b>Judge now</b> on the Retro tab runs outside the window. On the sprint's last day at 16:00 the sprint summary waits for the queue until 23:30, then posts Problem and Try lines with the source Judge.</p>
        <SettingsBlock rows={[
          ['Judge', 'off', 'on / off', 'While off, nothing is queued and no Judge session opens.'],
          ['Claude account', 'empty', 'name', 'The account Judge runs on, so it never shares a quota window with work. Empty uses the active account.'],
          ['Windows (WIB)', '21:00–23:30, 08:00–09:00', 'HH:MM', 'Judge starts a session only inside one.'],
          ['Idle minutes', '30', '5–1440', 'A session with no turn for this long is queued; a ticket that moves to PR Review or UAT queues it at once.'],
          ['Answer cutoff', '12:00', 'HH:MM', "A day not confirmed by then on the next day keeps Judge's call."],
        ]} />
        <h3 className="mb-2 mt-4 font-semibold text-foreground">Causes and grade</h3>
        <ul>
          <li><b>Stopped with a way out</b>: a guard or an error, then straight to you without trying the allowed path (the lead, another skill).</li>
          <li><b>Self-inflicted rework</b>: a rerun or fix round caused by the agent's own step.</li>
          <li><b>Misread AC / scope</b>: you corrected the direction, a reviewer named an AC that was not met, or work outside the scope.</li>
          <li><b>Skipped step</b>: a step the skill requires was not run.</li>
          <li><b>Asked instead of looking</b>: a question whose answer is in the repo, the vault, the ticket or memory.</li>
          <li><b>Wrong code</b>: a reviewer blocker, UAT BUG from QA, or red CI after a push.</li>
          <li><b>Environment</b>: the tool or the access really is missing; recorded, not graded.</li>
        </ul>
        <p>Grade per session: <b>A</b> no finding · <b>B</b> minor, you were not involved · <b>C</b> you waited or work was redone · <b>D</b> wrong code reached a reviewer or QA. DOCK computes it; Judge only reports the findings.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">Answering a day</h3>
        <ol>
          <li>Open <Go to="/planning?tab=retro" label="Planning → Retro" onNavigate={onNavigate} />, switch Judge or Both, and pick a day.</li>
          <li>Every finding already carries Judge's call. Flip only what you disagree with to <b>Not a mistake</b>, with a note if it helps; the grade recounts at once.</li>
          <li>Press <b>Confirm</b>. Not answered by noon the next day, Judge's call stands; you can still change it until the sprint sheet is accepted.</li>
        </ol>
        <p>A finding called not a mistake is hidden from the grade and kept as an example: the latest 30 go into every Judge prompt. The grade also shows in the session's side panel, where the flagged messages are framed red, and the Sessions list filters by it.</p>
      </Section>
    </div>
  </Page>
);

export default GuidePage;
