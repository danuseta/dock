export const dayKey = (iso: string) => new Date(iso).toDateString();

export const dayLabel = (iso: string) => {
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
  const month = at.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
  return `${day}, ${at.getDate()} ${month} ${at.getFullYear()}`;
};

export const stamp = (iso: string) => {
  const at = new Date(iso);
  return `${at.getDate()} ${at.toLocaleDateString('en-GB', { month: 'short' })} ${at.getFullYear()} ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
};

export const dateTime = (iso: string, now: Date = new Date()) => {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return at.toDateString() === now.toDateString() ? `Today ${time}` : `${at.getDate()} ${at.toLocaleDateString('en-GB', { month: 'short' })} ${time}`;
};
