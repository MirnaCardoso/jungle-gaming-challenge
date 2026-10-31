import { Controller, Get, HttpStatus, Res, Optional, Inject } from "@nestjs/common";
import { Response } from "express";
import { EntityManager } from "@mikro-orm/core";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";

@Controller("health")
export class HealthController {
  private readonly sqsClient: SQSClient;

  constructor(@Optional() private readonly em?: EntityManager) {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
  }

  @Get("live")
  getLive(@Res() res: Response) {
    return res.status(HttpStatus.OK).json({
      status: "UP",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  @Get("ready")
  async getReady(@Res() res: Response) {
    let dbStatus = "UP";
    let sqsStatus = "UP";

    // 1. Check PostgreSQL
    try {
      if (this.em) {
        await this.em.getConnection().execute("SELECT 1");
      }
    } catch {
      dbStatus = "DOWN";
    }

    // 2. Check SQS
    try {
      await this.sqsClient.send(new ListQueuesCommand({ MaxResults: 1 }));
    } catch {
      sqsStatus = "DOWN";
    }

    const isHealthy = dbStatus === "UP" && sqsStatus === "UP";
    const statusCode = isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: isHealthy ? "UP" : "DOWN",
      components: {
        database: dbStatus,
        sqs: sqsStatus,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
