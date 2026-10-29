import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ContactosLanzadoresModule } from './contactos-lanzadores/contactos-lanzadores.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    SupabaseModule,
    ContactosLanzadoresModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule { }
