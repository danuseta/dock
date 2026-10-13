/** The width at and below which DOCK lays itself out for a phone. The same number as the `max-[760px]:` classes and the phone rules in index.css. */
export const PHONE_QUERY = '(max-width: 760px)';

export const isPhone = (): boolean => window.matchMedia(PHONE_QUERY).matches;
