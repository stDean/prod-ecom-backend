import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "../utils/config";

export const DATABASE_URL = `postgresql://${config.POSTGRES_USER}:${config.POSTGRES_PASSWORD}@${config.POSTGRES_IP}:${config.POSTGRES_PORT}/${config.POSTGRES_DB}`;

export const db = drizzle(DATABASE_URL!);
