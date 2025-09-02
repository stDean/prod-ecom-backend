import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { redisClient } from "../db/redis";
import { db } from "../db";
import { productTable } from "../db/schema";
import { asc, desc, sql, eq, and, count } from "drizzle-orm";
import { get } from "http";

// Constants for cache configuration
const DEFAULT_PAGE = 1; // Default page number when not specified
const DEFAULT_LIMIT = 10; // Default number of items per page
const MAX_LIMIT = 100; // Maximum allowed items per page to prevent excessive load
const CACHE_TTL = 300; // Cache time-to-live in seconds (5 minutes)

function getId(req: Request, res: Response): number | Response {
  const id = parseInt(req.params.id);

  return isNaN(id)
    ? res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: "Invalid product ID" })
    : id;
}

export const ProductCtrl = {
  /**
   * Creates a new product in the database
   * @param req - Express request object containing product data in body
   * @param res - Express response object
   * @returns HTTP response indicating success or failure
   *
   * @example
   * // Request body
   * {
   *   "name": "Product Name",
   *   "description": "Product description",
   *   "price": 99.99,
   *   "category": "electronics",
   *   "inStock": true
   * }
   *
   * // Success response
   * {
   *   "message": "Product created"
   * }
   */
  createProduct: async (req: Request, res: Response) => {
    try {
      const { name, description, price, category, inStock } = req.body;

      // Validate required fields
      if (!name || !description || !price || !category) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "Missing required fields" });
      }

      // Insert product into database
      await db.insert(productTable).values({
        name,
        description,
        price,
        category,
        inStock: inStock ?? true, // Default to true if not provided
      });

      // Invalidate all product-related cache to ensure data consistency
      try {
        let cursor = "0";
        do {
          // Scan Redis for all keys matching the products pattern
          const res = await redisClient.scan(cursor, {
            MATCH: "products:*",
            COUNT: 100,
          });
          cursor = res.cursor;
          if (res.keys.length > 0) {
            // Delete all found product cache keys
            await redisClient.del(res.keys);
          }
        } while (cursor !== "0");
      } catch (redisError) {
        console.error("Cache invalidation failed:", redisError);
        // Continue even if cache invalidation fails
      }

      return res
        .status(StatusCodes.CREATED)
        .json({ message: "Product created" });
    } catch (error) {
      console.error("Error creating product:", error);
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error creating product" });
    }
  },

  /**
   * Retrieves paginated products with optional filtering and sorting
   * @param req - Express request object with query parameters for pagination, sorting, and filtering
   * @param res - Express response object containing products and pagination metadata
   * @returns HTTP response with products data or error message
   *
   * @example
   * // Request URL
   * GET /products?page=2&limit=20&sortBy=price&sortOrder=desc&category=electronics
   *
   * // Success response
   * {
   *   "products": [
   *     {
   *       "id": 1,
   *       "name": "Product 1",
   *       "description": "Description 1",
   *       "price": 99.99,
   *       "category": "electronics",
   *       "inStock": true,
   *       "created_at": "2023-01-01T00:00:00.000Z"
   *     },
   *     // ... more products
   *   ],
   *   "pagination": {
   *     "page": 2,
   *     "limit": 20,
   *     "totalCount": 45,
   *     "totalPages": 3,
   *     "hasNext": true,
   *     "hasPrev": true
   *   }
   * }
   */
  getProducts: async (req: Request, res: Response) => {
    try {
      // Parse query parameters with defaults
      const page = parseInt(req.query.page as string) || DEFAULT_PAGE;
      const limit = Math.min(
        parseInt(req.query.limit as string) || DEFAULT_LIMIT,
        MAX_LIMIT
      );
      const sortBy = (req.query.sortBy as string) || "createdAt";
      const sortOrder = (req.query.sortOrder as string) === "desc" ? desc : asc;
      const category = req.query.category as string;

      // Calculate offset for database query
      const offset = (page - 1) * limit;

      // Create a unique cache key based on all query parameters
      const cacheKey = `products:page:${page}:limit:${limit}:sortBy:${sortBy}:sortOrder:${sortOrder}${
        category ? `:category:${category}` : ""
      }`;

      console.log("Cache Key:", cacheKey);

      // Try to get cached data first
      let cachedData;
      try {
        cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          // Return cached data if available
          const { products, totalCount, totalPages } = JSON.parse(cachedData);
          return res.status(StatusCodes.OK).json({
            products,
            pagination: {
              page,
              limit,
              totalCount,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          });
        }
      } catch (redisError) {
        console.error("Redis error:", redisError);
        // Proceed to database query if cache fails
      }

      // Build where conditions for filtering
      const whereConditions = [];
      if (category) {
        whereConditions.push(eq(productTable.category, category));
      }

      // Get total count of products (for pagination metadata)
      const totalCountResult = await db
        .select({ count: count() })
        .from(productTable)
        .where(
          whereConditions.length > 0 ? and(...whereConditions) : undefined
        );

        console.log("Total Count Result:", totalCountResult);

      const totalCount = totalCountResult[0]?.count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      // Create a mapping of valid sort columns to prevent SQL injection
      const validSortColumns: Record<string, any> = {
        id: productTable.id,
        name: productTable.name,
        price: productTable.price,
        category: productTable.category,
        createdAt: productTable.created_at,
        // Add other columns as needed
      };

      // Get the sort column or default to created_at
      const sortColumn = validSortColumns[sortBy] || productTable.created_at;

      // Build and execute the products query with pagination and sorting
      const products = await db
        .select()
        .from(productTable)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(sortOrder(sortColumn))
        .limit(limit)
        .offset(offset);

      // Prepare response data with products and pagination metadata
      const responseData = {
        products,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };

      // Cache the result for future requests
      try {
        await redisClient.set(cacheKey, JSON.stringify(responseData), {
          EX: CACHE_TTL,
        });
      } catch (redisError) {
        console.error("Cache set error:", redisError);
        // Continue even if caching fails
      }

      return res.status(StatusCodes.OK).json(responseData);
    } catch (error) {
      console.error("Error fetching products:", error);
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error fetching products" });
    }
  },

  /**
   * @title Get Product by ID
   * @description Retrieves a product by its ID using cache-aside pattern.
   * First checks Redis cache, if not found, queries PostgreSQL database and caches the result.
   *
   * @route GET /api/products/:id
   *
   * @param {Request} req Express request object containing product ID in params
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with product data or error message
   *
   * @throws {400} If product ID is not a valid integer
   * @throws {404} If product with the specified ID doesn't exist
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response
   * GET /api/products/123
   * Response: 200
   * {
   *   "id": 123,
   *   "name": "Example Product",
   *   "description": "Product description",
   *   "price": 29.99,
   *   "category": "electronics",
   *   "in_stock": true,
   *   "created_at": "2023-01-01T00:00:00.000Z"
   * }
   *
   * @example
   * // Error response
   * GET /api/products/abc
   * Response: 400
   * {
   *   "message": "Invalid product ID"
   * }
   */
  getProductById: async (req: Request, res: Response) => {
    try {
      const productId = getId(req, res);
      if (productId instanceof Response) return; // If getId returned a response, exit

      // Check cache first
      const cacheKey = `product:${productId}`;
      const cachedProduct = await redisClient.get(cacheKey);

      if (cachedProduct) {
        // Return cached product if exists
        return res.status(StatusCodes.OK).json(JSON.parse(cachedProduct));
      }

      // If not in cache, query database
      const product = await db
        .select()
        .from(productTable)
        .where(eq(productTable.id, productId as number))
        .limit(1)
        .then((rows) => rows[0]);

      if (!product) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      // Cache the product with expiration (e.g., 1 hour)
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(product));

      return res.status(StatusCodes.OK).json(product);
    } catch (error) {
      console.error("Error fetching product by ID:", error);
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error fetching product" });
    }
  },

  /**
   * @title Update Product
   * @description Updates an existing product's information in the database and invalidates its cache.
   * Supports partial updates (PATCH semantics) where only provided fields are updated.
   *
   * @route PUT /api/products/:id
   *
   * @param {Request} req Express request object containing:
   *   - Product ID in params
   *   - Update fields in body (name, description, price, category, in_stock)
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with updated product data or error message
   *
   * @throws {400} If product ID is not a valid integer or request body is invalid
   * @throws {404} If product with the specified ID doesn't exist
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response
   * PUT /api/products/123
   * Request Body:
   * {
   *   "name": "Updated Product Name",
   *   "price": 39.99
   * }
   *
   * Response: 200
   * {
   *   "id": 123,
   *   "name": "Updated Product Name",
   *   "description": "Original description remains unchanged",
   *   "price": 39.99,
   *   "category": "electronics",
   *   "in_stock": true,
   *   "created_at": "2023-01-01T00:00:00.000Z",
   *   "updated_at": "2023-09-15T10:30:00.000Z"
   * }
   *
   * @example
   * // Error response - product not found
   * PUT /api/products/999
   * Response: 404
   * {
   *   "message": "Product not found"
   * }
   */
  updateProduct: async (req: Request, res: Response) => {
    try {
      const productId = getId(req, res);
      if (productId instanceof Response) return;

      // Validate request body contains at least one updatable field
      const { name, description, price, category, inStock } = req.body;
      const updatableFields = { name, description, price, category, inStock };

      // Check if at least one valid field is provided
      const hasValidUpdate = Object.values(updatableFields).some(
        (value) => value !== undefined && value !== null
      );

      if (!hasValidUpdate) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "No valid fields provided for update" });
      }

      // Validate price if provided
      if (
        price !== undefined &&
        (isNaN(parseFloat(price)) || parseFloat(price) < 0)
      ) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "Price must be a valid non-negative number" });
      }

      // Build dynamic update object with only provided fields
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = parseFloat(price);
      if (category !== undefined) updateData.category = category;
      if (inStock !== undefined) updateData.inStock = Boolean(inStock);

      // Update product in database
      const updateResult = await db
        .update(productTable)
        .set(updateData)
        .where(eq(productTable.id, productId as number))
        .returning(); // Return the updated record

      if (updateResult.length === 0) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      const updatedProduct = updateResult[0];

      // Invalidate cache for this product
      const cacheKey = `product:${productId}`;
      try {
        await redisClient.del(cacheKey);
        console.log(`Cache invalidated for updated product ${productId}`);
      } catch (redisError) {
        console.error("Cache deletion failed:", redisError);
        // Continue even if cache deletion fails - database is source of truth
      }

      return res.status(StatusCodes.OK).json(updatedProduct);
    } catch (error) {
      console.error("Error updating product:", error);
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error updating product" });
    }
  },

  /**
   * @title Delete Product
   * @description Deletes a product by its ID from the database and invalidates any cached copies.
   * This operation ensures data consistency by removing both the database record and cached version.
   *
   * @route DELETE /api/products/:id
   *
   * @param {Request} req Express request object containing product ID in params
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with success message or error
   *
   * @throws {400} If product ID is not a valid integer
   * @throws {404} If product with the specified ID doesn't exist
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response
   * DELETE /api/products/123
   * Response: 200
   * {
   *   "message": "Product deleted successfully"
   * }
   *
   * @example
   * // Error response - product not found
   * DELETE /api/products/999
   * Response: 404
   * {
   *   "message": "Product not found"
   * }
   *
   * @example
   * // Error response - invalid ID
   * DELETE /api/products/abc
   * Response: 400
   * {
   *   "message": "Invalid product ID"
   * }
   */
  deleteProduct: async (req: Request, res: Response) => {
    try {
      const productId = getId(req, res);
      if (productId instanceof Response) return; // If getId returned a response, exit

      // Delete product from database
      const deleteResult = await db
        .delete(productTable)
        .where(eq(productTable.id, productId as number));

      if (deleteResult.rowCount === 0) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      // Invalidate cache for this product
      const cacheKey = `product:${productId}`;
      try {
        await redisClient.del(cacheKey);
        console.log(`Cache invalidated for product ${productId}`);
      } catch (redisError) {
        console.error("Cache deletion failed:", redisError);
        // Continue even if cache deletion fails - database is source of truth
      }

      return res
        .status(StatusCodes.OK)
        .json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error deleting product" });
    }
  },

  searchProducts: async (req: Request, res: Response) => {},
};
