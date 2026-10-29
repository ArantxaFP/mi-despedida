import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContactosLanzadoresController } from './contactos-lanzadores.controller';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';

@Module({
  imports: [
    SupabaseModule,
    PrismaModule
  ],
  controllers: [ContactosLanzadoresController],
  providers: [ContactosLanzadoresService]
})
export class ContactosLanzadoresModule { }
