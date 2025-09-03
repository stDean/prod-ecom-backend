import { Request, Response } from "express";
import { vi } from "vitest";

/**
 * Creates a mock Express Request object for testing controllers
 *
 * @param overrides - Partial properties to override default empty request
 * @returns Mocked Request object with type safety
 *
 * Usage:
 * const req = mockRequest(); // Basic empty request
 * const reqWithBody = mockRequest({ body: { id: 123 } });
 * const reqWithParams = mockRequest({ params: { userId: 'abc' } });
 */
export const mockRequest = (overrides: Partial<Request> = {}): Request => {
  return {
    ...overrides, // Merge any provided overrides
  } as unknown as Request; // TypeScript workaround for Express type complexity
};

/**
 * Creates a mock Express Response object with Jest spies
 *
 * Features:
 * - Chainable status().json() methods
 * - Full Jest spy capabilities
 * - Isolated instances for test safety
 *
 * @returns Mocked Response object with spy methods
 *
 * Usage:
 * const res = mockResponse();
 * controller(req, res);
 * expect(res.status).toHaveBeenCalledWith(200);
 * expect(res.json).toHaveBeenCalledWith({ message: 'Success' });
 */
export const mockResponse = (): Response => {
  const res: any = {}; // Temporary container

  // Mock status() method that returns response for chaining
  res.status = vi.fn().mockReturnValue(res);

  // Mock json() method that returns response for chaining
  res.json = vi.fn().mockReturnValue(res);

  // Add other Express methods as needed:
  // res.send = jest.fn().mockReturnValue(res);
  // res.sendStatus = jest.fn().mockReturnValue(res);

  return res as unknown as Response; // Cast to Express Response type
};
