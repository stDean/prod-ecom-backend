import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { CartCtrl } from "../../controller/Cart.c";
import { mockRequest, mockResponse } from "../mocks/express";
import { db } from "../../db";
import { mockDb, mockRedis, resetMocks } from "../mocks/db";
import { cartTable } from "../../db/schema";
import { StatusCodes } from "http-status-codes";

// Mock the dependencies
vi.mock("../../db");
vi.mock("../../db/redis");
vi.mock("../../db/schema");

describe("Cart Controller", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("addToCart", () => {
    it("should add item to cart successfully", async () => {
      const cartItem = {
        productId: "123",
        quantity: 2,
        price: "29.99",
        expires_at: "2023-12-31T23:59:59.000Z",
        user_id: "456",
      };

      // Mock the database insert operation
      const mockInsert = mockDb.insert();
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Act
      const req = mockRequest({ body: cartItem });
      const res = mockResponse();
      await CartCtrl.addCartItem(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Product added to cart.",
        cartItem: expect.objectContaining({
          productId: 123,
          quantity: 2,
          price: 29.99,
        }),
      });
      expect(mockRedis.hSet).toHaveBeenCalled();
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it("should return error when required fields are missing", async () => {
      const cartItem = {
        quantity: 2,
        expires_at: "2023-12-31T23:59:59.000Z",
        user_id: "456",
      };

      // Act
      const req = mockRequest({ body: cartItem });
      const res = mockResponse();
      await CartCtrl.addCartItem(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith({
        message: "Product ID and price are required.",
      });
    });
  });

  describe("retrieveCartItems", () => {
    it("should retrieve cart items from Redis when available", async () => {
      const user_id = "456";

      // Mock Redis response
      const redisItems = {
        "123": JSON.stringify({
          productId: 123,
          quantity: 2,
          price: 59.98,
          unit_price: 29.99,
        }),
      };
      mockRedis.hGetAll.mockResolvedValue(redisItems);

      // Act
      const req = mockRequest({ query: { user_id } });
      const res = mockResponse();
      await CartCtrl.retrieveCartItems(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart items retrieved from cache.",
        items: [expect.objectContaining({ productId: 123 })],
        total: 59.98,
        itemCount: 2,
      });
    });

    it("should fall back to database when Redis is empty", async () => {
      const user_id = "456";

      // Mock empty Redis response
      mockRedis.hGetAll.mockResolvedValue({});

      // Mock database response
      const dbItems = [
        {
          productId: 123,
          quantity: 2,
          price: "59.98",
          unit_price: "29.99",
          userId: 456,
          expires_at: new Date(),
          added_at: new Date(),
        },
      ];

      // Create a proper mock for the database select chain
      const mockWhere = vi.fn().mockResolvedValue(dbItems);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

      (db.select as Mock).mockImplementation(mockSelect);

      // Act
      const req = mockRequest({ query: { user_id } });
      const res = mockResponse();
      await CartCtrl.retrieveCartItems(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart items retrieved from database.",
        items: dbItems,
        total: 59.98,
        itemCount: 2,
      });
      expect(mockRedis.hSet).toHaveBeenCalled();
      expect(mockRedis.expire).toHaveBeenCalled();

      // Verify the database query was made correctly
      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith(cartTable);
      expect(mockWhere).toHaveBeenCalledWith(expect.anything()); // The eq condition
    });
  });

  describe("updateCartItem", () => {
    it("should increment item quantity", async () => {
      const user_id = "456";
      const productId = "123";

      // Mock Redis response
      const redisItem = JSON.stringify({
        productId: 123,
        quantity: 2,
        price: 59.98,
        unit_price: 29.99,
      });
      mockRedis.hGet.mockResolvedValue(redisItem);

      // Mock database update
      const mockUpdate = mockDb.update();
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Act
      const req = mockRequest({
        params: { productId },
        query: { user_id },
        body: { action: "increment" },
      });
      const res = mockResponse();
      await CartCtrl.updateCartItem(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart item quantity updated.",
        productId: 123,
        newQuantity: 3,
        newTotalPrice: 89.97,
        action: "updated",
      });
      expect(mockRedis.hSet).toHaveBeenCalled();
    });

    it("should remove item when quantity reaches zero", async () => {
      const user_id = "456";
      const productId = "123";

      // Mock Redis response for item with quantity 1
      const redisItem = JSON.stringify({
        productId: 123,
        quantity: 1,
        price: 29.99,
        unit_price: 29.99,
      });
      mockRedis.hGet.mockResolvedValue(redisItem);

      // Mock database delete
      const mockDelete = mockDb.delete();
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Act
      const req = mockRequest({
        params: { productId },
        query: { user_id },
        body: { action: "decrement" },
      });
      const res = mockResponse();
      await CartCtrl.updateCartItem(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Item removed from cart.",
        productId: 123,
        action: "removed",
      });
      expect(mockRedis.hDel).toHaveBeenCalled();
    });
  });

  describe("removeCartItem", () => {
    it("should remove item from cart", async () => {
      const user_id = "456";
      const productId = "123";

      // Mock database delete
      const mockDelete = mockDb.delete();
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Act
      const req = mockRequest({
        params: { productId },
        query: { user_id },
      });
      const res = mockResponse();
      await CartCtrl.removeCartItem(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart item deleted.",
      });
      expect(mockRedis.hDel).toHaveBeenCalled();
    });
  });

  describe("clearCart", () => {
    it("should clear entire cart", async () => {
      const user_id = "456";

      // Mock database delete
      const mockDelete = mockDb.delete();
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Act
      const req = mockRequest({ query: { user_id } });
      const res = mockResponse();
      await CartCtrl.clearCart(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart cleared successfully.",
      });
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe("getCartTotal", () => {
    it("should calculate cart total from Redis", async () => {
      const user_id = "456";

      // Mock Redis response
      const redisItems = {
        "123": JSON.stringify({
          productId: 123,
          quantity: 2,
          price: 59.98,
        }),
        "456": JSON.stringify({
          productId: 456,
          quantity: 1,
          price: 19.99,
        }),
      };
      mockRedis.hGetAll.mockResolvedValue(redisItems);

      // Act
      const req = mockRequest({ query: { user_id } });
      const res = mockResponse();
      await CartCtrl.getCartTotal(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart total calculated.",
        total: 79.97,
        itemCount: 3,
      });
    });

    it("should calculate cart total from database when Redis is empty", async () => {
      const user_id = "456";

      // Mock empty Redis response
      mockRedis.hGetAll.mockResolvedValue({});

      // Mock database response
      const dbItems = [
        {
          productId: 123,
          quantity: 2,
          price: "59.98",
          userId: 456,
          unit_price: "29.99",
          expires_at: new Date(),
          added_at: new Date(),
        },
        {
          productId: 456,
          quantity: 1,
          price: "19.99",
          userId: 456,
          unit_price: "19.99",
          expires_at: new Date(),
          added_at: new Date(),
        },
      ];

      // Create a proper mock for the database select chain
      const mockFrom = vi.fn().mockReturnThis();
      const mockWhere = vi.fn().mockResolvedValue(dbItems);
      const mockSelect = {
        from: mockFrom,
        where: mockWhere,
      };

      (db.select as Mock).mockReturnValue(mockSelect);

      // Act
      const req = mockRequest({ query: { user_id } });
      const res = mockResponse();
      await CartCtrl.getCartTotal(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Cart total calculated.",
        total: 79.97,
        itemCount: 3,
      });

      // Verify the database query was made correctly
      expect(db.select).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith(cartTable);
      expect(mockWhere).toHaveBeenCalledWith(expect.anything()); // The eq condition
    });
  });

  describe("mergeCarts", () => {
    it("should merge guest cart with user cart", async () => {
      const user_id = "456";

      // Mock guest cart items
      const guestItems = {
        "123": JSON.stringify({
          productId: 123,
          quantity: 2,
          price: 59.98,
          unit_price: 29.99,
        }),
      };

      // Mock user cart items
      const userItems = {
        "456": JSON.stringify({
          productId: 456,
          quantity: 1,
          price: 19.99,
          unit_price: 19.99,
        }),
      };

      mockRedis.hGetAll
        .mockResolvedValueOnce(guestItems) // First call for guest cart
        .mockResolvedValueOnce(userItems); // Second call for user cart

      // Mock database update
      const mockUpdate = mockDb.update();
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Act
      const req = mockRequest({ body: { user_id } });
      const res = mockResponse();
      await CartCtrl.mergeCarts(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "Carts merged successfully",
      });
      expect(mockRedis.hSet).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it("should return message when no items to merge", async () => {
      const user_id = "456";

      // Mock empty guest cart
      mockRedis.hGetAll.mockResolvedValue({});

      // Act
      const req = mockRequest({ body: { user_id } });
      const res = mockResponse();
      await CartCtrl.mergeCarts(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        message: "No items to merge",
      });
    });

    it("should return error when user_id is missing", async () => {
      // Act
      const req = mockRequest({ body: {} });
      const res = mockResponse();
      await CartCtrl.mergeCarts(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith({
        message: "User ID are required",
      });
    });
  });
});
