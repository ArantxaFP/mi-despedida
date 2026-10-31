import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CorreoModule } from '../correo/correo.module';
import { InvitacionesLanzadoresController } from './invitaciones-lanzadores.controller';
import { InvitacionesLanzadoresService } from './invitaciones-lanzadores.service';

@Module({
    imports: [
        PrismaModule,
        CorreoModule
    ],
    controllers: [
        InvitacionesLanzadoresController
    ],
    providers: [
        InvitacionesLanzadoresService
    ]
})
export class InvitacionesLanzadoresModule { }
