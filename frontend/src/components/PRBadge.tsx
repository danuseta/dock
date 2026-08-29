import React from 'react';
import { Badge, type BadgeVariant } from './ui';
import { cn } from '../lib/cn';

interface PRBadgeProps {
  status: string;
}

export const PRBadge: React.FC<PRBadgeProps> = ({ status }) => {
  const getStatusStyle = (s: string): { variant: BadgeVariant; label: string; dot: string } => {
    switch (s?.toUpperCase()) {
      case 'MERGED':
        return { variant: 'success', label: 'MERGED', dot: 'bg-status-merged' };
      case 'CONFLICT':
        return { variant: 'danger', label: 'CONFLICT', dot: 'bg-status-conflict' };
      case 'DRAFT':
        return { variant: 'draft', label: 'DRAFT', dot: 'bg-status-draft' };
      case 'OPEN':
      default:
        return { variant: 'accent', label: s?.toUpperCase() || 'OPEN', dot: 'bg-status-open' };
    }
  };

  const style = getStatusStyle(status);

  return (
    <Badge variant={style.variant} className="gap-1.5 font-bold uppercase">
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {style.label}
    </Badge>
  );
};
