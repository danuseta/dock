import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { keepCacheOnDevice } from './offline';
import { mergeReliableAssignee } from './queryPolicy';

const graphqlUrl = import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql';

/** Origin of the DOCK server, for the few REST routes that sit beside GraphQL. */
export const apiOrigin = new URL(graphqlUrl, window.location.origin).origin;

const httpLink = createHttpLink({
  uri: graphqlUrl,
  credentials: 'include',
});

const cache = new InMemoryCache({
    typePolicies: {
      Ticket: {
        keyFields: ['key'],
        fields: {
          assignee: { merge: mergeReliableAssignee },
        },
      },
      Orchestration: { keyFields: ['key'] },
      // Agent ids are only unique inside one ticket's run, so they must not be merged across tickets.
      TimelineAgent: { keyFields: false },
    },
});
keepCacheOnDevice(cache);

export const apolloClient = new ApolloClient({ link: httpLink, cache });
