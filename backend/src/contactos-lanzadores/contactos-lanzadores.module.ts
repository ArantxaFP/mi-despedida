import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContactosLanzadoresController } from './contactos-lanzadores.controller';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';
import { CorreoModule } from '../correo/correo.module';
import { CuentasModule } from '../cuentas/cuentas.module';

@Module({
  imports: [
    SupabaseModule,
    PrismaModule,
    CorreoModule,
    CuentasModule
  ],
  controllers: [ContactosLanzadoresController],
  providers: [ContactosLanzadoresService]
})
export class ContactosLanzadoresModule { }
