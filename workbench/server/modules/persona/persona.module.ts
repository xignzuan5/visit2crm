import { Module } from '@nestjs/common';
import { PersonaController } from './persona.controller';

import { PersonaTools } from '../../mcp/tools/persona.tools';
import { IngestService } from './ingest.service';

@Module({
  controllers: [PersonaController],
  providers: [IngestService, PersonaTools],
})
export class PersonaModule {}
