// ZzzEmote is ported from openclaw-office (MIT, (c) 2026 OpenClaw):
// src/components/office-2d/Emotes.tsx. The "?" keeps ErrorEmote's structure
// with DOCK's colour and glyph; the thinking dots are DOCK's own. The keyframes
// they use live in office.css. See frontend/public/third-party-notices.txt.

export const ZZZ_EMOTE = `<svg width="48" height="38" viewBox="-4 -18 30 24" aria-hidden="true">${[0, 1, 2].map((index) => (
  `<text x="${index * 4}" y="${-index * 5}" font-size="${7 + index * 2}" font-weight="700" fill="#94a3b8" font-family="ui-rounded, system-ui" style="animation: dock-zzz-float 2.4s ease-out ${index * 0.8}s infinite; transform-box: fill-box;">z</text>`
)).join('')}</svg>`;

export const ASK_EMOTE = '<svg width="34" height="34" viewBox="-12 -22 24 26" aria-hidden="true"><g style="transform-box: fill-box; transform-origin: center bottom; animation: dock-emote-pop 0.2s ease-out, dock-emote-bounce 0.7s ease-in-out 0.2s infinite;"><g transform="translate(0,-10)"><path d="M 0 -10 L 8.5 5 L -8.5 5 Z" fill="#e8c56c" stroke="#a8862c" stroke-width="1" stroke-linejoin="round" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35))"/><text x="0" y="3.4" text-anchor="middle" font-size="9.5" font-weight="900" fill="#111" font-family="system-ui">?</text></g></g></svg>';

export const THINK_EMOTE = '<svg width="26" height="16" viewBox="-13 -12 26 16" aria-hidden="true"><g style="animation: dock-emote-bob 1.2s ease-in-out infinite; transform-box: fill-box;"><circle cx="-6" r="2.2" fill="#cbd5e1"/><circle cx="0" r="2.2" fill="#cbd5e1"/><circle cx="6" r="2.2" fill="#cbd5e1"/></g></svg>';
