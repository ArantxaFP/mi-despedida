import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {

    private readonly cliente: SupabaseClient;
    private readonly clienteRegistro: SupabaseClient;

    constructor(
        private readonly configService: ConfigService
    ) {
        const url = this.configService.getOrThrow<string>(
            'SUPABASE_URL'
        );

        const clavePrivada = this.configService.getOrThrow<string>(
            'SUPABASE_SECRET_KEY'
        );

        const clavePublica = this.configService.getOrThrow<string>(
            'SUPABASE_PUBLISHABLE_KEY'
        );

        // Cliente privado para operaciones del backend
        this.cliente = createClient(url, clavePrivada, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        });

        // Cliente público para registrar usuarios en Supabase Auth
        // manteniendo el proceso de confirmación de correo.
        this.clienteRegistro = createClient(url, clavePublica, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        });
    }

    obtenerCliente(): SupabaseClient {
        return this.cliente;
    }

    obtenerClienteRegistro(): SupabaseClient {
        return this.clienteRegistro;
    }

    async verificarUsuario(token: string) {
        return this.cliente.auth.getUser(token);
    }
}
