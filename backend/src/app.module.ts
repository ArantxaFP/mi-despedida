import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ContactosLanzadoresModule } from './contactos-lanzadores/contactos-lanzadores.module';
import { PrismaModule } from './prisma/prisma.module';
import { CorreoModule } from './correo/correo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    SupabaseModule,
    ContactosLanzadoresModule,
    PrismaModule,
    CorreoModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule { }
