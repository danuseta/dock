export const getApprovalLabels = (labels: string[] = []) => [...new Set(labels
  .filter((label) => label.toLowerCase().includes('pass'))
  .map((label) => label.replace(/[-_]+/g, ' ').trim().toUpperCase()))];
