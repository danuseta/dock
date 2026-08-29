import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  labelledBy: string;
  describedBy?: string;
}

export const Dialog = ({
  open,
  onClose,
  children,
  className,
  dismissible = true,
  labelledBy,
  describedBy,
}: DialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (dismissible && event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={cn(
        'm-auto max-h-dvh max-w-full overflow-visible border-0 bg-transparent p-4 text-foreground outline-none backdrop:bg-black/85 backdrop:backdrop-blur-md',
        className,
      )}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={handleBackdropClick}
    >
      {children}
    </dialog>
  );
};
