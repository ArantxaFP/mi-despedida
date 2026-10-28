import { Injectable, signal } from '@angular/core';
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

    recuperacionAutorizada = signal(false);
    comprobandoRecuperacion = signal(true);

    constructor() {
        this.supabase.auth.onAuthStateChange((evento) => {

            if (evento === 'PASSWORD_RECOVERY') {
                this.recuperacionAutorizada.set(true);
                this.comprobandoRecuperacion.set(false);
            }

            if (evento === 'INITIAL_SESSION') {
                this.comprobandoRecuperacion.set(false);
            }

            if (evento === 'SIGNED_OUT' || evento === 'SIGNED_IN') {
                this.recuperacionAutorizada.set(false);
            }

            if (evento === 'SIGNED_OUT') {
                this.comprobandoRecuperacion.set(false);
            }
        });
    }

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

    async cambiarContrasena(nuevaContrasena: string) {
        return this.supabase.auth.updateUser({
            password: nuevaContrasena
        });
    }
}