import { and, eq, isNull } from "drizzle-orm";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { db } from "../db";
import { redisClient } from "../db/redis";
import { cartTable } from "../db/schema";

export const CartCtrl = {
  /**
   * @title Add Item to Cart
   * @description Adds a product to the user's shopping cart with Redis caching for session-based carts
   * Stores cart items in Redis for fast access and maintains database as persistent storage
   *
   * @route POST /api/cart/items
   *
   * @param {Request} req Express request object containing:
   *   - sessionId (from middleware or cookies)
   *   - productId, quantity, price, expires_at in body
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with success message or error
   *
   * @throws {400} If required fields are missing or invalid
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response
   * POST /api/cart/items
   * Request Body:
   * {
   *   "productId": 123,
   *   "quantity": 2,
   *   "price": 29.99,
   *   "expires_at": "2023-12-31T23:59:59.000Z"
   * }
   *
   * Response: 200
   * {
   *   "message": "Product added to cart.",
   *   "cartItem": {...details}
   * }
   */
  addCartItem: async (req: Request, res: Response) => {
    try {
      const { productId, quantity, price, expires_at, user_id } = req.body;
      // Validate inputs
      if (!productId || !price) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "Product ID and price are required." });
      }

      // Calculate total price for this item
      const qty = quantity || 1;
      const unitPrice = parseFloat(price);

      // Create cart item object
      const cartItem = {
        productId: parseInt(productId),
        quantity: qty,
        price: unitPrice,
        unit_price: unitPrice,
        expires_at: expires_at
          ? new Date(expires_at)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
        userId: user_id || null,
        added_at: new Date(),
      };

      // Redis key for this session's cart
      const cartKey = `cart:${user_id || "guest"}`;

      // Add to Redis cache (using hash to store multiple items)
      await redisClient.hSet(
        cartKey,
        productId.toString(),
        JSON.stringify(cartItem)
      );

      // Set expiration for the entire cart (e.g., 30 days)
      await redisClient.expire(cartKey, 30 * 24 * 60 * 60);

      // Insert the cart item into the database
      await db.insert(cartTable).values({
        productId,
        quantity: qty,
        price: unitPrice.toString(),
        unit_price: unitPrice.toString(),
        expires_at: new Date(expires_at),
        userId: user_id || null,
      });

      res
        .status(StatusCodes.OK)
        .json({ message: "Product added to cart.", cartItem });
    } catch (error) {
      console.error("Error adding item to cart:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },

  /**
   * @title Get Cart Items
   * @description Retrieves all items from the user's shopping cart
   * First checks Redis cache, falls back to database if not found
   *
   * @route GET /api/cart/items
   */
  retrieveCartItems: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.query;
      // if (!user_id) {
      //   return res
      //     .status(StatusCodes.BAD_REQUEST)
      //     .json({ message: "User ID is required" });
      // }

      const cartKey = `cart:${user_id || "guest"}`;

      // Try to get from Redis first
      const cartItems = await redisClient.hGetAll(cartKey);
      if (Object.keys(cartItems).length > 0) {
        // Parse Redis data and calculate cart totals
        const parsedItems = Object.values(cartItems).map((item) =>
          JSON.parse(item)
        );
        const cartTotal = parsedItems.reduce(
          (total, item) => total + item.price,
          0
        );
        const itemCount = parsedItems.reduce(
          (count, item) => count + item.quantity,
          0
        );

        return res.status(StatusCodes.OK).json({
          message: "Cart items retrieved from cache.",
          items: parsedItems,
          total: cartTotal,
          itemCount: itemCount,
        });
      }

      // Fall back to database if not in Redis
      const dbItems = await db
        .select()
        .from(cartTable)
        .where(eq(cartTable.userId, Number(user_id)));

      // Store in Redis for future requests
      for (const item of dbItems) {
        await redisClient.hSet(
          cartKey,
          item.productId.toString(),
          JSON.stringify(item)
        );
      }

      // Set expiration
      await redisClient.expire(cartKey, 30 * 24 * 60 * 60);

      // Calculate totals for database items
      const cartTotal = dbItems.reduce(
        (total, item) => total + parseFloat(item.price),
        0
      );
      const itemCount = dbItems.reduce(
        (count, item) => count + item.quantity,
        0
      );

      res.status(StatusCodes.OK).json({
        message: "Cart items retrieved from database.",
        items: dbItems,
        total: cartTotal,
        itemCount: itemCount,
      });
    } catch (error) {
      console.error("Error retrieving cart items:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },

  /**
   * @title Update Cart Item Quantity
   * @description Updates the quantity of a specific item in the cart
   * Supports incrementing/decrementing with automatic removal when quantity reaches zero
   * Price is calculated based on the unit price stored when the item was added to cart
   *
   * @route PATCH /api/cart/items/:productId
   *
   * @param {Request} req Express request object containing:
   *   - productId in params
   *   - action (increment/decrement) in body
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with updated quantity or removal confirmation
   *
   * @throws {400} If session ID is missing or invalid action provided
   * @throws {404} If product not found in cart
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Increment quantity
   * PATCH /api/cart/items/123
   * Request Body:
   * {
   *   "action": "increment"
   * }
   *
   * @example
   * // Decrement quantity
   * PATCH /api/cart/items/123
   * Request Body:
   * {
   *   "action": "decrement"
   * }
   */
  updateCartItem: async (req: Request, res: Response) => {
    try {
      const { action } = req.body;
      const { productId } = req.params;
      const { user_id } = req.query;

      if (!action || !["increment", "decrement"].includes(action)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: "Valid action (increment/decrement) is required.",
        });
      }

      const cartKey = `cart:${user_id || "guest"}`;

      // Update Redis
      const existingItem = await redisClient.hGet(cartKey, productId);

      if (!existingItem) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ message: "Product not found in cart." });
      }

      const itemData = JSON.parse(existingItem);

      // Ensure all numeric values are properly parsed
      const currentQuantity = parseInt(itemData.quantity);
      const unitPrice = parseFloat(
        itemData.unit_price || itemData.price / currentQuantity
      );

      // Calculate new quantity
      let newQuantity = itemData.quantity;

      if (action === "increment") {
        newQuantity += 1;
      } else if (action === "decrement") {
        newQuantity -= 1;

        // Remove item if quantity reaches zero
        if (newQuantity <= 0) {
          // Remove from Redis
          await redisClient.hDel(cartKey, productId);

          // Remove from database
          await db
            .delete(cartTable)
            .where(
              and(
                eq(cartTable.userId, Number(user_id)),
                eq(cartTable.productId, parseInt(productId))
              )
            );

          return res.status(StatusCodes.OK).json({
            message: "Item removed from cart.",
            productId: parseInt(productId),
            action: "removed",
          });
        }
      }

      // Calculate new total price based on unit price
      const newTotalPrice = unitPrice * newQuantity;

      // Update Redis
      const updatedItemData = {
        ...itemData,
        quantity: newQuantity,
        price: newTotalPrice,
      };

      await redisClient.hSet(
        cartKey,
        productId,
        JSON.stringify(updatedItemData)
      );

      console.log("Updated item in Redis:", updatedItemData);

      // Update database
      await db
        .update(cartTable)
        .set({
          quantity: newQuantity,
          price: newTotalPrice.toString(),
        })
        .where(
          and(
            eq(cartTable.userId, Number(user_id)),
            eq(cartTable.productId, parseInt(productId))
          )
        );

      res.status(StatusCodes.OK).json({
        message: "Cart item quantity updated.",
        productId: parseInt(productId),
        newQuantity,
        newTotalPrice,
        action: "updated",
      });
    } catch (error) {
      console.error("Error updating cart item quantity:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ message: "Error updating cart item quantity." });
    }
  },

  /**
   * @title Remove Item from Cart
   * @description Removes a specific item from the cart
   * Removes from both Redis cache and database
   *
   * @route DELETE /api/cart/items/:productId
   */
  removeCartItem: async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { user_id } = req.query;

      const cartKey = `cart:${user_id || "guest"}`;

      // Remove from Redis
      await redisClient.hDel(cartKey, productId);

      // Remove from database
      await db
        .delete(cartTable)
        .where(
          and(
            eq(cartTable.userId, Number(user_id)),
            eq(cartTable.productId, parseInt(productId))
          )
        );

      res.status(StatusCodes.OK).json({ message: "Cart item deleted." });
    } catch (error) {
      console.error("Error deleting cart item:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },

  /**
   * @title Clear Entire Cart
   * @description Removes all items from the user's shopping cart
   * Clears both Redis cache and database entries for the session
   *
   * @route DELETE /api/cart
   *
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with success message or error
   *
   * @throws {400} If session ID is missing
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response
   * DELETE /api/cart
   * Response: 200
   * {
   *   "message": "Cart cleared successfully."
   * }
   */
  clearCart: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.query;
      // if (!user_id) {
      //   return res
      //     .status(StatusCodes.BAD_REQUEST)
      //     .json({ message: "User ID is required" });
      // }

      const cartKey = `cart:${user_id || "guest"}`;

      // Clear Redis cache
      await redisClient.del(cartKey);

      // Clear database entries
      await db.delete(cartTable).where(eq(cartTable.userId, Number(user_id)));

      res
        .status(StatusCodes.OK)
        .json({ message: "Cart cleared successfully." });
    } catch (error) {
      console.log("Error clearing cart:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },

  /**
   * @title Get Cart Total
   * @description Calculates the total value and item count of the user's shopping cart
   * First checks Redis cache for cart items, falls back to database if not found in cache
   * Returns both the monetary total and total quantity of items in the cart
   *
   * @route GET /api/cart/total
   *
   * @param {Request} req Express request object containing:
   *   - user_id in query parameters (optional, defaults to "guest" if not provided)
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with cart total information or error message
   *
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful response for authenticated user
   * GET /api/cart/total?user_id=123
   * Response: 200
   * {
   *   "message": "Cart total calculated.",
   *   "total": 149.97,
   *   "itemCount": 3
   * }
   *
   * @example
   * // Successful response for guest user
   * GET /api/cart/total
   * Response: 200
   * {
   *   "message": "Cart total calculated.",
   *   "total": 49.99,
   *   "itemCount": 1
   * }
   *
   * @example
   * // Error response
   * Response: 500
   * {
   *   "error": "Internal server error."
   * }
   */

  getCartTotal: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.query;
      // if (!user_id) {
      //   return res
      //     .status(StatusCodes.BAD_REQUEST)
      //     .json({ message: "User ID is required" });
      // }

      const cartKey = `cart:${user_id || "guest"}`;

      // Get all items from Redis
      const cartItems = await redisClient.hGetAll(cartKey);

      // Calculate total
      let total = 0;
      let itemCount = 0;

      if (Object.keys(cartItems).length > 0) {
        Object.values(cartItems).forEach((item) => {
          const itemData = JSON.parse(item);
          total += itemData.price;
          itemCount += itemData.quantity;
        });
      } else {
        // Fall back to database
        const dbItems = await db
          .select()
          .from(cartTable)
          .where(eq(cartTable.userId, Number(user_id)));

        dbItems.forEach((item) => {
          total += parseFloat(item.price);
          itemCount += item.quantity;
        });
      }

      res.status(StatusCodes.OK).json({
        message: "Cart total calculated.",
        total,
        itemCount,
      });
    } catch (error) {
      console.error("Error calculating cart total:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },

  /**
   * @title Merge Carts
   * @description Merges items from a guest cart into a user's cart after authentication
   * Handles both adding new items and updating quantities for existing items
   * Transfers guest cart items to the user's cart and removes the guest cart
   *
   * @route POST /api/cart/merge
   *
   * @param {Request} req Express request object containing:
   *   - user_id in request body (required)
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} Sends JSON response with merge result or error message
   *
   * @throws {400} If user_id is not provided in the request body
   * @throws {500} If there's a server error during the operation
   *
   * @example
   * // Successful merge with items
   * POST /api/cart/merge
   * Request Body:
   * {
   *   "user_id": 123
   * }
   * Response: 200
   * {
   *   "message": "Carts merged successfully"
   * }
   *
   * @example
   * // Successful response when no items to merge
   * POST /api/cart/merge
   * Request Body:
   * {
   *   "user_id": 123
   * }
   * Response: 200
   * {
   *   "message": "No items to merge"
   * }
   *
   * @example
   * // Error response - missing user_id
   * Response: 400
   * {
   *   "message": "User ID are required"
   * }
   *
   * @example
   * // Error response - server error
   * Response: 500
   * {
   *   "error": "Internal server error."
   * }
   *
   * @notes
   * - This function is typically called after a user logs in or registers
   * - It transfers items from the guest cart (stored under key "cart:guest") to the user's cart
   * - For items that already exist in the user's cart, quantities are summed
   * - For new items, they are simply added to the user's cart
   * - The guest cart is deleted after a successful merge
   * - Both Redis cache and database are updated to maintain consistency
   */
  mergeCarts: async (req: Request, res: Response) => {
    try {
      const { user_id } = req.body;

      if (!user_id) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "User ID are required" });
      }

      const guestCartKey = `cart:guest`;
      const userCartKey = `cart:${user_id}`;

      // Get guest cart items
      const guestItems = await redisClient.hGetAll(guestCartKey);

      if (Object.keys(guestItems).length === 0) {
        return res
          .status(StatusCodes.OK)
          .json({ message: "No items to merge" });
      }

      // Get user cart items
      const userItems = await redisClient.hGetAll(userCartKey);

      // Merge carts
      for (const [productId, itemJson] of Object.entries(guestItems)) {
        const guestItem = JSON.parse(itemJson);

        if (userItems[productId]) {
          // Item already exists in user cart - update quantity
          const userItem = JSON.parse(userItems[productId]);
          const newQuantity = userItem.quantity + guestItem.quantity;
          const newPrice = userItem.unitPrice * newQuantity;

          // Update user cart
          await redisClient.hSet(
            userCartKey,
            productId,
            JSON.stringify({
              ...userItem,
              quantity: newQuantity,
              price: newPrice,
            })
          );

          // Update database
          await db
            .update(cartTable)
            .set({
              quantity: newQuantity,
              price: newPrice.toString(),
            })
            .where(
              and(
                eq(cartTable.userId, Number(user_id)),
                eq(cartTable.productId, parseInt(productId))
              )
            );
        } else {
          // Item doesn't exist in user cart - add it
          await redisClient.hSet(userCartKey, productId, itemJson);

          // Update database to change userId from guest to user
          await db
            .update(cartTable)
            .set({
              userId: user_id,
            })
            .where(
              and(
                isNull(cartTable.userId),
                eq(cartTable.productId, parseInt(productId))
              )
            );
        }
      }

      // Delete guest cart
      await redisClient.del(guestCartKey);

      res.status(StatusCodes.OK).json({ message: "Carts merged successfully" });
    } catch (error) {
      console.error("Error merging carts:", error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error." });
    }
  },
};
