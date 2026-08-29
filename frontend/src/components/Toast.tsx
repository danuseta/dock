import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { IconButton } from './ui';
import { cn } from '../lib/cn';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

const toastStyles = {
  success: { Icon: CheckCircle2, container: 'border-status-merged', icon: 'text-status-merged' },
  error: { Icon: AlertTriangle, container: 'border-status-conflict', icon: 'text-status-conflict' },
  info: { Icon: Info, container: 'border-accent', icon: 'text-accent' },
} as const;

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const style = toastStyles[type];
  const IconComponent = style.Icon;

  return (
    <div
      className={cn(
        'fixed top-[max(24px,env(safe-area-inset-top))] left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-pill border bg-surface-1 py-3 pr-2 pl-6 font-display text-sm font-semibold text-foreground shadow-xl',
        style.container,
      )}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <IconComponent className={style.icon} size={18} aria-hidden="true" />
      <span className="text-pretty">{message}</span>
      <IconButton variant="ghost" className="ml-2 size-8" onClick={onClose} aria-label="Dismiss notification">
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
};
