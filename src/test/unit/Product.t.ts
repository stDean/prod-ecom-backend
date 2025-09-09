import { describe, it, vi, beforeEach, expect, Mock } from "vitest";
import { ProductCtrl } from "../../controller/Product.c";
import { mockRequest, mockResponse } from "../mocks/express";
import { db } from "../../db";
import { redisClient } from "../../db/redis";
import { productTable } from "../../db/schema";
import { mockDb, mockRedis, resetMocks } from "../mocks/db";
import { and, asc, desc, eq } from "drizzle-orm";

// Mock the dependencies
vi.mock("../../db");
vi.mock("../../db/redis");
vi.mock("../../db/schema");

/**
 * @title Product Controller Test Suite
 * @description Comprehensive test suite for Product Controller methods including createProduct and getProducts
 * @group Unit Tests/Controllers/ProductCtrl
 *
 * @overview
 * This test suite validates the functionality of the Product Controller, which handles:
 * - Product creation with proper validation and cache invalidation
 * - Product retrieval with caching, pagination, filtering, and sorting
 * - Error handling for database and Redis operations
 *
 * @dependencies
 * - Vitest for testing framework
 * - Mocked Express request/response objects
 * - Mocked database (Drizzle ORM) and Redis client
 * - Centralized mock helpers for consistent test setup
 */
