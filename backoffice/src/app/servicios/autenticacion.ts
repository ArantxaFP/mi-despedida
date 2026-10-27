import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { configuracionSupabase } from '../configuracion/supabase';

@Injectable({
    providedIn: 'root'
})
export class Autenticacion {
    private supabase = createClient(
        configuracionSupabase.url,
        configuracionSupabase.clavePublica
    );

    async registrar(nombre: string, correo: string, contrasena: string) {
        return this.supabase.auth.signUp({
            email: correo,
            password: contrasena,
            options: {
                data: {
                    nombre
                },
                emailRedirectTo: `${window.location.origin}/acceso`
            }
        });
    }

    async iniciarSesion(correo: string, contrasena: string) {
        return this.supabase.auth.signInWithPassword({
            email: correo,
            password: contrasena
        });
    }

    async cerrarSesion() {
        return this.supabase.auth.signOut();
    }

    async recuperarContrasena(correo: string) {
        return this.supabase.auth.resetPasswordForEmail(correo, {
            redirectTo: `${window.location.origin}/nueva-contrasena`
        });
    }

    async obtenerUsuario() {
        return this.supabase.auth.getUser();
    }
}