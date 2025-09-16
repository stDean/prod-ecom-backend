import rateLimit from "express-rate-limit";

// Create a rate limiter for search endpoint
export const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many search requests, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many search requests",
      message: "Please try again after 15 minutes",
      retryAfter: 15 * 60, // 15 minutes in seconds
    });
  },
});
