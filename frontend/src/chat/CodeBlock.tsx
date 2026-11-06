import type { Components } from 'react-markdown';
import { CopyButton } from './CopyButton';

interface HastNode { type?: string; value?: string; children?: HastNode[] }

export const codeText = (node: HastNode | undefined): string => {
  const walk = (current: HastNode): string => (current.type === 'text' ? current.value ?? '' : (current.children ?? []).map(walk).join(''));
  return (node ? walk(node) : '').replace(/\n$/, '');
};

export const COPY_CODE: Components = {
  pre: ({ node, children }) => (
    <div className="group/code relative my-2 max-w-full min-w-0">
      <pre className="max-w-full min-w-0 rounded-sm border border-border bg-surface-0 p-2.5 pr-16 font-mono max-[900px]:min-h-12 text-[0.74rem] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere] [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[length:inherit]">{children}</pre>
      <CopyButton text={codeText(node as HastNode | undefined)} label="Copy code" className="absolute right-1 top-1 mt-0 bg-surface-0" />
    </div>
  ),
};
