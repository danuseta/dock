import { useId, type ReactNode } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before an action that cannot be undone, in DOCK's own dialog instead of the browser's confirm box. */
export const ConfirmDialog = ({ open, title, description, confirmLabel, busyLabel, busy = false, onConfirm, onCancel }: ConfirmDialogProps) => {
  const id = useId();
  return (
    <Dialog open={open} onClose={() => !busy && onCancel()} dismissible={!busy} labelledBy={`${id}-title`} describedBy={`${id}-description`}>
      <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
        <h2 id={`${id}-title`} className="text-balance font-display text-xl font-bold">{title}</h2>
        <p id={`${id}-description`} className="mt-2 text-pretty text-sm text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>{busy ? busyLabel ?? confirmLabel : confirmLabel}</Button>
        </div>
      </Card>
    </Dialog>
  );
};
