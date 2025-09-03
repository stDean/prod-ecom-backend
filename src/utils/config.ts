import { CorsOptions } from "cors";

export const config = {
  POSTGRES_IP: process.env.POSTGRES_IP || "db",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "example",
  POSTGRES_USER: process.env.POSTGRES_USER || "user",
  POSTGRES_DB: process.env.POSTGRES_DB || "ecomDB",
  POSTGRES_PORT: process.env.POSTGRES_PORT || 5432,
  REDIS_URL: process.env.REDIS_URL || "redis",
  REDIS_PORT: process.env.REDIS_PORT || 6379,
};

const allowedOrigins = [
  "http://localhost:3000",
  /* ... add other origins here */
];

export const corsOptions: CorsOptions = {
  origin: function (origin, cb) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,POST,PUT,PATCH,DELETE,HEAD",
  credentials: true,
  allowedHeaders: "Content-Type,Authorization",
  maxAge: 86400,
};
