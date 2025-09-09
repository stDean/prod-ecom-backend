import {
  integer,
  pgTable,
  varchar,
  decimal,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const productTable = pgTable(
  "products",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    description: varchar({ length: 1000 }).notNull(),
    price: decimal({ precision: 10, scale: 2 }).notNull(),
    category: varchar({ length: 100 }).notNull(),
    inStock: boolean().notNull().default(true),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("name_idx").on(table.name),
    index("category_idx").on(table.category),
    index("price_idx").on(table.price),
    index("in_stock_idx").on(table.inStock),
    index("productId_idx").on(table.id),
  ]
);

export const cartTable = pgTable(
  "cart",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    productId: integer()
      .notNull()
      .references(() => productTable.id, { onDelete: "cascade" }),
    quantity: integer().notNull().default(1),
    unit_price: decimal({ precision: 10, scale: 2 }).notNull(),
    price: decimal({ precision: 10, scale: 2 }).notNull(),
    userId: integer(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    expires_at: timestamp("expires_at").notNull(),
  },
  (table) => [
    // Use table.columnName to reference columns
    unique("unique_cart_item").on(table.productId, table.userId),

    // Indexes for better query performance
    index("product_id_idx").on(table.productId),
    index("user_id_idx").on(table.userId),
    index("expires_at_idx").on(table.expires_at),
    index("created_at_idx").on(table.created_at),
    index("cartId_idx").on(table.id),
  ]
);
