import React from 'react';
import { Card } from './ui';

export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4" aria-label="Loading content" role="status">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="flex h-[180px] flex-col justify-between" aria-hidden="true">
          <div className="flex items-center justify-between">
            <div className="h-5 w-20 rounded-xs bg-surface-2" />
            <div className="h-5 w-[60px] rounded-pill bg-surface-2" />
          </div>
          <div className="my-3 h-6 w-[85%] rounded-xs bg-surface-2" />
          <div className="h-4 w-3/5 rounded-xs bg-surface-2" />
        </Card>
      ))}
    </div>
  );
};
