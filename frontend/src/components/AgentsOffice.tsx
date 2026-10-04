import React, { useEffect, useRef, useState } from 'react';
import { OfficeScene } from '../agents/office/OfficeScene';
import type { AgentRun } from '../agents/runs';
import { cn } from '../lib/cn';
import '../agents/office/office.css';

interface AgentsOfficeProps {
  runs: AgentRun[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
}

const AgentsOffice: React.FC<AgentsOfficeProps> = ({ runs, selectedKey, onSelect, className }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const onSelectRef = useRef(onSelect);
  const [failure, setFailure] = useState('');

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    try {
      sceneRef.current = new OfficeScene(host, {
        assetBase: `${import.meta.env.BASE_URL}office`,
        onSelect: (key) => onSelectRef.current(key),
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
  useEffect(() => { sceneRef.current?.setSelected(selectedKey); }, [selectedKey]);

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
