type EnrollmentSession = {
  userId: string;
  expiresAt: number;
};

const sessions = new Map<string, EnrollmentSession>();

export function createEnrollmentSession(userId: string, ttlSeconds = 600) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    userId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return { sessionId, expiresInSeconds: ttlSeconds };
}

export function consumeEnrollmentSession(sessionId: string, userId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  sessions.delete(sessionId);

  if (session.userId !== userId) {
    return false;
  }

  return session.expiresAt > Date.now();
}
