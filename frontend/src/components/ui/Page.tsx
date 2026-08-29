import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type PageWidth = 'medium' | 'wide' | 'full';

const widths: Record<PageWidth, string> = {
  medium: 'max-w-[1100px]',
  wide: 'max-w-[1400px]',
  full: 'max-w-[1680px]',
};

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageWidth;
}

export const Page = forwardRef<HTMLDivElement, PageProps>(({ className, width = 'wide', ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mx-auto w-full px-8 pt-6 pb-12 max-[1023px]:px-4 max-[1023px]:pt-4', widths[width], className)}
    {...props}
  />
));

Page.displayName = 'Page';

export const PageHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <header ref={ref} className={cn('mb-6 flex flex-wrap items-center justify-between gap-4', className)} {...props} />
));

PageHeader.displayName = 'PageHeader';
