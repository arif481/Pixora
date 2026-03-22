export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getThresholds() {
  return {
    autoShare: Number(process.env.AUTO_SHARE_THRESHOLD ?? 0.62),
    reviewMin: Number(process.env.REVIEW_MIN_THRESHOLD ?? 0.48),
  };
}
