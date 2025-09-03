// test/mocks/db.ts
import { vi, Mock } from "vitest";
import { db } from "../../db";
import { redisClient } from "../../db/redis";

export const mockDb = {
  insert: () => ({
    values: vi.fn().mockResolvedValue(undefined),
  }),
  select: () => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
  }),
  update: () => ({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }),
  delete: () => ({
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }),
};

export const mockRedis = {
  scan: vi.fn().mockResolvedValue({ cursor: "0", keys: [] }),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  setEx: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
};

// Setup default mocks
export const setupMocks = () => {
  (db.insert as Mock).mockImplementation(mockDb.insert);
  (db.select as Mock).mockImplementation(mockDb.select);
  (db.update as Mock).mockImplementation(mockDb.update);
  (db.delete as Mock).mockImplementation(mockDb.delete);

  Object.entries(mockRedis).forEach(([method, implementation]) => {
    (
      redisClient[method as keyof typeof redisClient] as Mock
    ).mockImplementation(implementation);
  });
};

// Reset all mocks
export const resetMocks = () => {
  vi.clearAllMocks();
  setupMocks();
};
