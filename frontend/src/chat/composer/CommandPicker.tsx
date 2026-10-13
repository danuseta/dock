import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { optionId, type ChatCommand } from './composerLogic';

interface CommandPickerProps {
  id: string;
  commands: ChatCommand[];
  loading: boolean;
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (command: ChatCommand) => void;
}

export const CommandPicker: React.FC<CommandPickerProps> = ({ id, commands, loading, highlight, onHighlight, onPick }) => {
  const active = useRef<HTMLLIElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' });
  }, [highlight, commands]);

  if (commands.length === 0) {
    return <p className="rounded-sm border border-border bg-surface-1 px-3 py-2 font-mono text-[0.68rem] text-muted-foreground" role="status">{loading ? 'Loading commands...' : 'No command matches. Enter sends the text as it is.'}</p>;
  }
  return (
    <ul id={id} role="listbox" aria-label="Commands and skills" className="max-h-[min(14rem,35dvh)] overflow-y-auto overscroll-contain rounded-sm border border-border bg-surface-1 p-1">
      {commands.map((command, index) => (
        <li
          key={`${command.kind}-${command.name}`}
          id={optionId(id, index)}
          ref={index === highlight ? active : undefined}
          role="option"
          aria-selected={index === highlight}
          className={cn('flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-xs px-2.5 py-1', index === highlight && 'bg-surface-hover')}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => index !== highlight && onHighlight(index)}
          onClick={() => onPick(command)}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate font-mono text-[0.78rem] font-bold text-foreground">/{command.name}</span>
            {command.kind === 'skill' && <span className="flex-none rounded-xs border border-border px-1 font-mono text-[0.58rem] text-muted-foreground">skill</span>}
          </span>
          {command.description && <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground">{command.description}</span>}
        </li>
      ))}
    </ul>
  );
};
