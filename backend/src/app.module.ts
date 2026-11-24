import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ContactosLanzadoresModule } from './contactos-lanzadores/contactos-lanzadores.module';
import { PrismaModule } from './prisma/prisma.module';
import { CorreoModule } from './correo/correo.module';
import { InvitacionesLanzadoresModule } from './invitaciones-lanzadores/invitaciones-lanzadores.module';
import { CuentasModule } from './cuentas/cuentas.module';
import { ContactosDestinatariosModule } from './contactos-destinatarios/contactos-destinatarios.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { isIP } from 'node:net';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    // Limitación de peticiones para los endpoints públicos protegidos
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 10
        }
      ],
      getTracker: (req) => {

        // En Render, el tráfico llega a través de Cloudflare
        if (process.env.RENDER === 'true') {
          const ipRender = req.headers?.['cf-connecting-ip'];

          if (typeof ipRender === 'string' && isIP(ipRender) !== 0) {
            return ipRender;
          }
        }

        // En desarrollo local, utiliza la IP de la conexión.
        return req.ip || req.socket?.remoteAddress || 'ip-no-disponible';
      }
    }),
    SupabaseModule,
    ContactosLanzadoresModule,
    PrismaModule,
    CorreoModule,
    InvitacionesLanzadoresModule,
    CuentasModule,
    ContactosDestinatariosModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule { }
