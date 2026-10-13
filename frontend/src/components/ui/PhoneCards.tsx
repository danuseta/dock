import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Wraps a table. Above 760 px it only lets the table scroll sideways, as tables here always did. On a phone each row
 * becomes a card: the first cell is the card's title and every other cell is a line "column name, value". The names
 * are read from the table's own header after each render, so a table needs no changes to be used here. The card
 * styles are the `.phone-cards` rules in index.css.
 */
export const PhoneCards = ({ className, children }: { className?: string; children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const table = ref.current?.querySelector('table');
    if (!table) return;
    const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim() ?? '');
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, index) => cell.setAttribute('data-label', labels[index] ?? ''));
    }
  });

  return <div ref={ref} className={cn('phone-cards overflow-x-auto', className)}>{children}</div>;
};
