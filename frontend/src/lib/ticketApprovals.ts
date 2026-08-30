export const getApprovalLabels = (labels: string[] = []) => [...new Set(labels
  .filter((label) => /pass$/i.test(label.trim()))
  .map((label) => {
    const approver = label.trim().replace(/pass$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
    return `${approver.toUpperCase()} APPROVED`;
  })
  .filter((label) => label !== ' APPROVED'))];
