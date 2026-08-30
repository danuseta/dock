import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { mergeReliableAssignee } from './queryPolicy';

const httpLink = createHttpLink({
  uri: import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql',
  credentials: 'include',
});

export const apolloClient = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache({
    typePolicies: {
      Ticket: {
        keyFields: ['key'],
        fields: {
          assignee: { merge: mergeReliableAssignee },
        },
      },
    },
  }),
});
