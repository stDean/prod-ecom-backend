import { createClient } from "redis";
import { config } from "../utils/config";

// Initialize client.
export let redisClient = createClient({
  url: `redis://${config.REDIS_URL}:${config.REDIS_PORT}`,
});
