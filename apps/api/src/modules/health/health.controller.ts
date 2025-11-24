import { Inject, Controller, Get } from "@nestjs/common";
import { Queue } from "bullmq";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      ok: true,
      ts: new Date().toISOString(),
    };
  }

  constructor(@Inject("ADVICE_QUEUE") private readonly adviceQueue: Queue) {}

  @Get("bullmq-test")
  async bullmqTest() {
    const job = await this.adviceQueue.add("test", { hello: "world" });
    return { jobId: job.id };
  }
}
