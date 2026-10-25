import React, { useState, useEffect } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { Button, Card } from './ui';
import { cn } from '../lib/cn';
import { pinStepOutcome } from '../lib/setPin';

interface SetPinScreenProps {
  onSave: (pin: string) => Promise<boolean>;
}

export const SetPinScreen: React.FC<SetPinScreenProps> = ({ onSave }) => {
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const add = (num: string) => {
    if (loading) return;
    setPin((prev) => (prev.length < 6 ? prev + num : prev));
    setError('');
  };

  const remove = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const submit = async () => {
    if (loading) return;
    const outcome = pinStepOutcome(first, pin);
    if (outcome === 'short') return;
    if (outcome === 'confirm') {
      setFirst(pin);
      setPin('');
      return;
    }
    if (outcome === 'mismatch') {
      setFirst('');
      setPin('');
      setError('PINs do not match. Start again.');
      return;
    }
    setLoading(true);
    const saved = await onSave(pin);
    if (!saved) {
      setLoading(false);
      setFirst('');
      setPin('');
      setError('Could not save the PIN. Try again.');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        add(e.key);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        remove();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const confirming = Boolean(first);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className={cn('w-[380px] max-w-full p-6 text-center shadow-2xl sm:px-6 sm:py-8', error && 'border-status-conflict')}>
        <div className={cn(
          'mx-auto mb-4 grid size-16 place-items-center rounded-lg border border-border-glow bg-surface-2 text-accent',
          error && 'text-status-conflict',
        )}>
          {error ? <Lock size={32} aria-hidden="true" /> : <KeyRound size={32} aria-hidden="true" />}
        </div>

        <h1 className="text-balance font-display text-xl font-bold">Set PIN</h1>
        <p className="mt-1 mb-4 text-pretty text-sm text-secondary-foreground">
          {confirming ? 'Enter the PIN again to confirm.' : 'Choose a 4 to 6 digit PIN to protect this DOCK.'}
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
            {error}
          </p>
        )}

        <div className="mb-6 grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <Button key={n} onClick={() => add(n)} className="h-[52px] font-mono text-xl font-bold tabular-nums">
              {n}
            </Button>
          ))}
          <Button className="h-[52px] text-sm" onClick={remove} aria-label="Delete last PIN digit">
            ⌫
          </Button>
          <Button className="h-[52px] font-mono text-xl font-bold tabular-nums" onClick={() => add('0')}>
            0
          </Button>
          <Button variant="primary" className="h-[52px]" onClick={() => void submit()} disabled={loading || pin.length < 4}>
            {loading ? '...' : confirming ? 'Save' : 'Next'}
          </Button>
        </div>
      </Card>
    </main>
  );
};
