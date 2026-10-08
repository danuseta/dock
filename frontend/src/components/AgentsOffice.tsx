import React, { useEffect, useRef, useState } from 'react';
import { OfficeScene } from '../agents/office/OfficeScene';
import type { AgentRun } from '../agents/runs';
import type { TicketBalloon } from '../chat/messages';
import { cn } from '../lib/cn';
import '../agents/office/office.css';

interface AgentsOfficeProps {
  runs: AgentRun[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  balloons?: TicketBalloon[];
  onBalloon?: (sessionId: string) => void;
  view?: string;
  viewTick?: number;
  className?: string;
}

const AgentsOffice: React.FC<AgentsOfficeProps> = ({ runs, selectedKey, onSelect, balloons, onBalloon, view = 'overview', viewTick = 0, className }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const onSelectRef = useRef(onSelect);
  const [failure, setFailure] = useState('');

  const onBalloonRef = useRef(onBalloon);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onBalloonRef.current = onBalloon; }, [onBalloon]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    try {
      sceneRef.current = new OfficeScene(host, {
        assetBase: `${import.meta.env.BASE_URL}office`,
        onSelect: (key) => onSelectRef.current(key),
        onBalloon: (sessionId) => onBalloonRef.current?.(sessionId),
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'WebGL is unavailable');
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => { sceneRef.current?.setRuns(runs); }, [runs]);
  useEffect(() => { sceneRef.current?.setBalloons(balloons || []); }, [balloons]);
  useEffect(() => { sceneRef.current?.setSelected(selectedKey); }, [selectedKey]);
  useEffect(() => { sceneRef.current?.setView(view); }, [view, viewTick]);

  return (
    <div ref={hostRef} className={cn('dock-office', className)} role="img" aria-label="3D office showing where each ticket's agent is working">
      {failure && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-secondary-foreground" role="alert">
          The 3D office could not start ({failure}). The table view shows the same tickets.
        </div>
      )}
    </div>
  );
};

export default AgentsOffice;
