import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';

@Module({
    imports: [
        SupabaseModule,
        PrismaModule
    ],
    controllers: [CuentasController],
    providers: [CuentasService],
    exports: [CuentasService]
})
export class CuentasModule { }
