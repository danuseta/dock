import React from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  md: 'size-10 rounded-[10px] text-sm',
  lg: 'size-20 rounded-[18px] text-2xl',
} as const;

/** An agent's avatar at library size: the image when there is one, else its initials on its colour. */
export const LookAvatar: React.FC<{ initials: string; color: string; src?: string | null; size: keyof typeof SIZES }> = ({ initials, color, src, size }) => (
  <span aria-hidden="true" className={cn('grid flex-none place-items-center overflow-hidden font-mono font-extrabold text-background', SIZES[size])} style={{ background: color }}>
    {src ? <img src={src} alt="" className="size-full object-cover" /> : initials}
  </span>
);
