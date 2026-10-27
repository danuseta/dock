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
  <p className="flex flex-wrap items-center gap-1.5 font-mono text-[0.72rem] text-secondary-foreground">
    {steps.map((step, index) => <React.Fragment key={step}>{index > 0 && <ArrowRight size={12} className="text-muted-foreground" aria-hidden="true" />}<span className="rounded-xs border border-border bg-surface-1 px-1.5 py-0.5">{step}</span></React.Fragment>)}
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
] as const;

/** How DOCK works day to day: the flows, the settings that steer them, their defaults and limits. */
const GuidePage: React.FC<GuidePageProps> = ({ onNavigate }) => (
  <Page width="medium">
    <header className="mb-6">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><BookOpen size={14} aria-hidden="true" />HOW TO USE</p>
      <h1 className="font-display text-3xl font-bold">Tata kerja DOCK</h1>
      <p className="mt-2 text-sm text-muted-foreground">Alur kerja tiket, review, dan agent di DOCK, setting yang mengaturnya, berikut default dan batasnya.</p>
      <nav aria-label="Isi" className="mt-4 flex flex-wrap gap-2">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-pill border border-border px-3 py-1 text-xs text-secondary-foreground hover:border-border-glow hover:text-foreground">{label}</a>)}
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
          ['Usage brake (%)', '70', '0–100', 'Kalau usage 5 jam sudah segini, cron berhenti memulai tiket baru.'],
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
      </Section>

      <Section id="akun" title="D. Akun Claude">
        <p>Di <Go to="/settings?section=claude" label="Settings → Claude account" onNavigate={onNavigate} />. Akun berasal dari <code className="font-mono text-xs">/cycle</code> di workspace (parameter token Coder).</p>
        <SettingsBlock rows={[
          ['Use', '–', 'per akun', 'Pindah akun. Berlaku untuk giliran berikutnya; giliran yang sedang jalan selesai di akun lama.'],
          ['Rotate automatically', 'off', 'on / off', 'Pindah ke akun berikutnya kalau akun aktif melewati batas.'],
          ['Rotate when 5h reaches', '90%', '50–100', ''],
          ['Rotate when 7d reaches', '95%', '50–100', ''],
          ['Back to main when it resets', 'on', 'on / off', 'Setelah rotasi otomatis, kembali ke main begitu main di bawah batas lagi.'],
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
    </div>
  </Page>
);

export default GuidePage;
