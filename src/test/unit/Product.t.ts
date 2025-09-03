import { describe, it, vi, beforeEach, expect, Mock } from "vitest";
import { ProductCtrl } from "../../controller/Product.c";
import { mockRequest, mockResponse } from "../mocks/express";
import { db } from "../../db";
import { redisClient } from "../../db/redis";
import { productTable } from "../../db/schema";
import { mockDb, mockRedis, resetMocks } from "../mocks/db";

// Mock the dependencies
vi.mock("../../db");
vi.mock("../../db/redis");
vi.mock("../../db/schema");

describe("Product Controller", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("createProduct", () => {
    it("should create a new product", async () => {
      // Arrange
      const productData = {
        name: "Test Product",
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        inStock: true,
      };

      // Mock the database insert operation
      const mockInsert = mockDb.insert();
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert
      expect(db.insert).toHaveBeenCalledWith(productTable);
      expect(mockInsert.values).toHaveBeenCalledWith({
        name: productData.name,
        description: productData.description,
        price: productData.price,
        category: productData.category,
        inStock: productData.inStock,
      });
      expect(redisClient.scan).toHaveBeenCalledWith("0", {
        MATCH: "products:*",
        COUNT: 100,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ message: "Product created" });
    });

    it("should invalidate cache if products exist in Redis", async () => {
      // Arrange
      const productData = {
        name: "Test Product",
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        inStock: true,
      };

      // Mock the database insert operation
      const mockInsert = mockDb.insert();
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Mock Redis scan operation to return some keys
      mockRedis.scan.mockResolvedValue({
        cursor: "0",
        keys: ["products:1", "products:2"],
      });

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert
      expect(db.insert).toHaveBeenCalledWith(productTable);
      expect(redisClient.del).toHaveBeenCalledWith(["products:1", "products:2"]);
    });

    it("should fail if all required fields are not provided", async () => {
      // Arrange: Missing 'name' field
      const productData = {
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        inStock: true,
      };

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Missing required fields",
      });
    });

    it("should handle database errors gracefully", async () => {
      // Arrange
      const productData = {
        name: "Test Product",
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        inStock: true,
      };

      // Mock the database insert operation to throw an error
      const mockInsert = mockDb.insert();
      mockInsert.values.mockRejectedValue(new Error("DB Error"));
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Error creating product",
      });
    });

    it("should handle Redis errors gracefully during cache invalidation", async () => {
      // Arrange
      const productData = {
        name: "Test Product",
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        inStock: true,
      };

      const mockInsert = mockDb.insert();
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Mock Redis scan to throw an error
      mockRedis.scan.mockRejectedValue(new Error("Redis Error"));

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert - should still succeed despite Redis error
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ message: "Product created" });
    });

    it("should set default inStock value to true when not provided", async () => {
      // Arrange
      const productData = {
        name: "Test Product",
        price: 99.99,
        description: "A product for testing",
        category: "Testing",
        // inStock not provided
      };

      // Mock the database insert operation
      const mockInsert = mockDb.insert();
      (db.insert as Mock).mockReturnValue(mockInsert);

      // Act
      const req = mockRequest({ body: productData });
      const res = mockResponse();
      await ProductCtrl.createProduct(req, res);

      // Assert
      expect(mockInsert.values).toHaveBeenCalledWith({
        name: productData.name,
        description: productData.description,
        price: productData.price,
        category: productData.category,
        inStock: true, // Default value
      });
    });
  });
});
