import React, { useState, useEffect } from 'react';
import { Lock, KeyRound } from 'lucide-react';
import { Button, Card, Dialog } from './ui';
import { cn } from '../lib/cn';

interface PinLockModalProps {
  isOpen: boolean;
  onUnlock: (pin: string) => Promise<boolean>;
}

export const PinLockModal: React.FC<PinLockModalProps> = ({ isOpen, onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNumClick = (num: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + num);
      setError(false);
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  };

  const handleUnlock = async () => {
    if (!pin || pin.length < 4 || loading) return;
    setLoading(true);
    const success = await onUnlock(pin);
    setLoading(false);
    if (success) {
      setPin('');
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  };

  useEffect(() => {
    if (pin.length === 6 && !loading && isOpen) {
      handleUnlock();
    }
  }, [pin, loading, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (pin.length < 6) {
          setPin((prev) => prev + e.key);
          setError(false);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
        setError(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= 4) {
          handleUnlock();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, loading, onUnlock]);

  return (
    <Dialog
      open={isOpen}
      onClose={() => undefined}
      dismissible={false}
      labelledBy="pin-lock-title"
      describedBy="pin-lock-description"
      className="backdrop:bg-black/95 backdrop:backdrop-blur-xl"
    >
      <Card className={cn('w-[380px] max-w-full p-6 text-center shadow-2xl sm:px-6 sm:py-8', error && 'border-status-conflict')}>
        <div className={cn(
          'mx-auto mb-4 grid size-16 place-items-center rounded-lg border border-border-glow bg-surface-2 text-accent',
          error && 'text-status-conflict',
        )}>
          {error ? <Lock size={32} aria-hidden="true" /> : <KeyRound size={32} aria-hidden="true" />}
        </div>

        <h2 id="pin-lock-title" className="text-balance font-display text-xl font-bold">App Locked</h2>
        <p id="pin-lock-description" className="mt-1 mb-4 text-pretty text-sm text-secondary-foreground">
          Enter your Master Passcode PIN to access DOCK.
        </p>

        <div className="mb-6 flex justify-center gap-3" aria-label={`${pin.length} of 6 PIN digits entered`}>
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <span
              key={idx}
              className={cn(
                'size-4 rounded-full border-2 border-accent transition-colors duration-150 ease-out',
                pin.length > idx && 'bg-accent',
                error && 'border-status-conflict',
                error && pin.length > idx && 'bg-status-conflict',
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        {error && (
          <p className="mb-4 font-mono text-xs text-status-conflict" role="alert">
            Incorrect PIN. Try again.
          </p>
        )}

        <div className="mb-6 grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <Button
              key={n}
              onClick={() => handleNumClick(n)}
              className="h-[52px] font-mono text-xl font-bold tabular-nums"
            >
              {n}
            </Button>
          ))}
          <Button className="h-[52px] text-sm" onClick={handleDelete} aria-label="Delete last PIN digit">
            ⌫
          </Button>
          <Button className="h-[52px] font-mono text-xl font-bold tabular-nums" onClick={() => handleNumClick('0')}>
            0
          </Button>
          <Button variant="primary" className="h-[52px]" onClick={handleUnlock} disabled={loading || pin.length < 4}>
            {loading ? '...' : 'Unlock'}
          </Button>
        </div>
      </Card>
    </Dialog>
  );
};
