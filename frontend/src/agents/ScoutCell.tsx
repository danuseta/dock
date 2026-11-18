import React from 'react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import type { DraftTicket } from './planning';

export const ScoutCell: React.FC<{ ticket: DraftTicket; busy: boolean; onScout: (key: string) => void }> = ({ ticket, busy, onScout }) => {
  if (ticket.scout) return <span className={cn('font-mono text-[0.68rem]', ticket.scout.mode === 'light' ? 'font-bold text-status-merged' : 'text-muted-foreground')} title={ticket.scout.line}>{ticket.scout.repos} · ~{ticket.scout.files} {ticket.scout.files === 1 ? 'file' : 'files'} · {ticket.scout.contractChange ? 'contract change' : 'no contract change'} → {ticket.scout.mode}</span>;
  if (ticket.scoutRunning) return <span className="font-mono text-[0.68rem] text-muted-foreground">Scout running</span>;
  return <Button size="sm" variant="ghost" onClick={() => onScout(ticket.key)} disabled={busy}>Run scout</Button>;
};
