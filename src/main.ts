import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GlobalHttpExceptionFilter } from "./presentation/http/filters/http-exception.filter";
import { logger } from "./infrastructure/observability/logger.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.info(`Distributed Wagering Processor service started on port ${port}`, {
    port,
    nodeEnv: process.env.NODE_ENV || "development",
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to start application", err);
  process.exit(1);
});
