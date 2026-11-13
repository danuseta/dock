// The planning chat of Agents > Sprint > Planning: the DOCK chat session titled Planning-<sprint>, opened with a first
// message that runs the kit skill sprint-planner. The button opens it in the floating ChatDock; the agent changes the
// draft through the ingest routes and the panel polls that draft. Its open questions are asked and answered there.
import React from 'react';
import { MessagesSquare } from 'lucide-react';
import { Button } from '../components/ui';
import { useOpenPlanningChat } from './usePlanningChat';

export const PlanningChat: React.FC<{ sprint: string }> = ({ sprint }) => {
  const { title, open, opening, error } = useOpenPlanningChat(sprint);
  return (
    <>
      <Button onClick={() => void open()} disabled={opening} title={title}>
        <MessagesSquare size={14} aria-hidden="true" />{opening ? 'Opening...' : 'Open planning chat'}
      </Button>
      {error && <p className="basis-full text-sm text-status-conflict" role="alert">{error}</p>}
    </>
  );
};
