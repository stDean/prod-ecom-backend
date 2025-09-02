import "dotenv/config";
import express from "express";
import { db } from "./db/index";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    database: "CONNECTED", // You could add actual DB check here
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  try {
    // Explicitly connect to the database before starting the server
    await db.execute("SELECT 1"); // or use your database's connection method (e.g. authenticate())
    console.log("Database connected successfully");

    // Start the server after database connection is established
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Error starting server:", err);
  }
}

startServer();
