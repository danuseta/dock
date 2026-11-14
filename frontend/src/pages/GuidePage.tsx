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
        <tr><th className="px-3 py-2">Setting</th><th className="px-3 py-2">Default</th><th className="px-3 py-2">Batas</th><th className="px-3 py-2">Artinya</th></tr>
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
  ['tiket', 'Ngerjain tiket'],
  ['slot', 'Slot & kapasitas'],
  ['review', 'Review PR teman'],
  ['akun', 'Akun Claude'],
  ['awasi', 'Ngawasin & kalau macet'],
  ['discord', 'Discord'],
  ['workspace', 'Workspace & update'],
  ['judge', 'Retro Judge'],
] as const;

/** How DOCK works day to day: the flows, the settings that steer them, their defaults and limits. */
const GuidePage: React.FC<GuidePageProps> = ({ onNavigate }) => (
  <Page width="medium">
    <header className="mb-6">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><BookOpen size={14} aria-hidden="true" />HOW TO USE</p>
      <h1 className="font-display text-3xl font-bold">Tata kerja DOCK</h1>
      <p className="mt-2 text-sm text-muted-foreground">Alur kerja tiket, review, dan agent di DOCK, setting yang mengaturnya, berikut default dan batasnya.</p>
      <nav aria-label="Isi" className="mt-4 flex flex-wrap gap-2 max-[760px]:flex-nowrap max-[760px]:overflow-x-auto">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-pill border border-border px-3 py-1 text-xs max-[760px]:flex max-[760px]:min-h-11 max-[760px]:shrink-0 max-[760px]:items-center max-[760px]:whitespace-nowrap max-[760px]:px-4 text-secondary-foreground hover:border-border-glow hover:text-foreground">{label}</a>)}
      </nav>
    </header>

    <div className="flex flex-col gap-8 text-sm leading-relaxed text-secondary-foreground">
      <Section id="tiket" title="A. Ngerjain tiket">
        <h3 className="mb-2 font-semibold text-foreground">1. Cron: tiket jalan sendiri</h3>
        <p>Buka <Go to="/agents" label="Agents" onNavigate={onNavigate} />, tombol <b>Cron</b>, nyalakan. Tiap menit di jam kerja, cron mengambil tiket To Do dari sprint aktif dan membuka sesi <code className="font-mono text-xs">Task-QRD-xxx</code>.</p>
        <Flow steps={['To Do', 'cron ambil', 'Task-QRD-xxx', 'plan', 'kode', 'review', 'video', 'PR']} />
        <SettingsBlock rows={[
          ['Agents at once', '2', '1–5', 'Tiket cron (termasuk auto review) yang jalan bersamaan. Chat manual tidak dihitung di sini.'],
          ['New tickets per day', '6', '1–50', 'Tiket baru yang dimulai per hari (WIB). Angka yang sama juga batas tiket yang diparkir.'],
          ['From hour / Until hour', '9 / 17', '0–24 WIB', 'Di luar jam ini cron tidak memulai tiket baru; yang sudah jalan tetap selesai.'],
          ['Work days', 'Sen–Jum', '1–7', 'Hari cron boleh memulai tiket.'],
          ['Active from / until', 'kosong', 'tanggal', 'Opsional: cron hanya aktif di rentang tanggal ini.'],
          ['Tickets from', 'active sprint', 'active / any', 'Sprint yang diambil.'],
          ['Jira statuses to pick up', 'To Do', 'daftar', 'Status Jira yang dianggap siap dikerjakan.'],
          ['Move a started ticket to', 'In Progress', 'status', 'Status Jira setelah tiket mulai.'],
          ['Usage brake (%)', '70', '0–100', 'Kalau usage 5 jam sudah segini, cron berhenti memulai tiket baru. Akun Ultra tidak punya window 5 jam, jadi batas ini dilewati.'],
          ['Weekly brake (%)', '90', '0–100', 'Kalau usage 7 hari sudah segini, cron berhenti memulai tiket baru.'],
        ]} />
        <h3 className="mb-2 mt-4 font-semibold text-foreground">2. Tiket manual</h3>
        <p>Buka sesi dari chat panel atau dari tiket. Bedanya dengan cron: sesi manual berhenti di <b>gate</b> dan bertanya dulu sebelum menulis kode; cron jalan terus tanpa bertanya kalau AC tiketnya lengkap. Tiket tanpa AC diparkir dan menunggu kamu.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">3. Urutan & dependency</h3>
        <p>Di <Go to="/dashboard" label="Board" onNavigate={onNavigate} />, atur urutan kerja, tandai tiket <b>manual</b> (cron tidak mengambilnya), dan pasang dependency. Cron mengikuti urutan itu dan melewati tiket yang dependency-nya belum selesai.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">4. Agent bertanya</h3>
        <p>Pertanyaan agent masuk sebagai notifikasi dan muncul di <Go to="/decisions" label="Decisions" onNavigate={onNavigate} /> serta Agents. Jawabanmu masuk antrean paling depan dan mengambil slot pertama yang kosong.</p>
        <h3 className="mb-2 mt-4 font-semibold text-foreground">5. Selesai</h3>
        <p>Tiket selesai dengan PR terbuka (draft kalau diminta), video demo di Demo Videos, status Jira bergeser, dan run di Agents jadi Done.</p>
      </Section>

      <Section id="slot" title="B. Slot & kapasitas">
        <SettingsBlock rows={[
          ['Turns at once (Settings → Chat)', '3', '1–6', 'Batas total giliran yang jalan bersamaan di mesin ini: cron, auto review, dan chat manual.'],
          ['Agents at once (Cron)', '2', '1–5', 'Bagian dari Turns at once yang boleh dipakai cron dan auto review.'],
        ]} />
        <p>Contoh: Turns at once 4 dan Agents at once 2 berarti 2 slot untuk tiket cron atau auto review (dipakai bergantian) dan 2 slot sisa untuk chat manual. Kalau Agents at once lebih besar dari Turns at once, yang berlaku tetap Turns at once.</p>
        <p>Subagent di dalam satu sesi (worker, reviewer, verifier) tidak memakai slot, tapi tetap memakai kuota akun Claude.</p>
      </Section>

      <Section id="review" title="C. Review PR teman">
        <p>Atur di <Go to="/settings?section=discord" label="Settings → Discord" onNavigate={onNavigate} />, kartu <b>Auto review</b>.</p>
        <SettingsBlock rows={[
          ['Review when I say on it', 'off', 'on / off', 'Kamu bilang "on it" di thread pr-review → sesi Review-QRD-xxx jalan di slot cron. Syarat: "on it" milikmu, umurnya di bawah 6 jam, PR masih open. Sekali per head commit.'],
          ['LGTM when the review is clean', 'off', 'on / off', 'Hanya bisa nyala kalau auto review nyala. Verdict approve tanpa blocker terbuka → DOCK menjalankan LGTM yang sama dengan tombolnya.'],
        ]} />
        <Flow steps={['on it', 'Review-QRD-xxx', 'verdict', 'clean? LGTM', 'notif ke kamu']} />
        <ul>
          <li><b>Hasil review</b>: verdict dan temuan di <Go to="/agents" label="Agents" onNavigate={onNavigate} />; diff PR dengan temuan di barisnya lewat tombol <b>Changes</b>.</li>
          <li><b>LGTM</b>: label Pass-mu di Jira plus approve di GitHub. PR yang sudah merged cukup dapat label. Tidak ada yang diposting ke Discord, jadi balas sendiri di thread.</li>
          <li><b>Review manual</b>: minta lewat chat; memakai slot chat, bukan slot cron.</li>
        </ul>
        <p><b>QA lokal.</b> Hanya muncul di DOCK workspace yang punya <code>qonflo-qa-local</code> (<code>~/qa-local</code>). Kartu <b>QA local</b> ada di panel kanan sesi tiket.</p>
        <SettingsBlock rows={[
          ['Run after PR', 'off', 'on / off', 'Tiket yang dibangun di mesin cron dapat PR → sesi QA-QRD-xxx jalan: tulis tes dari AC Jira (hanya baca) kalau belum ada, lalu qonflo-qa-local. Sekali per set PR; PR baru memicu lagi.'],
        ]} />
        <Flow steps={['PR', 'QA-QRD-xxx', 'tulis tes', 'stack lokal + Playwright', 'LOLOS / REVISION / ESCALATED']} />
        <ul>
          <li><b>Progres</b>: Stack, Login, Tests n/total, Verdict; tiap TC dengan status dan video.</li>
          <li><b>Run again</b>: jalankan QA sekarang tanpa menunggu PR baru.</li>
          <li>Tidak ada yang ditulis ke Jira, UAT, atau <code>~/qa</code>; verdict hanya prediksi.</li>
        </ul>
      </Section>

      <Section id="akun" title="D. Akun Claude">
        <p>Di <Go to="/settings?section=claude" label="Settings → Claude account" onNavigate={onNavigate} />. Akun berasal dari <code className="font-mono text-xs">/cycle</code> di workspace (parameter token Coder).</p>
        <SettingsBlock rows={[
          ['Use', '–', 'per akun', 'Pindah akun. Berlaku untuk giliran berikutnya; giliran yang sedang jalan selesai di akun lama.'],
          ['Rotate automatically', 'off', 'on / off', 'Pindah ke akun berikutnya kalau akun aktif mencapai batas 5h atau batas 7d, mana saja yang lebih dulu.'],
          ['Rotate when 5h reaches', '90%', '50–100', ''],
          ['Rotate when 7d reaches', '95%', '50–100', ''],
          ['Back to main when it resets', 'on', 'on / off', 'Setelah rotasi otomatis, kembali ke main begitu main di bawah batas lagi.'],
          ['Rotate when 5h reaches (%)', '-', '50–100', 'Akun Ultra tidak punya window 5 jam; akun itu hanya dirotasi lewat batas 7d.'],
        ]} />
        <p>Usage sebuah akun hanya diketahui saat akun itu dipakai. Akun yang belum pernah dipakai bertuliskan "no usage seen yet" sampai giliran pertamanya.</p>
      </Section>

      <Section id="awasi" title="E. Ngawasin & kalau macet">
        <ul>
          <li><Go to="/sessions" label="Sessions" onNavigate={onNavigate} />: isi sesi, worker dan tool yang sedang jalan, tombol stop.</li>
          <li><Go to="/blackboard" label="Blackboard" onNavigate={onNavigate} />: papan kerja agent per tiket. <b>Log</b> berisi jejak eksekusi (stage, gate, agent, tool, LGTM); <code className="font-mono text-xs">video-scenario.md</code> berisi skenario video.</li>
          <li>Sesi macet: stop giliran di Sessions lalu kirim ulang, atau reset run di Agents.</li>
        </ul>
      </Section>

      <Section id="discord" title="F. Discord">
        <ul>
          <li><b>Setup</b>: cukup isi user id Discord di <Go to="/settings?section=discord" label="Settings → Discord" onNavigate={onNavigate} />. Bot token, server, dan tiga forum tim (bug, UAT, PR) datang dari workspace.</li>
          <li><b>Alur thread</b>: Needs you, Your turn, Waiting. "On it" berarti klaim. Agent bisa membaca isi thread dan file PDF/txt di dalamnya.</li>
          <li><b>"updated" tidak bergerak</b>: DOCK hanya menerima event dari Discord, tanpa refresh berkala. Kalau sepi, jamnya diam.</li>
          <li>Forum tim bisa dimatikan di Channels, tidak bisa dihapus.</li>
        </ul>
      </Section>

      <Section id="workspace" title="G. Workspace & update">
        <ul>
          <li><b>Kode DOCK dan kit</b> ikut cabang stable lewat updater, kira-kira tiap 5 menit, selama workspace menyala.</li>
          <li><b>Template Coder baru</b> (misalnya token bot Discord) baru masuk setelah klik <b>Update</b> di halaman workspace di Coder.</li>
          <li><Go to="/dev-servers" label="Dev Servers" onNavigate={onNavigate} />: jalankan BE/FE per worktree untuk tes atau rekam video.</li>
          <li>Ada yang aneh: cek workspace outdated, setting yang kosong, <Go to="/machines" label="Health" onNavigate={onNavigate} /> untuk koneksi chat, lalu lapor lewat ikon bug di pojok kiri bawah.</li>
        </ul>
      </Section>

      <Section id="judge" title="H. Retro Judge">
        <p>Judge is a separate agent that reads the transcripts of the sprint's ticket sessions, records what the agent did wrong, and feeds the retro. It never touches tickets or code. Switch it on in <Go to="/settings?section=judge" label="Settings → Judge" onNavigate={onNavigate} />; it is off until you do.</p>
        <Flow steps={['session quiet 30 min', 'queued', '21:00 and DOCK quiet', 'Judge-xxxx', 'findings + grade', 'you answer the day']} />
        <h3 className="mb-2 mt-4 font-semibold text-foreground">What Judge reads</h3>
        <ul>
          <li>Sessions that work on a ticket: Task, Review, QA, and a chat whose first message names a ticket key. Never Plan, Planning, Retro, Judge or a chat without a ticket.</li>
          <li>Your messages and the assistant's in full, tool calls by name with the refused and failed ones, the ticket ledger, the checkpoints, Log eksekusi, Tiket → kode coverage, other people's messages in the PR thread after their on it, and Jira status changes.</li>
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
