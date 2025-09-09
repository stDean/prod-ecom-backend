import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db/index";
import { corsOptions } from "./utils/config";
import { redisClient } from "./db/redis";
import productRoutes from "./routes/products.r";
import cartRouter from "./routes/cart.r";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors(corsOptions));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    database: "CONNECTED", // You could add actual DB check here
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/products", productRoutes);
app.use("/api/v1/cart", cartRouter);

async function startServer() {
  try {
    // Explicitly connect to the database before starting the server
    await db.execute("SELECT 1"); // or use your database's connection method (e.g. authenticate())
    console.log("Database connected successfully");

    await redisClient
      .on("error", (err) => console.log("Redis Client Error", err))
      .connect();
    console.log("Redis connected successfully");

    // Start the server after database connection is established
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Error starting server:", err);
  }
}

startServer();
