import { gql } from '@apollo/client';

export const CHAT_COMMANDS = gql`
  query ChatCommands($machine: String!, $query: String, $limit: Int) {
    chatCommands(machine: $machine, query: $query, limit: $limit) {
      name
      description
      argumentHint
      kind
    }
  }
`;

export const CHAT_MACHINE_OPTIONS = gql`
  query ChatMachineOptions($machine: String!) {
    chatMachineOptions(machine: $machine) {
      models {
        value
        label
        efforts
        fast
      }
      modes
      fastAvailable
      defaults {
        model
        effort
        permissionMode
      }
    }
  }
`;
