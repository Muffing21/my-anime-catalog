import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { PORT, NODE_ENV } from "./config/constants.config";
import { connectDb } from "./config/db.config";
import { errorHandler, errorRoute } from "./middleware/error.middleware";
import healthCheckRouter from "./pkg/healthcheck/healthcheck.router";

export const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
if (NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/healthz", healthCheckRouter);
// feature routers mounted here in later tasks

app.use(errorRoute);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, async () => {
    await connectDb();
    console.log(`Server running on port ${PORT}`);
  });
}
