import { Module } from '@nestjs/common';
import { ContactosDestinatariosController } from './contactos-destinatarios.controller';
import { ContactosDestinatariosService } from './contactos-destinatarios.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CuentasModule } from '../cuentas/cuentas.module';

@Module({
    imports: [
        PrismaModule,
        SupabaseModule,
        CuentasModule
    ],
    controllers: [
        ContactosDestinatariosController
    ],
    providers: [
        ContactosDestinatariosService
    ]
})
export class ContactosDestinatariosModule {}
