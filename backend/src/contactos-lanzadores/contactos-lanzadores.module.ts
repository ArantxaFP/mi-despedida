import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ContactosLanzadoresController } from './contactos-lanzadores.controller';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ContactosLanzadoresController],
  providers: [ContactosLanzadoresService]
})
export class ContactosLanzadoresModule { }
