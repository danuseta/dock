/** Jira labels ending in Pass name who approved the ticket, such as alvinPass; they show as written. */
export const getPassLabels = (labels: string[] = []) => [...new Set(labels
  .map((label) => label.trim())
  .filter((label) => label.length > 4 && /pass$/i.test(label)))];
