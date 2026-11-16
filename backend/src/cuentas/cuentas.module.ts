import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';

import { BloqueosEdicionCuentasService } from './bloqueos-edicion-cuentas.service';

@Module({
    imports: [
        SupabaseModule,
        PrismaModule
    ],
    controllers: [CuentasController],
    providers: [CuentasService,
    BloqueosEdicionCuentasService],
    exports: [CuentasService]
})
export class CuentasModule { }
