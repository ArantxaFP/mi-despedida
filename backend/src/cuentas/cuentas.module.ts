import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';

import { BloqueosEdicionCuentasService } from './bloqueos-edicion-cuentas.service';
import { CorreoService } from '../correo/correo.service';

@Module({
    imports: [
        SupabaseModule,
        PrismaModule
    ],
    controllers: [CuentasController],
    providers: [CuentasService,
        BloqueosEdicionCuentasService,
        CorreoService
    ],
    exports: [CuentasService]
})
export class CuentasModule { }
