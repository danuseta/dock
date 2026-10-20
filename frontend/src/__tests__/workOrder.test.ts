import assert from 'node:assert';
import test from 'node:test';
import { nextWorkOrder } from '../lib/workOrder';

test('working a ticket next takes one below the lowest numbered To Do ticket', () => {
  const tickets = [
    { key: 'QRD-1', status: 'To Do', workOrder: 4 },
    { key: 'QRD-2', status: 'To Do', workOrder: 6 },
    { key: 'QRD-3', status: 'In Progress', workOrder: 1 },
    { key: 'QRD-4', status: 'To Do', workOrder: null },
  ];
  assert.strictEqual(nextWorkOrder(tickets, 'QRD-9'), 3);
});

test('working a ticket next never goes below 1 and ignores the ticket itself', () => {
  assert.strictEqual(nextWorkOrder([{ key: 'QRD-1', status: 'To Do', workOrder: 1 }], 'QRD-9'), 1);
  assert.strictEqual(nextWorkOrder([{ key: 'QRD-1', status: 'To Do', workOrder: 2 }], 'QRD-1'), 1);
  assert.strictEqual(nextWorkOrder([], 'QRD-1'), 1);
});
