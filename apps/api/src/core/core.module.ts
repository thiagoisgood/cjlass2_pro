import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AgentGatewayService } from "./agent-gateway.service.js";
import { AuthService } from "./auth.service.js";
import { CoreController } from "./core.controller.js";
import { CoreService } from "./core.service.js";
import { JsonStateStore } from "./json-state.store.js";
import { NotificationProviderService } from "./notification-provider.service.js";
import { NotificationQueueService } from "./notification-queue.service.js";
import { ApiAuthGuard } from "./request-context.js";

@Module({
  controllers: [CoreController],
  providers: [
    AgentGatewayService,
    AuthService,
    CoreService,
    JsonStateStore,
    NotificationProviderService,
    NotificationQueueService,
    {
      provide: APP_GUARD,
      useClass: ApiAuthGuard,
    },
  ],
  exports: [AgentGatewayService, CoreService],
})
export class CoreModule {}
