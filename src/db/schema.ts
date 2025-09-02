import {
  integer,
  pgTable,
  varchar,
  decimal,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const productTable = pgTable("products", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  description: varchar({ length: 1000 }).notNull(),
  price: decimal({ precision: 10, scale: 2 }).notNull(),
  category: varchar({ length: 100 }).notNull(),
  inStock: boolean().notNull().default(true),
  created_at: timestamp().defaultNow().notNull(),
});
