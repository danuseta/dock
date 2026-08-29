import test from 'node:test';
import assert from 'node:assert';
import { JiraService } from '../services/jira.service';

test('📋 [Jira Service] ADF Description & Sprint Field Parsing Verification', async (t) => {
  const service = new JiraService();

  await t.test('should extract plain text from complex Atlassian Document Format (ADF) description objects', () => {
    const mockIssue = {
      key: 'QRD-101',
      fields: {
        summary: 'Implement Kanban drag drop board',
        status: { name: 'IN PROGRESS' },
        assignee: { displayName: 'Danoegia Developer' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'heading',
              content: [{ type: 'text', text: 'Task Overview' }]
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'This is a detailed Jira description' },
                { type: 'text', text: ' parsed from ADF JSON format without crashing.' }
              ]
            }
          ]
        }
      }
    };

    const formatted = service.formatTicket(mockIssue, 'mysales.atlassian.net');

    assert.ok(formatted, 'Formatted ticket object should not be null');
    assert.strictEqual(formatted?.key, 'QRD-101');
    assert.strictEqual(formatted?.title, 'Implement Kanban drag drop board');
    assert.strictEqual(formatted?.status, 'IN PROGRESS');
    assert.strictEqual(formatted?.assignee, 'Danoegia Developer');
    assert.strictEqual(formatted?.url, 'https://mysales.atlassian.net/browse/QRD-101');

    // Verify ADF text was cleanly extracted and combined
    assert.ok(formatted?.description?.includes('Task Overview'), 'Should include heading text');
    assert.ok(formatted?.description?.includes('This is a detailed Jira description'), 'Should include first paragraph segment');
    assert.ok(formatted?.description?.includes('parsed from ADF JSON format without crashing'), 'Should include second paragraph segment');
  });

  await t.test('should parse custom Atlassian Greenhopper sprint field metadata correctly', () => {
    const mockIssueWithSprint = {
      key: 'QRD-205',
      fields: {
        summary: 'Fix OAuth callback token loop',
        status: { name: 'UAT CHECK' },
        customfield_10020: [
          {
            id: 21,
            name: 'SPRINT QRD 21',
            state: 'active',
            startDate: '2026-08-01T00:00:00.000Z',
            endDate: '2026-08-15T00:00:00.000Z'
          }
        ]
      }
    };

    const formatted = service.formatTicket(mockIssueWithSprint, 'mysales.atlassian.net');
    assert.strictEqual(formatted?.sprintName, 'SPRINT QRD 21');
    assert.strictEqual(formatted?.sprintState, 'ACTIVE');
  });

  await t.test('should return default fallback string when no description is present', () => {
    const mockEmpty = {
      key: 'QRD-300',
      fields: {
        summary: 'No description ticket',
        status: { name: 'TODO' }
      }
    };

    const formatted = service.formatTicket(mockEmpty, 'mysales.atlassian.net');
    assert.strictEqual(formatted?.description, 'No detailed description provided in this Jira issue.');
    assert.strictEqual(formatted?.sprintName, 'No Sprint');
  });
});
