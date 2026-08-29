export const DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS = 60;
export const MIN_SERVICE_HEALTH_REFRESH_SECONDS = 5;
export const MAX_SERVICE_HEALTH_REFRESH_SECONDS = 86_400;

export const isValidServiceHealthRefreshSeconds = (value: unknown) => {
  const seconds = Number(value);
  return Number.isInteger(seconds)
    && seconds >= MIN_SERVICE_HEALTH_REFRESH_SECONDS
    && seconds <= MAX_SERVICE_HEALTH_REFRESH_SECONDS;
};

export const normalizeServiceHealthRefreshSeconds = (value: unknown) => {
  const seconds = Number(value);
  return isValidServiceHealthRefreshSeconds(seconds) ? seconds : DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS;
};