describe("Product Controller", () => {
  /**
   * @title Test Setup
   * @description Clears all mocks before each test to ensure test isolation
   */
  beforeEach(() => {
    resetMocks();
  });

  /**
   * @title createProduct Method Tests
   * @description Test suite for product creation functionality
   */
  describe("createProduct", () => {
    /**
     * @title Successful Product Creation
     * @description Verifies that a product can be created with valid data
     * @scenario
     * 1. Arrange: Create valid product data
     * 2. Act: Call createProduct with mock request/response
     * 3. Assert: Verify database insert and cache invalidation were called
     * @expected Product should be created and cache invalidated
     */
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

    /**
     * @title Cache Invalidation on Product Creation
     * @description Verifies that existing product cache is invalidated when new product is created
     * @scenario
     * 1. Arrange: Mock Redis to return existing cache keys
     * 2. Act: Call createProduct
     * 3. Assert: Verify cache deletion was called with correct keys
     * @expected Existing product cache should be invalidated
     */
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
      expect(redisClient.del).toHaveBeenCalledWith([
        "products:1",
        "products:2",
      ]);
    });

    /**
     * @title Required Field Validation
     * @description Verifies that product creation fails when required fields are missing
     * @scenario
     * 1. Arrange: Create product data with missing required field
     * 2. Act: Call createProduct
     * 3. Assert: Verify 400 response with error message
     * @expected Should return 400 error when required fields are missing
     */
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

    /**
     * @title Database Error Handling
     * @description Verifies graceful handling of database errors during product creation
     * @scenario
     * 1. Arrange: Mock database to throw error
     * 2. Act: Call createProduct
     * 3. Assert: Verify 500 response with error message
     * @expected Should return 500 error when database operation fails
     */
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

    /**
     * @title Redis Error Handling
     * @description Verifies that product creation succeeds even when cache invalidation fails
     * @scenario
     * 1. Arrange: Mock Redis to throw error during scan operation
     * 2. Act: Call createProduct
     * 3. Assert: Verify product is still created successfully
     * @expected Should create product despite Redis errors
     */
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

    /**
     * @title Default Value Assignment
     * @description Verifies that default values are set for optional fields
     * @scenario
     * 1. Arrange: Create product data without inStock field
     * 2. Act: Call createProduct
     * 3. Assert: Verify default inStock value (true) is used
     * @expected Should set default values for optional fields
     */
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

  /**
   * @title getProducts Method Tests
   * @description Test suite for product retrieval functionality
   */
  describe("getProducts", () => {
    /**
     * @title Cache Hit Scenario
     * @description Verifies that products are returned from cache when available
     * @scenario
     * 1. Arrange: Mock Redis to return cached data
     * 2. Act: Call getProducts
     * 3. Assert: Verify cached data is returned and database is not queried
     * @expected Should return products from cache without database query
     */
    it("should return products from cache when available", async () => {
      // Arrange
      const cachedData = {
        products: [{ id: 1, name: "Cached Product" }],
        totalCount: 1,
        totalPages: 1,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      // Act
      const req = mockRequest({ query: { page: "1", limit: "10" } });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        products: cachedData.products,
        pagination: {
          page: 1,
          limit: 10,
          totalCount: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
      // Ensure database wasn't queried
      expect(db.select).not.toHaveBeenCalled();
    });

    /**
     * @title Cache Miss Scenario
     * @description Verifies that products are queried from database and cached when not in cache
     * @scenario
     * 1. Arrange: Mock Redis to return empty cache
     * 2. Act: Call getProducts
     * 3. Assert: Verify database is queried and results are cached
     * @expected Should query database and cache results when cache is empty
     */
    it("should query database and cache results when cache is empty", async () => {
      // Arrange
      const mockProducts = [
        { id: 1, name: "Product 1", category: "electronics" },
        { id: 2, name: "Product 2", category: "electronics" },
      ];

      // Mock Redis to return null (cache miss)
      mockRedis.get.mockResolvedValue(null);

      // Mock count query
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockResolvedValue([{ count: 2 }]);

      // Mock products query
      const mockProductsQuery = mockDb.select();
      mockProductsQuery.from.mockReturnThis();
      mockProductsQuery.where.mockReturnThis();
      mockProductsQuery.orderBy.mockReturnThis();
      mockProductsQuery.limit.mockReturnThis();
      mockProductsQuery.offset.mockResolvedValue(mockProducts);

      (db.select as Mock)
        .mockReturnValueOnce(mockCountQuery)
        .mockReturnValue(mockProductsQuery);

      // Act
      const req = mockRequest({ query: { page: "1", limit: "10" } });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalledTimes(2); // Once for count, once for products
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
      expect(res.json).toHaveBeenCalledWith({
        products: mockProducts,
        pagination: {
          page: 1,
          limit: 10,
          totalCount: 2,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    });

    /**
     * @title Redis Error Fallback
     * @description Verifies that database is queried even when Redis fails
     * @scenario
     * 1. Arrange: Mock Redis to throw error
     * 2. Act: Call getProducts
     * 3. Assert: Verify database is still queried and response is sent
     * @expected Should fall back to database when Redis fails
     */
    it("should handle Redis errors gracefully and fall back to database", async () => {
      // Arrange
      const mockProducts = [{ id: 1, name: "Product 1" }];

      // Mock Redis to throw an error
      mockRedis.get.mockRejectedValue(new Error("Redis error"));

      // Mock count query
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockResolvedValue([{ count: 1 }]);

      // Mock products query
      const mockProductsQuery = mockDb.select();
      mockProductsQuery.from.mockReturnThis();
      mockProductsQuery.where.mockReturnThis();
      mockProductsQuery.orderBy.mockReturnThis();
      mockProductsQuery.limit.mockReturnThis();
      mockProductsQuery.offset.mockResolvedValue(mockProducts);

      (db.select as Mock)
        .mockReturnValueOnce(mockCountQuery)
        .mockReturnValue(mockProductsQuery);

      // Act
      const req = mockRequest({ query: { page: "1", limit: "10" } });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalled(); // Database should still be queried
      expect(res.json).toHaveBeenCalled(); // Response should still be sent
    });

    /**
     * @title Category Filtering
     * @description Verifies that products can be filtered by category
     * @scenario
     * 1. Arrange: Mock database with category filter
     * 2. Act: Call getProducts with category parameter
     * 3. Assert: Verify where clause includes category filter
     * @expected Should filter products by category when specified
     */
    it("should filter by category when provided", async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Mock count query
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockResolvedValue([{ count: 3 }]);

      // Mock products query with category filter
      const mockProductsQuery = mockDb.select();
      mockProductsQuery.from.mockReturnThis();
      mockProductsQuery.where.mockReturnThis();
      mockProductsQuery.orderBy.mockReturnThis();
      mockProductsQuery.limit.mockReturnThis();
      mockProductsQuery.offset.mockResolvedValue([
        { id: 1, name: "Electronics Product", category: "electronics" },
      ]);

      (db.select as Mock)
        .mockReturnValueOnce(mockCountQuery)
        .mockReturnValue(mockProductsQuery);

      // Act
      const req = mockRequest({
        query: { page: "1", limit: "10", category: "electronics" },
      });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      // Verify that the where clause was applied
      expect(mockCountQuery.where).toHaveBeenCalledWith(
        and(eq(productTable.category, "electronics"))
      );
      expect(mockProductsQuery.where).toHaveBeenCalledWith(
        and(eq(productTable.category, "electronics"))
      );
    });

    /**
     * @title Sorting Functionality
     * @description Verifies that products can be sorted by various fields and directions
     * @scenario
     * 1. Arrange: Mock database with different sort parameters
     * 2. Act: Call getProducts with various sort parameters
     * 3. Assert: Verify correct orderBy clauses are used
     * @expected Should apply correct sorting based on parameters
     */
    it("should handle sorting parameters correctly", async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Mock count query
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockResolvedValue([{ count: 5 }]);

      // Mock products query
      const mockProductsQuery = mockDb.select();
      mockProductsQuery.from.mockReturnThis();
      mockProductsQuery.where.mockReturnThis();
      mockProductsQuery.orderBy.mockReturnThis();
      mockProductsQuery.limit.mockReturnThis();
      mockProductsQuery.offset.mockResolvedValue([]);

      (db.select as Mock)
        .mockReturnValueOnce(mockCountQuery)
        .mockReturnValue(mockProductsQuery);

      // Act - Test different sort combinations
      const testCases = [
        {
          sortBy: "name",
          sortOrder: "asc",
          expectedOrder: asc(productTable.name),
        },
        {
          sortBy: "price",
          sortOrder: "desc",
          expectedOrder: desc(productTable.price),
        },
        {
          sortBy: "invalid",
          sortOrder: "asc",
          expectedOrder: asc(productTable.created_at),
        },
      ];

      for (const testCase of testCases) {
        const req = mockRequest({
          query: {
            page: "1",
            limit: "10",
            sortBy: testCase.sortBy,
            sortOrder: testCase.sortOrder,
          },
        });
        const res = mockResponse();
        await ProductCtrl.getProducts(req, res);

        // Assert
        expect(mockProductsQuery.orderBy).toHaveBeenCalledWith(
          testCase.expectedOrder
        );

        // Reset mocks for next iteration
        mockProductsQuery.orderBy.mockClear();
      }
    });

    /**
     * @title Pagination Functionality
     * @description Verifies that pagination works correctly with various page/limit combinations
     * @scenario
     * 1. Arrange: Mock database with different pagination parameters
     * 2. Act: Call getProducts with various page/limit values
     * 3. Assert: Verify correct limit/offset values and pagination metadata
     * @expected Should handle pagination correctly with various parameters
     */
    it("should handle pagination correctly", async () => {
      // Test different pagination scenarios
      const testCases = [
        {
          query: { page: "1", limit: "10" },
          expectedOffset: 0,
          expectedLimit: 10,
          expectedPages: 2,
        },
        {
          query: { page: "2", limit: "5" },
          expectedOffset: 5,
          expectedLimit: 5,
          expectedPages: 3,
        },
        {
          query: { page: "3", limit: "20" },
          expectedOffset: 40,
          expectedLimit: 20,
          expectedPages: 1,
        },
      ];

      for (const testCase of testCases) {
        // Arrange for each test case
        mockRedis.get.mockResolvedValue(null);

        // Mock count query
        const mockCountQuery = mockDb.select();
        mockCountQuery.from.mockReturnThis();
        mockCountQuery.where.mockResolvedValue([{ count: 15 }]);

        // Mock products query
        const mockProducts = Array(testCase.expectedLimit).fill({
          id: 1,
          name: "Test Product",
        });

        const mockProductsQuery = mockDb.select();
        mockProductsQuery.from.mockReturnThis();
        mockProductsQuery.where.mockReturnThis();
        mockProductsQuery.orderBy.mockReturnThis();
        mockProductsQuery.limit.mockReturnThis();
        mockProductsQuery.offset.mockResolvedValue(mockProducts);

        // Mock db.select to return different values for count and products queries
        (db.select as Mock)
          .mockReturnValueOnce(mockCountQuery) // First call (count)
          .mockReturnValue(mockProductsQuery); // Subsequent calls (products)

        // Act
        const req = mockRequest({ query: testCase.query });
        const res = mockResponse();
        await ProductCtrl.getProducts(req, res);

        // Assert
        expect(mockProductsQuery.limit).toHaveBeenCalledWith(
          testCase.expectedLimit
        );
        expect(mockProductsQuery.offset).toHaveBeenCalledWith(
          testCase.expectedOffset
        );

        // Check pagination metadata
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            pagination: expect.objectContaining({
              page: parseInt(testCase.query.page as string),
              limit: testCase.expectedLimit,
              totalCount: 15,
              totalPages: testCase.expectedPages,
            }),
          })
        );

        // Reset mocks for next iteration
        vi.clearAllMocks();
      }
    });

    /**
     * @title Database Error Handling
     * @description Verifies graceful handling of database errors during product retrieval
     * @scenario
     * 1. Arrange: Mock database to throw error
     * 2. Act: Call getProducts
     * 3. Assert: Verify 500 response with error message
     * @expected Should return 500 error when database operation fails
     */
    it("should handle database errors gracefully", async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Mock count query to throw an error
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockRejectedValue(new Error("Database error"));

      (db.select as Mock).mockReturnValueOnce(mockCountQuery);

      // Act
      const req = mockRequest({ query: { page: "1", limit: "10" } });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Error fetching products",
      });
    });

    /**
     * @title Cache Set Error Handling
     * @description Verifies that product retrieval succeeds even when caching fails
     * @scenario
     * 1. Arrange: Mock Redis set operation to throw error
     * 2. Act: Call getProducts
     * 3. Assert: Verify response is still sent successfully
     * @expected Should return products despite cache set errors
     */
    it("should handle cache set errors gracefully", async () => {
      // Arrange
      const mockProducts = [{ id: 1, name: "Product 1" }];

      // Mock Redis to return null (cache miss)
      mockRedis.get.mockResolvedValue(null);
      // Mock Redis set to throw an error
      mockRedis.set.mockRejectedValue(new Error("Cache set error"));

      // Mock count query
      const mockCountQuery = mockDb.select();
      mockCountQuery.from.mockReturnThis();
      mockCountQuery.where.mockResolvedValue([{ count: 1 }]);

      // Mock products query
      const mockProductsQuery = mockDb.select();
      mockProductsQuery.from.mockReturnThis();
      mockProductsQuery.where.mockReturnThis();
      mockProductsQuery.orderBy.mockReturnThis();
      mockProductsQuery.limit.mockReturnThis();
      mockProductsQuery.offset.mockResolvedValue(mockProducts);

      (db.select as Mock)
        .mockReturnValueOnce(mockCountQuery)
        .mockReturnValue(mockProductsQuery);

      // Act
      const req = mockRequest({ query: { page: "1", limit: "10" } });
      const res = mockResponse();
      await ProductCtrl.getProducts(req, res);

      // Assert
      expect(redisClient.set).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled(); // Response should still be sent despite cache error
    });
  });

  /**
   * @title getProductById Method Tests
   * @description Test suite for single product retrieval functionality
   */
  describe("getProductById", () => {
    /**
     * @title Cache Hit Scenario
     * @description Verifies that a product is returned from Redis cache when available
     * @scenario
     * 1. Mock Redis to return a cached product
     * 2. Call getProductById with a valid product ID
     * 3. Verify response contains cached data and database is not queried
     * @expected Should return product from cache with 200 status
     */
    it("should return product from cache when available", async () => {
      // Arrange
      const cachedProduct = { id: 1, name: "Cached Product" };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedProduct));

      // Act
      const req = mockRequest({ params: { id: "1" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalledWith("product:1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(cachedProduct);
      expect(db.select).not.toHaveBeenCalled(); // Ensure DB was not queried
    });

    /**
     * @title Cache Miss with Database Fallback
     * @description Verifies that a product is queried from database and cached when not in Redis
     * @scenario
     * 1. Mock Redis to return null (cache miss)
     * 2. Mock database to return a product
     * 3. Call getProductById with a valid product ID
     * 4. Verify database is queried, result is cached, and response is correct
     * @expected Should query database, cache result, and return product with 200 status
     */
    it("should query database and cache result when cache is empty", async () => {
      // Arrange
      const productFromDb = { id: 1, name: "DB Product" };
      mockRedis.get.mockResolvedValue(null);

      // Mock database query
      const mockProductQuery = mockDb.select();
      mockProductQuery.from.mockReturnThis();
      mockProductQuery.where.mockReturnThis();
      mockProductQuery.limit.mockResolvedValue([productFromDb]);

      (db.select as Mock).mockReturnValue(mockProductQuery);

      // Act
      const req = mockRequest({ params: { id: "1" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalledWith("product:1");
      expect(db.select).toHaveBeenCalled(); // Ensure DB was queried
      expect(redisClient.setEx).toHaveBeenCalledWith(
        "product:1",
        3600,
        JSON.stringify(productFromDb)
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(productFromDb);
    });

    /**
     * @title Product Not Found
     * @description Verifies proper handling when a product doesn't exist in database
     * @scenario
     * 1. Mock Redis to return null
     * 2. Mock database to return empty result
     * 3. Call getProductById with a non-existent product ID
     * 4. Verify 404 response with appropriate message
     * @expected Should return 404 status with "Product not found" message
     */
    it("should return 404 if product not found", async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Mock database query to return empty result
      const mockProductQuery = mockDb.select();
      mockProductQuery.from.mockReturnThis();
      mockProductQuery.where.mockReturnThis();
      mockProductQuery.limit.mockResolvedValue([]);

      (db.select as Mock).mockReturnValue(mockProductQuery);

      // Act
      const req = mockRequest({ params: { id: "999" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "Product not found" });
    });

    /**
     * @title Database Error Handling
     * @description Verifies graceful handling of database errors
     * @scenario
     * 1. Mock Redis to return null
     * 2. Mock database to throw an error
     * 3. Call getProductById with a valid product ID
     * 4. Verify 500 response with appropriate message
     * @expected Should return 500 status with "Error fetching product" message
     */
    it("should handle database errors gracefully", async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Mock database query to throw an error
      const mockProductQuery = mockDb.select();
      mockProductQuery.from.mockReturnThis();
      mockProductQuery.where.mockReturnThis();
      mockProductQuery.limit.mockRejectedValue(new Error("DB Error"));

      (db.select as Mock).mockReturnValue(mockProductQuery);

      // Act
      const req = mockRequest({ params: { id: "1" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Error fetching product",
      });
    });

    /**
     * @title Redis Error Handling
     * @description Verifies that database fallback works when Redis fails
     * @scenario
     * 1. Mock Redis to throw an error
     * 2. Mock database to return a product
     * 3. Call getProductById with a valid product ID
     * 4. Verify database is queried and response is successful despite Redis error
     * @expected Should query database and return product with 200 status despite Redis error
     */
    it("should handle Redis errors gracefully", async () => {
      // Arrange
      const productFromDb = { id: 1, name: "DB Product" };

      // Mock Redis to throw an error
      mockRedis.get.mockRejectedValue(new Error("Redis error"));

      // Mock database query to return the product
      const mockProductQuery = mockDb.select();
      mockProductQuery.from.mockReturnThis();
      mockProductQuery.where.mockReturnThis();
      mockProductQuery.limit.mockResolvedValue([productFromDb]);

      (db.select as Mock).mockReturnValue(mockProductQuery);

      // Act
      const req = mockRequest({ params: { id: "1" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(redisClient.get).toHaveBeenCalled(); // Redis was called but failed
      expect(db.select).toHaveBeenCalled(); // Database should still be queried
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(productFromDb);
    });

    /**
     * @title Cache Set Error Handling
     * @description Verifies that product retrieval succeeds even when caching fails
     * @scenario
     * 1. Mock Redis to return null
     * 2. Mock Redis setEx to throw an error
     * 3. Mock database to return a product
     * 4. Call getProductById with a valid product ID
     * 5. Verify response is successful despite cache set error
     * @expected Should return product with 200 status despite cache set error
     */
    it("should handle cache set errors gracefully", async () => {
      // Arrange
      const productFromDb = { id: 1, name: "DB Product" };
      mockRedis.get.mockResolvedValue(null);

      // Mock Redis setEx to throw an error
      mockRedis.setEx.mockRejectedValue(new Error("Cache set error"));

      // Mock database query to return the product
      const mockProductQuery = mockDb.select();
      mockProductQuery.from.mockReturnThis();
      mockProductQuery.where.mockReturnThis();
      mockProductQuery.limit.mockResolvedValue([productFromDb]);

      (db.select as Mock).mockReturnValue(mockProductQuery);

      // Act
      const req = mockRequest({ params: { id: "1" } });
      const res = mockResponse();
      await ProductCtrl.getProductById(req, res);

      // Assert
      expect(redisClient.setEx).toHaveBeenCalled(); // Cache set was attempted but failed
      expect(res.status).toHaveBeenCalledWith(200); // Response should still be successful
      expect(res.json).toHaveBeenCalledWith(productFromDb);
    });
  });

  /**
   * @title updateProduct Method Tests
   * @description Test suite for product update functionality
   */
  describe("updateProduct", () => {
    /**
     * @title Successful Product Update
     * @description Verifies that a product can be successfully updated with cache invalidation
     * @scenario
     * 1. Mock database update to return updated product
     * 2. Mock cache invalidation to succeed
     * 3. Call updateProduct with valid data
     * 4. Verify database update, cache invalidation, and successful response
     * @expected Should update product, invalidate cache, and return updated product with 200 status
     */
    it("should successfully update a product and invalidate cache", async () => {
      // Arrange
      const productId = 1;
      const updateData = {
        name: "Updated Product",
        price: 129.99,
        description: "Updated description",
      };
      const updatedProduct = { id: productId, ...updateData };

      // Mock database update operation
      const mockUpdate = mockDb.update();
      mockUpdate.set.mockReturnThis();
      mockUpdate.where.mockReturnThis();
      mockUpdate.returning.mockResolvedValue([updatedProduct]);
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Mock cache invalidation
      mockRedis.scan.mockResolvedValue({ cursor: "0", keys: [] });
      mockRedis.del.mockResolvedValue(1);

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: updateData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(db.update).toHaveBeenCalledWith(productTable);
      expect(mockUpdate.set).toHaveBeenCalledWith(updateData);
      expect(mockUpdate.where).toHaveBeenCalledWith(
        eq(productTable.id, productId)
      );
      expect(mockUpdate.returning).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(`product:${productId}`);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(updatedProduct);
    });

    /**
     * @title Validation - No Update Fields
     * @description Verifies proper handling when no valid fields are provided for update
     * @scenario
     * 1. Call updateProduct with empty request body
     * 2. Verify 400 response with appropriate message
     * @expected Should return 400 status with "No valid fields provided for update" message
     */
    it("should return error when no valid fields are provided", async () => {
      // Arrange
      const productId = 1;

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: {}, // Empty body
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "No valid fields provided for update",
      });
      expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * @title Validation - Invalid Price
     * @description Verifies proper handling when an invalid price is provided
     * @scenario
     * 1. Call updateProduct with negative price value
     * 2. Verify 400 response with appropriate message
     * @expected Should return 400 status with "Price must be a valid non-negative number" message
     */
    it("should return error when price is invalid", async () => {
      // Arrange
      const productId = 1;
      const invalidData = {
        name: "Updated Product",
        price: -10, // Invalid price
      };

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: invalidData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Price must be a valid non-negative number",
      });
      expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * @title Product Not Found During Update
     * @description Verifies proper handling when updating a non-existent product
     * @scenario
     * 1. Mock database update to return empty result
     * 2. Call updateProduct with non-existent product ID
     * 3. Verify 404 response with appropriate message
     * @expected Should return 404 status with "Product not found" message
     */
    it("should return 404 when product is not found", async () => {
      // Arrange
      const productId = 999;
      const updateData = {
        name: "Updated Product",
        price: 129.99,
      };

      // Mock database update operation to return empty result
      const mockUpdate = mockDb.update();
      mockUpdate.set.mockReturnThis();
      mockUpdate.where.mockReturnThis();
      mockUpdate.returning.mockResolvedValue([]);
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: updateData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Product not found",
      });
    });

    /**
     * @title Database Error Handling During Update
     * @description Verifies graceful handling of database errors during product update
     * @scenario
     * 1. Mock database update to throw an error
     * 2. Call updateProduct with valid data
     * 3. Verify 500 response with appropriate message
     * @expected Should return 500 status with "Error updating product" message
     */
    it("should handle database errors gracefully", async () => {
      // Arrange
      const productId = 1;
      const updateData = {
        name: "Updated Product",
        price: 129.99,
      };

      // Mock database update operation to throw an error
      const mockUpdate = mockDb.update();
      mockUpdate.set.mockReturnThis();
      mockUpdate.where.mockReturnThis();
      mockUpdate.returning.mockRejectedValue(new Error("Database error"));
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: updateData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Error updating product",
      });
    });

    /**
     * @title Data Type Conversion - Price
     * @description Verifies that string prices are properly converted to numbers
     * @scenario
     * 1. Mock database update to return updated product
     * 2. Call updateProduct with string price value
     * 3. Verify price is converted to number in database call
     * @expected Should convert string price to number before database update
     */
    it("should convert price to number when provided as string", async () => {
      // Arrange
      const productId = 1;
      const updateData = {
        name: "Updated Product",
        price: "129.99", // String price
      };
      const updatedProduct = {
        id: productId,
        name: "Updated Product",
        price: 129.99,
      };

      // Mock database update operation
      const mockUpdate = mockDb.update();
      mockUpdate.set.mockReturnThis();
      mockUpdate.where.mockReturnThis();
      mockUpdate.returning.mockResolvedValue([updatedProduct]);
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Mock cache invalidation
      mockRedis.scan.mockResolvedValue({ cursor: "0", keys: [] });
      mockRedis.del.mockResolvedValue(1);

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: updateData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(mockUpdate.set).toHaveBeenCalledWith({
        name: "Updated Product",
        price: 129.99, // Should be converted to number
      });
    });

    /**
     * @title Data Type Conversion - Boolean
     * @description Verifies that string boolean values are properly converted to booleans
     * @scenario
     * 1. Mock database update to return updated product
     * 2. Call updateProduct with string boolean value
     * 3. Verify boolean is properly converted in database call
     * @expected Should convert string boolean to actual boolean before database update
     */
    it("should convert inStock to boolean when provided", async () => {
      // Arrange
      const productId = 1;
      const updateData = {
        inStock: "true", // String boolean
      };
      const updatedProduct = { id: productId, inStock: true };

      // Mock database update operation
      const mockUpdate = mockDb.update();
      mockUpdate.set.mockReturnThis();
      mockUpdate.where.mockReturnThis();
      mockUpdate.returning.mockResolvedValue([updatedProduct]);
      (db.update as Mock).mockReturnValue(mockUpdate);

      // Mock cache invalidation
      mockRedis.scan.mockResolvedValue({ cursor: "0", keys: [] });
      mockRedis.del.mockResolvedValue(1);

      // Act
      const req = mockRequest({
        params: { id: productId.toString() },
        body: updateData,
      });
      const res = mockResponse();
      await ProductCtrl.updateProduct(req, res);

      // Assert
      expect(mockUpdate.set).toHaveBeenCalledWith({
        inStock: true, // Should be converted to boolean
      });
    });
  });

  /**
   * @title deleteProduct Method Tests
   * @description Test suite for product deletion functionality
   */
  describe("deleteProduct", () => {
    /**
     * @title Successful Product Deletion
     * @description Verifies that a product can be successfully deleted with cache invalidation
     * @scenario
     * 1. Mock database delete to succeed
     * 2. Mock cache invalidation to succeed
     * 3. Call deleteProduct with valid product ID
     * 4. Verify database deletion, cache invalidation, and successful response
     * @expected Should delete product, invalidate cache, and return success message with 200 status
     */
    it("should successfully delete a product and invalidate cache", async () => {
      // Arrange
      const productId = 1;

      // Mock database delete operation
      const mockDelete = mockDb.delete();
      mockDelete.where.mockResolvedValue({ rowCount: 1 });
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Mock cache invalidation
      mockRedis.scan.mockResolvedValue({ cursor: "0", keys: [] });
      mockRedis.del.mockResolvedValue(1);

      // Act
      const req = mockRequest({ params: { id: productId.toString() } });
      const res = mockResponse();
      await ProductCtrl.deleteProduct(req, res);

      // Assert
      expect(db.delete).toHaveBeenCalledWith(productTable);
      expect(mockDelete.where).toHaveBeenCalledWith(
        eq(productTable.id, productId)
      );
      expect(redisClient.del).toHaveBeenCalledWith(`product:${productId}`);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Product deleted successfully",
      });
    });

    /**
     * @title Product Not Found During Deletion
     * @description Verifies proper handling when deleting a non-existent product
     * @scenario
     * 1. Mock database delete to return no rows affected
     * 2. Call deleteProduct with non-existent product ID
     * 3. Verify 404 response with appropriate message
     * @expected Should return 404 status with "Product not found" message
     */
    it("should return 404 when product is not found", async () => {
      // Arrange
      const productId = 999;

      // Mock database delete operation to return no rows affected
      const mockDelete = mockDb.delete();
      mockDelete.where.mockResolvedValue({ rowCount: 0 });
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Act
      const req = mockRequest({ params: { id: productId.toString() } });
      const res = mockResponse();
      await ProductCtrl.deleteProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Product not found",
      });
    });

    /**
     * @title Database Error Handling During Deletion
     * @description Verifies graceful handling of database errors during product deletion
     * @scenario
     * 1. Mock database delete to throw an error
     * 2. Call deleteProduct with valid product ID
     * 3. Verify 500 response with appropriate message
     * @expected Should return 500 status with "Error deleting product" message
     */
    it("should handle database errors gracefully", async () => {
      // Arrange
      const productId = 1;

      // Mock database delete operation to throw an error
      const mockDelete = mockDb.delete();
      mockDelete.where.mockRejectedValue(new Error("Database error"));
      (db.delete as Mock).mockReturnValue(mockDelete);

      // Act
      const req = mockRequest({ params: { id: productId.toString() } });
      const res = mockResponse();
      await ProductCtrl.deleteProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Error deleting product",
      });
    });

    /**
     * @title Validation - Invalid Product ID
     * @description Verifies proper handling when an invalid product ID is provided
     * @scenario
     * 1. Call deleteProduct with non-numeric product ID
     * 2. Verify 400 response with appropriate message
     * @expected Should return 400 status with "Invalid product ID" message
     */
    it("should return 400 for invalid product ID", async () => {
      // Arrange - invalid ID
      const invalidId = "abc";

      // Act
      const req = mockRequest({ params: { id: invalidId } });
      const res = mockResponse();
      await ProductCtrl.deleteProduct(req, res);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Invalid product ID",
      });
      expect(db.delete).not.toHaveBeenCalled();
    });
  });
});
