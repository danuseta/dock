import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const heading = (size: string) => ({ children }: { children?: React.ReactNode }) => (
  <p className={`mt-3 mb-1 font-display font-bold first:mt-0 ${size}`}>{children}</p>
);

const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: heading('text-base'),
  h2: heading('text-[0.95rem]'),
  h3: heading('text-sm'),
  h4: heading('text-[0.82rem]'),
  h5: heading('text-[0.82rem]'),
  h6: heading('text-[0.82rem]'),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-hover">{children}</a>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 marker:text-muted-foreground">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-border-glow pl-3 text-secondary-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  pre: ({ children }) => <pre className="my-2 max-w-full min-w-0 overflow-x-auto rounded-sm border border-border bg-surface-0 p-2.5 font-mono text-[0.74rem] leading-snug whitespace-pre">{children}</pre>,
  code: ({ children, className }) => (
    className?.startsWith('language-')
      ? <code className={className}>{children}</code>
      : <code className="rounded-xs bg-surface-2 px-1 py-px font-mono text-[0.76rem] [overflow-wrap:anywhere]">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-sm border border-border">
      <table className="w-full border-collapse text-left text-[0.76rem]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  th: ({ children, style }) => <th style={style} className="border-b border-border px-2.5 py-1.5 font-display font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children, style }) => <td style={style} className="border-t border-border px-2.5 py-1.5 align-top">{children}</td>,
};

const remarkPlugins = [remarkGfm];

/** Claude's reply as formatted text. Raw HTML in the reply is shown as text, never rendered. */
export const Markdown: React.FC<{ text: string }> = React.memo(({ text }) => (
  <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>{text}</ReactMarkdown>
));

Markdown.displayName = 'Markdown';
