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

    // Registro
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

    // Inicio se sesión
    async iniciarSesion(correo: string, contrasena: string) {
        return this.supabase.auth.signInWithPassword({
            email: correo,
            password: contrasena
        });
    }

    // Cerrar sesión
    async cerrarSesion() {
        return this.supabase.auth.signOut();
    }

    // Recuperación de contraseña
    async recuperarContrasena(correo: string) {
        return this.supabase.auth.resetPasswordForEmail(correo, {
            redirectTo: `${window.location.origin}/nueva-contrasena`
        });
    }

    // Obtener usuario autenticado
    async obtenerUsuario() {
        return this.supabase.auth.getUser();
    }

    // Cambiar contraseña
    async cambiarContrasena(nuevaContrasena: string) {
        return this.supabase.auth.updateUser({
            password: nuevaContrasena
        });
    }

    // Actualizar nombre o apellido
    async actualizarDatosPersonales(nombre: string, apellidos: string) {
        return this.supabase.auth.updateUser({
            data: {
                nombre,
                apellidos
            }
        });
    }

    // Cambiar correo
    async cambiarCorreo(nuevoCorreo: string) {
        return this.supabase.auth.updateUser(
            {
                email: nuevoCorreo
            },
            {
                emailRedirectTo: `${window.location.origin}/panel/perfil`
            }
        );
    }
}
