import { Injectable, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { configuracionSupabase } from '../configuracion/supabase';
import { configuracionBackend } from '../configuracion/backend';

export interface BloqueoEdicionCuenta {
    token: string;
    versionInicio: number;
    fechaCaducidad: string;
    datosActuales: {
        nombre: string;
        apellidos: string | null;
    };
}

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



    // Solicitar un bloqueo prioritario para editar el perfil
    async adquirirBloqueoPerfil(): Promise<{
        bloqueo: BloqueoEdicionCuenta | null;
        error: Error | null;
    }> {

        try {
            const { data, error } = await this.obtenerUsuario();

            if (error || !data.user) {
                return {
                    bloqueo: null,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const token = await this.obtenerTokenAcceso();

            if (!token) {
                return {
                    bloqueo: null,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/edicion/${data.user.id}/bloqueo`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {
                return {
                    bloqueo: null,
                    error: new Error(
                        'No se ha podido iniciar la edición del perfil.'
                    )
                };
            }

            const bloqueo: BloqueoEdicionCuenta =
                await respuesta.json();

            return {
                bloqueo,
                error: null
            };

        } catch {
            return {
                bloqueo: null,
                error: new Error(
                    'No se ha podido conectar con el backend.'
                )
            };
        }
    }



    // Renovar durante cinco minutos el bloqueo de edición del perfil
    async renovarBloqueoPerfil(
        tokenBloqueo: string
    ): Promise<{
        fechaCaducidad: string | null;
        error: Error | null;
        conflicto?: boolean;
    }> {

        try {
            const { data, error } = await this.obtenerUsuario();

            if (error || !data.user) {
                return {
                    fechaCaducidad: null,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const tokenAcceso = await this.obtenerTokenAcceso();

            if (!tokenAcceso) {
                return {
                    fechaCaducidad: null,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/edicion/${data.user.id}/bloqueo/renovar`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${tokenAcceso}`
                    },
                    body: JSON.stringify({
                        token: tokenBloqueo
                    }),
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {
                return {
                    fechaCaducidad: null,
                    conflicto: respuesta.status === 409,
                    error: new Error(
                        respuesta.status === 409
                            ? 'El bloqueo ha caducado o ya no está disponible.'
                            : 'No se ha podido renovar el bloqueo de edición.'
                    )
                };
            }



            const datos: { fechaCaducidad: string } =
                await respuesta.json();

            return {
                fechaCaducidad: datos.fechaCaducidad,
                error: null
            };

        } catch {
            return {
                fechaCaducidad: null,
                error: new Error(
                    'No se ha podido conectar con el backend.'
                )
            };
        }
    }


    // Liberar el bloqueo cuando el administrador cancela la edición
    async liberarBloqueoPerfil(
        tokenBloqueo: string
    ): Promise<{
        liberado: boolean;
        error: Error | null;
    }> {

        try {
            const { data, error } = await this.obtenerUsuario();

            if (error || !data.user) {
                return {
                    liberado: false,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const tokenAcceso = await this.obtenerTokenAcceso();

            if (!tokenAcceso) {
                return {
                    liberado: false,
                    error: new Error('No existe una sesión válida.')
                };
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/edicion/${data.user.id}/bloqueo/liberar`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${tokenAcceso}`
                    },
                    body: JSON.stringify({
                        token: tokenBloqueo
                    }),
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {
                return {
                    liberado: false,
                    error: new Error(
                        'No se ha podido liberar el bloqueo de edición.'
                    )
                };
            }

            const datos: { liberado: boolean } =
                await respuesta.json();

            return {
                liberado: datos.liberado,
                error: null
            };

        } catch {
            return {
                liberado: false,
                error: new Error(
                    'No se ha podido conectar con el backend.'
                )
            };
        }
    }

    // Solicitar el bloqueo de la cuenta seleccionada
    adquirirBloqueoSuperadministrador(cuentaId: string) {
        return this.solicitarBloqueoSuperadministrador<BloqueoEdicionCuenta>(
            cuentaId,
            ''
        );
    }

    // Renovar el bloqueo de la cuenta seleccionada
    renovarBloqueoSuperadministrador(cuentaId: string, tokenBloqueo: string) {
        return this.solicitarBloqueoSuperadministrador<{ fechaCaducidad: string }>(
            cuentaId,
            '/renovar',
            tokenBloqueo
        );
    }

    // Liberar el bloqueo de la cuenta seleccionada
    liberarBloqueoSuperadministrador(cuentaId: string, tokenBloqueo: string) {
        return this.solicitarBloqueoSuperadministrador<{ liberado: boolean }>(
            cuentaId,
            '/liberar',
            tokenBloqueo
        );
    }

    private async solicitarBloqueoSuperadministrador<T>(
        cuentaId: string,
        sufijo: '' | '/renovar' | '/liberar',
        tokenBloqueo?: string
    ): Promise<{
        datos: T | null;
        error: Error | null;
        conflicto: boolean;
    }> {
        try {
            const tokenAcceso = await this.obtenerTokenAcceso();

            if (!tokenAcceso) {
                return {
                    datos: null,
                    error: new Error('No existe una sesión válida.'),
                    conflicto: false
                };
            }

            const cabeceras = new Headers({
                Authorization: `Bearer ${tokenAcceso}`
            });

            const opciones: RequestInit = {
                method: 'POST',
                headers: cabeceras,
                cache: 'no-store'
            };

            if (tokenBloqueo !== undefined) {
                cabeceras.set('Content-Type', 'application/json');
                opciones.body = JSON.stringify({ token: tokenBloqueo });
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/cuentas/${encodeURIComponent(cuentaId)}/bloqueo${sufijo}`,
                opciones
            );

            if (!respuesta.ok) {
                const conflicto = respuesta.status === 409;

                return {
                    datos: null,
                    error: new Error(
                        conflicto
                            ? 'El bloqueo de edición no está disponible.'
                            : 'No se ha podido completar la operación de edición.'
                    ),
                    conflicto
                };
            }

            const datos: T = await respuesta.json();

            return { datos, error: null, conflicto: false };
        } catch {
            return {
                datos: null,
                error: new Error('No se ha podido conectar con el backend.'),
                conflicto: false
            };
        }
    }

    // Coger nombre y posible apellido de administrador para mostrarlo en el panel
    async obtenerMiAcceso(): Promise<{
        rol: string;
        estado: string;
        nombre?: string;
        apellidos?: string | null;
    } | null> {
        try {
            const token = await this.obtenerTokenAcceso();
    
            if (!token) {
                return null;
            }
    
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/mi-acceso`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store'
                }
            );
    
            if (!respuesta.ok) {
                return null;
            }
    
            return await respuesta.json();
        } catch {
            return null;
        }
    }
    
    async obtenerNombreParaSaludo(): Promise<{
        nombre: string;
        apellidos: string | null;
    } | null> {
        const datos = await this.obtenerMiAcceso();
        const nombre = datos?.nombre?.trim();
    
        return nombre
            ? { nombre, apellidos: datos?.apellidos?.trim() || null }
            : null;
    }


    async obtenerDatosPerfil(): Promise<{
        nombre: string;
        apellidos: string | null;
    }> {
        const token = await this.obtenerTokenAcceso();

        if (!token) {
            throw new Error('No existe una sesión válida.');
        }

        const respuesta = await fetch(
            `${configuracionBackend.url}/cuentas/perfil`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                cache: 'no-store'
            }
        );

        if (!respuesta.ok) {
            throw new Error('No se han podido recuperar los datos del perfil.');
        }

        return respuesta.json();
    }


    // Guardar el nombre y los apellidos con el bloqueo de edición del titular
    actualizarDatosPerfilBloqueo(
        nombre: string,
        apellidos: string,
        bloqueo: BloqueoEdicionCuenta
    ) {
        return this.guardarDatosConBloqueo(
            '/cuentas/perfil/datos-con-bloqueo',
            nombre,
            apellidos,
            bloqueo
        );
    }

    actualizarDatosCuentaSuperadministrador(
        cuentaId: string,
        nombre: string,
        apellidos: string,
        bloqueo: BloqueoEdicionCuenta
    ) {
        return this.guardarDatosConBloqueo(
            `/cuentas/superadmin/cuentas/${encodeURIComponent(cuentaId)}/datos-con-bloqueo`,
            nombre,
            apellidos,
            bloqueo
        );
    }

    private async guardarDatosConBloqueo(
        ruta: string,
        nombre: string,
        apellidos: string,
        bloqueo: BloqueoEdicionCuenta
    ): Promise<{
        resultado: {
            guardado: boolean;
            version: number;
            mensaje: string;
        } | null;
        error: Error | null;
        conflicto: boolean;
    }> {
        try {
            const tokenAcceso = await this.obtenerTokenAcceso();

            if (!tokenAcceso) {
                return {
                    resultado: null,
                    error: new Error('No existe una sesión válida.'),
                    conflicto: false
                };
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}${ruta}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${tokenAcceso}`
                    },
                    body: JSON.stringify({
                        nombre,
                        apellidos,
                        token: bloqueo.token,
                        versionEsperada: bloqueo.versionInicio
                    })
                }
            );

            if (!respuesta.ok) {
                const conflicto = respuesta.status === 409;

                return {
                    resultado: null,
                    error: new Error(
                        conflicto
                            ? 'El bloqueo ya no es válido o los datos del usuario han cambiado.'
                            : 'No se han podido guardar estos datos.'
                    ),
                    conflicto
                };
            }

            return {
                resultado: await respuesta.json(),
                error: null,
                conflicto: false
            };
        } catch {
            return {
                resultado: null,
                error: new Error('No se ha podido conectar con el backend.'),
                conflicto: false
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
