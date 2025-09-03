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
const PRODUCT_CACHE_PREFIX = "product:";
const PRODUCTS_CACHE_PREFIX = "products:";

// Helper functions
const getId = (req: Request, res: Response): number | null => {
  const id = parseInt(req.params.id);
  return isNaN(id)
    ? (res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: "Invalid product ID" }),
      null)
    : id;
};

const invalidateCachePattern = async (pattern: string): Promise<void> => {
  try {
    let cursor = "0";
    do {
      const res = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });
      cursor = res.cursor;
      if (res.keys.length > 0) await redisClient.del(res.keys);
    } while (cursor !== "0");
  } catch (error) {
    console.error("Cache invalidation failed:", error);
  }
};

const handleServerError = (
  res: Response,
  error: unknown,
  message: string
): Response => {
  console.error(message, error);
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message });
};

const buildProductsCacheKey = (
  params: Record<string, string | number | any>
): string => {
  return Object.entries(params)
    .reduce((key, [k, v]) => `${key}${k}:${v}:`, PRODUCTS_CACHE_PREFIX)
    .slice(0, -1);
};

const getPaginationParams = (req: Request) => {
  const page = Math.max(parseInt(req.query.page as string) || DEFAULT_PAGE, 1);
  const limit = Math.min(
    parseInt(req.query.limit as string) || DEFAULT_LIMIT,
    MAX_LIMIT
  );
  return { page, limit };
};

const validSortColumns: Record<string, any> = {
  id: productTable.id,
  name: productTable.name,
  price: productTable.price,
  category: productTable.category,
  created_at: productTable.created_at,
};

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

      if (!name || !description || !price || !category) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "Missing required fields" });
      }

      await db.insert(productTable).values({
        name,
        description,
        price,
        category,
        inStock: inStock ?? true,
      });

      await invalidateCachePattern(`${PRODUCTS_CACHE_PREFIX}*`);
      return res
        .status(StatusCodes.CREATED)
        .json({ message: "Product created" });
    } catch (error) {
      return handleServerError(res, error, "Error creating product");
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
      const { page, limit } = getPaginationParams(req);
      const sortBy = (req.query.sortBy as string) || "createdAt";
      const sortOrder = (req.query.sortOrder as string) === "desc" ? desc : asc;
      const category = req.query.category as string;

      const offset = (page - 1) * limit;
      const cacheKey = buildProductsCacheKey({
        page,
        limit,
        sortBy,
        sortOrder,
        category,
      });

      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          const { products, totalCount, totalPages } = JSON.parse(cachedData);
          return res.json({
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
      }

      const whereConditions = category
        ? [eq(productTable.category, category)]
        : [];
      const totalCountResult = await db
        .select({ count: count() })
        .from(productTable)
        .where(whereConditions.length ? and(...whereConditions) : undefined);

      const totalCount = totalCountResult[0]?.count || 0;
      const totalPages = Math.ceil(totalCount / limit);
      const sortColumn = validSortColumns[sortBy] || productTable.created_at;

      const products = await db
        .select()
        .from(productTable)
        .where(whereConditions.length ? and(...whereConditions) : undefined)
        .orderBy(sortOrder(sortColumn))
        .limit(limit)
        .offset(offset);

      const responseData = {
        products,
        pagination: { page, limit, totalCount, totalPages },
      };

      try {
        await redisClient.set(cacheKey, JSON.stringify(responseData), {
          EX: CACHE_TTL,
        });
      } catch (redisError) {
        console.error("Cache set error:", redisError);
      }

      return res.json({
        ...responseData,
        pagination: {
          ...responseData.pagination,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      return handleServerError(res, error, "Error fetching products");
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
      if (productId === null) return;

      const cacheKey = `${PRODUCT_CACHE_PREFIX}${productId}`;

      try {
        const cachedProduct = await redisClient.get(cacheKey);
        if (cachedProduct) return res.json(JSON.parse(cachedProduct));
      } catch (error) {
        console.error("Redis error:", error);
      }

      const product = await db
        .select()
        .from(productTable)
        .where(eq(productTable.id, productId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!product) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      try {
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(product));
      } catch (error) {
        console.error("Cache set error:", error);
      }

      return res.json(product);
    } catch (error) {
      return handleServerError(res, error, "Error fetching product");
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
      if (productId === null) return;

      const { name, description, price, category, inStock } = req.body;
      const updatableFields = { name, description, price, category, inStock };

      if (
        Object.values(updatableFields).every(
          (v) => v === undefined || v === null
        )
      ) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "No valid fields provided for update" });
      }

      if (
        price !== undefined &&
        (isNaN(parseFloat(price)) || parseFloat(price) < 0)
      ) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "Price must be a valid non-negative number" });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = parseFloat(price);
      if (category !== undefined) updateData.category = category;
      if (inStock !== undefined) updateData.inStock = Boolean(inStock);

      const updateResult = await db
        .update(productTable)
        .set(updateData)
        .where(eq(productTable.id, productId))
        .returning();

      if (updateResult.length === 0) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      await Promise.all([
        invalidateCachePattern(`${PRODUCTS_CACHE_PREFIX}*`),
        redisClient.del(`${PRODUCT_CACHE_PREFIX}${productId}`),
      ]);

      return res.json(updateResult[0]);
    } catch (error) {
      return handleServerError(res, error, "Error updating product");
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
      if (productId === null) return;

      const deleteResult = await db
        .delete(productTable)
        .where(eq(productTable.id, productId));

      if (deleteResult.rowCount === 0) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found" });
      }

      await Promise.all([
        invalidateCachePattern(`${PRODUCTS_CACHE_PREFIX}*`),
        redisClient.del(`${PRODUCT_CACHE_PREFIX}${productId}`),
      ]);

      return res.json({ message: "Product deleted successfully" });
    } catch (error) {
      return handleServerError(res, error, "Error deleting product");
    }
  },
};
