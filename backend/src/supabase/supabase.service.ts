import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    createClient,
    SupabaseClient
} from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {

    private readonly cliente: SupabaseClient;

    constructor(
        private readonly configService: ConfigService
    ) {
        const url = this.configService.getOrThrow<string>(
            'SUPABASE_URL'
        );

        const clavePrivada = this.configService.getOrThrow<string>(
            'SUPABASE_SECRET_KEY'
        );

        this.cliente = createClient(url, clavePrivada, {
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

    async verificarUsuario(token: string) {
        return this.cliente.auth.getUser(token);
    }
}
