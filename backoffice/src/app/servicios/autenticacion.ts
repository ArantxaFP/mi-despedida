import { Injectable, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { configuracionSupabase } from '../configuracion/supabase';
import { configuracionBackend } from '../configuracion/backend';

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
    // NestJS coordina el alta en Supabase Auth y PostgreSQL.
    async registrar(
        nombre: string,
        correo: string,
        contrasena: string
    ): Promise<{ error: Error | null }> {

        try {
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/registro`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        nombre,
                        correo,
                        contrasena
                    })
                }
            );

            if (!respuesta.ok) {
                return {
                    error: new Error(
                        'No se ha podido completar el registro.'
                    )
                };
            }

            return {
                error: null
            };

        } catch {
            return {
                error: new Error(
                    'No se ha podido conectar con el backend.'
                )
            };
        }
    }

    // Sincronizar el estado de la cuenta después de verificar el correo o iniciar sesión
    async sincronizarCuenta(): Promise<string> {

        const token = await this.obtenerTokenAcceso();

        if (!token) {
            throw new Error(
                'No existe una sesión válida.'
            );
        }

        const respuesta = await fetch(
            `${configuracionBackend.url}/cuentas/sincronizar`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (!respuesta.ok) {
            throw new Error(
                'No se ha podido verificar el estado de la cuenta.'
            );
        }

        const datos: { estado?: string } =
            await respuesta.json();

        if (!datos.estado) {
            throw new Error(
                'El backend no ha devuelto un estado válido.'
            );
        }

        return datos.estado;
    }

    // Inicio de sesión
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

    // Obtener token de acceso para las peticiones al backend NestJS
    async obtenerTokenAcceso(): Promise<string | null> {
        const { data, error } =
            await this.supabase.auth.getSession();

        if (error) {
            return null;
        }

        return data.session?.access_token ?? null;
    }

    // Cambiar contraseña
    async cambiarContrasena(nuevaContrasena: string) {
        return this.supabase.auth.updateUser({
            password: nuevaContrasena
        });
    }

    // Actualizar nombre o apellido mediante NestJS.
    async actualizarDatosPersonales(nombre: string, apellidos: string) {

        try {
            const token = await this.obtenerTokenAcceso();

            if (!token) {
                return {
                    error: new Error('No existe una sesión válida.')
                };
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/perfil`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        nombre,
                        apellidos
                    })
                }
            );

            if (!respuesta.ok) {
                return {
                    error: new Error(
                        'No se han podido actualizar tus datos.'
                    )
                };
            }

            return { error: null };

        } catch {
            return {
                error: new Error(
                    'No se ha podido conectar con el backend.'
                )
            };
        }
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
