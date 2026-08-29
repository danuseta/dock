import React from 'react';

export const EmptyStateIllustration: React.FC = () => {
  return (
    <svg
      className="mx-auto mb-5 h-[180px] w-60"
      viewBox="0 0 300 220" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Background soft glow / grid floor */}
      <ellipse cx="150" cy="195" rx="90" ry="12" fill="oklch(0.20 0.05 250 / 0.5)" />
      <circle cx="150" cy="110" r="75" fill="oklch(0.75 0.10 140 / 0.05)" />

      {/* Center Kanban Dashboard Clipboard */}
      <rect x="70" y="35" width="160" height="135" rx="12" fill="var(--color-surface-1)" stroke="var(--color-border)" strokeWidth="3" />
      <rect x="85" y="55" width="40" height="95" rx="6" fill="var(--color-surface-0)" stroke="var(--color-border)" strokeWidth="1.5" />
      <rect x="130" y="55" width="40" height="95" rx="6" fill="var(--color-surface-0)" stroke="var(--color-border)" strokeWidth="1.5" />
      <rect x="175" y="55" width="40" height="95" rx="6" fill="var(--color-surface-0)" stroke="var(--color-border)" strokeWidth="1.5" />

      {/* Mini Cards inside Kanban Columns */}
      <rect x="91" y="65" width="28" height="22" rx="4" fill="var(--color-surface-2)" />
      <rect x="91" y="93" width="28" height="16" rx="4" fill="var(--color-surface-2)" />
      <rect x="136" y="65" width="28" height="30" rx="4" fill="oklch(0.78 0.17 250 / 0.2)" stroke="var(--color-accent)" strokeWidth="1" />

      {/* Success Done Column with glowing Checkmark Card */}
      <rect x="181" y="65" width="28" height="40" rx="4" fill="oklch(0.75 0.14 150 / 0.2)" stroke="#48BB78" strokeWidth="1.5" />
      <path d="M189 85 L193 89 L202 79" stroke="#48BB78" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Decorative Floating Elements (Code Blocks & Sparkle Stars) */}
      <g transform="translate(25, 45)">
        <rect x="0" y="0" width="42" height="36" rx="8" fill="var(--color-surface-2)" stroke="var(--color-border)" strokeWidth="1.5" transform="rotate(-12)" />
        <circle cx="12" cy="12" r="3" fill="#ED8936" />
        <path d="M12 22 H28" stroke="var(--color-muted-foreground)" strokeWidth="2" strokeLinecap="round" transform="rotate(-12)" />
      </g>
      
      <g transform="translate(235, 100)">
        <rect x="0" y="0" width="45" height="38" rx="8" fill="var(--color-surface-2)" stroke="var(--color-border)" strokeWidth="1.5" transform="rotate(10)" />
        <circle cx="15" cy="15" r="4" fill="#63B3ED" />
        <path d="M15 25 H32" stroke="var(--color-muted-foreground)" strokeWidth="2" strokeLinecap="round" transform="rotate(10)" />
      </g>

      {/* Sparkles / Zero Bugs Badge */}
      <path d="M60 150 L63 158 L71 161 L63 164 L60 172 L57 164 L49 161 L57 158 Z" fill="#68D391" opacity="0.8" />
      <path d="M230 40 L232 45 L237 47 L232 49 L230 54 L228 49 L223 47 L228 45 Z" fill="var(--color-accent)" opacity="0.8" />
      <circle cx="215" cy="170" r="5" fill="#B794F4" opacity="0.7" />
    </svg>
  );
};
