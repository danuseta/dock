import { chatService } from './chat';
import { AgentBridge } from './agents';
import { OrchestratorInputError, orchestratorService } from './orchestrator';

/** The agents bridge wired to the chat bridge's claim and the known DOCK machines. */
export const agentBridge = new AgentBridge(async (machine) => {
  if (!(await orchestratorService.machines()).includes(machine)) throw new OrchestratorInputError('Unknown machine');
  const [state] = await chatService.machinesWithInfo([machine]);
  return { online: state.online, capabilities: state.capabilities };
});

chatService.agentJobs = (machine) => agentBridge.take(machine);
