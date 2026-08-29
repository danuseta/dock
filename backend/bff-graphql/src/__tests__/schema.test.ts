import test from 'node:test';
import assert from 'node:assert';
import { buildASTSchema } from 'graphql';
import { typeDefs } from '../schema/typeDefs';
import { resolvers } from '../resolvers';

test('🛡️ [BFF GraphQL] Schema & Resolver Integrity Verification', async (t) => {
  await t.test('should define valid GraphQL type definitions containing essential DOCK domain types', () => {
    assert.ok(typeDefs, 'typeDefs must not be null or undefined');
    const schemaStr = typeDefs.loc?.source.body || JSON.stringify(typeDefs);
    assert.ok(schemaStr.includes('Ticket'), 'Schema must define Ticket GraphQL type');
    assert.ok(schemaStr.includes('description'), 'Ticket type must include Atlassian description field');
    assert.ok(schemaStr.includes('sprintName'), 'Ticket type must include sprintName field');
    assert.ok(schemaStr.includes('PullRequest'), 'Schema must define PullRequest GraphQL type');
    assert.ok(schemaStr.includes('hasConflict'), 'Schema must support conflict check booleans');
  });

  await t.test('should provide complete resolver mapping for queries, mutations, and field resolvers', () => {
    assert.ok(resolvers.Query, 'Query resolvers must be defined');
    assert.ok(typeof resolvers.Query.dashboard === 'function', 'dashboard query resolver must exist');
    assert.ok(resolvers.Ticket, 'Ticket field resolvers must be defined');
    assert.ok(typeof resolvers.Ticket.pullRequests === 'function', 'Ticket.pullRequests resolver must exist');
    assert.strictEqual(
      resolvers.MonitorTarget.lastCheckedAt({ lastCheckedAt: new Date('2026-08-27T00:00:00.000Z') }),
      '2026-08-27T00:00:00.000Z',
    );
  });

  await t.test('should preserve the public query and mutation contract during shell consolidation', () => {
    const schema = buildASTSchema(typeDefs);
    const queryFields = Object.keys(schema.getQueryType()?.getFields() || {}).sort();
    const mutationFields = Object.keys(schema.getMutationType()?.getFields() || {}).sort();

    assert.deepStrictEqual(queryFields, [
      'authStatus',
      'calendarEvents',
      'dashboard',
      'githubRepos',
      'jiraProjects',
      'monitors',
      'needsAttention',
      'quickLinks',
      'settings',
      'ticketDetail',
    ]);
    assert.deepStrictEqual(mutationFields, [
      'addMonitor',
      'addQuickLink',
      'changeMasterPin',
      'checkConflicts',
      'checkMonitors',
      'disconnectGoogleCalendar',
      'lockSession',
      'refreshData',
      'removeMasterPin',
      'removeMonitor',
      'removeQuickLink',
      'saveDemoLink',
      'sendToDiscord',
      'setMasterPin',
      'updateMonitor',
      'updateSettings',
      'validateDiscord',
      'validateGitHub',
      'validateJira',
      'verifyMasterPin',
    ]);
  });
});
