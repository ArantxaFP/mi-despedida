import { Module } from '@nestjs/common';
import { CorreoService } from './correo.service';

@Module({
  providers: [CorreoService]
})
export class CorreoModule {}
