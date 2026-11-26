import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { PersonaModule } from './modules/persona/persona.module';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot({
      mcp: {
        serverName: 'sales-persona',
        instructions:
          '同步已确认的销售拜访时，先用 persona_ingested 核对已有拜访和在跟商机，再用 persona_ingest 写入销售、商机和拜访。按逐条返回的原因修正记录后可重复提交。',
      },
    }),
    // ====== @route-section: business-modules START ======
    PersonaModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
