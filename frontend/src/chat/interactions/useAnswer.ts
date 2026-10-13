import { useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { ANSWER_CHAT_INTERACTION } from '../../graphql/mutations';
import { settledOutcome, type AnswerVariables, type ChatInteraction, type SettledLine } from './interactions';

export interface AnswerControl {
  busy: boolean;
  error: string;
  submit: (answer: AnswerVariables) => Promise<void>;
}

export function useAnswer(sessionId: string, interaction: ChatInteraction, onSettled: (line: SettledLine) => void): AnswerControl {
  const [answer] = useMutation<{ answerChatInteraction: { state: string } }>(ANSWER_CHAT_INTERACTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);

  const submit = async (variables: AnswerVariables) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await answer({ variables: { sessionId, id: interaction.id, ...variables } });
      const state = result.data?.answerChatInteraction.state;
      const outcome = state === 'expired' ? settledOutcome(interaction.kind, 'expired') : settledOutcome(interaction.kind, variables.decision);
      onSettled({ id: interaction.id, kind: interaction.kind, title: interaction.title, outcome, at: Date.now() });
    } catch (failure) {
      locked.current = false;
      setBusy(false);
      setError(failure instanceof Error && failure.message ? failure.message : 'The answer could not be sent');
    }
  };

  return { busy, error, submit };
}
