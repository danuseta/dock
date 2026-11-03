export const LGTM_CONFIRM = {
  description: 'DOCK adds your Jira Pass label to the reviewed ticket and submits an Approve review on each of its pull requests on GitHub. The review run then moves to done.',
};

export const lgtmResult = (key: string, steps: { name: string; ok: boolean; detail: string }[]): { message: string; type: 'success' | 'error' } => {
  const failed = steps.filter((step) => !step.ok);
  return failed.length
    ? { message: `${failed.length} of ${steps.length} steps failed: ${failed.map((step) => `${step.name} (${step.detail})`).join('; ')}`, type: 'error' }
    : { message: `LGTM sent for ${key}: Jira Pass label added and the pull requests approved.`, type: 'success' };
};
