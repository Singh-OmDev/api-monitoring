import express from "express";
import cors from "cors";
import helmet from "helmet";

import config from "./shared/config/index.js";
import logger from "./shared/config/logger.js";
import mongodb from "./shared/config/mongodb.js";
import postgres from "./shared/config/postgres.js";
import rabbitmq from "./shared/config/rabbitmq.js";

import errorHandler from "./shared/middlewares/errorHandler.js";
import ResponseFormatter from "./shared/utils/responseFormatter.js";

const app = express();

/**
 * Middlewares
 */
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  next();
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.status(200).json(
    ResponseFormatter.success(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
      "Service is healthy"
    )
  );
});

/**
 * Root route
 */
app.get("/", (req, res) => {
  res.status(200).json(
    ResponseFormatter.success(
      {
        service: "API Hit Monitoring System",
        version: "1.0.0",
      },
      "API running"
    )
  );
});

/**
 * 404
 */
app.use((req, res) => {
  res.status(404).json(ResponseFormatter.error("Endpoint not found", 404));
});

/**
 * Error handler
 */
app.use(errorHandler);

/**
 * Initialize connections
 */
async function initializeConnection() {
  logger.info("Initializing database connections...");

  await mongodb.connect();
  await postgres.testConnection();
  await rabbitmq.connect();

  logger.info("All connections established successfully");
}

/**
 * Start server
 */
async function startServer() {
  try {
    await initializeConnection();

    const PORT = config.PORT || 5000;

    const server = app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
      logger.info(`Environment: ${config.NODE_ENV}`);
      logger.info(`API: http://localhost:${PORT}`);
    });

    /**
     * Graceful shutdown
     */
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);

      server.close(async () => {
        try {
          await mongodb.disconnect();
          await postgres.close();
          await rabbitmq.close();

          logger.info("All connections closed");
          process.exit(0);
        } catch (error) {
          logger.error("Shutdown error:", error);
          process.exit(1);
        }
      });

      setTimeout(() => {
        logger.error("Force shutdown");
        process.exit(1);
      }, 10000);
    };

    // Signals
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

    // Errors
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Rejection:", reason);
      gracefulShutdown("unhandledRejection");
    });

  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();