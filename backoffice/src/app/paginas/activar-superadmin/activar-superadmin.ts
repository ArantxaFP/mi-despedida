import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Autenticacion } from '../../servicios/autenticacion';
import { configuracionBackend } from '../../configuracion/backend';

@Component({
    selector: 'app-activar-superadmin',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './activar-superadmin.html',
    styleUrl: './activar-superadmin.scss'
})
export class ActivarSuperadmin implements OnInit {

    private readonly autenticacion = inject(Autenticacion);

    readonly comprobando = signal(true);
    readonly invitacionValida = signal(false);

    readonly contrasena = signal('');
    readonly confirmacion = signal('');

    readonly mostrarContrasena = signal(false);
    readonly guardando = signal(false);
    readonly activada = signal(false);

    readonly error = signal('');

    ngOnInit(): void {
        void this.comprobarInvitacion();
    }

    // Comprobar que Supabase ha recuperado una sesión desde el enlace de invitación recibido por correo
    private async comprobarInvitacion(): Promise<void> {
        this.comprobando.set(true);
        this.error.set('');

        try {
            const { data, error } =
                await this.autenticacion.obtenerUsuario();

            if (
                error ||
                !data.user ||
                !data.user.email_confirmed_at
            ) {
                this.error.set(
                    'No se ha podido verificar la invitación. ' +
                    'Comprueba que el enlace sea válido y no haya caducado.'
                );
                return;
            }

            // Los permisos definitivos los comprobará Nest
            this.invitacionValida.set(true);

        } catch {
            this.error.set(
                'No se ha podido comprobar la invitación.'
            );

        } finally {
            this.comprobando.set(false);
        }
    }

   
    // Establecer contraseña y solicitar la activación
    async activarCuenta(): Promise<void> {

        if (
            this.comprobando() ||
            this.guardando() ||
            this.activada() ||
            !this.invitacionValida()
        ) {
            return;
        }

        const contrasena = this.contrasena();

        if (
            contrasena.length < 10 ||
            contrasena.length > 128 ||
            !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/.test(contrasena)
        ) {
            this.error.set(
                'La contraseña debe tener al menos 10 caracteres, ' +
                'mayúsculas, minúsculas, números y símbolos.'
            );
            return;
        }

        if (contrasena !== this.confirmacion()) {
            this.error.set('Las contraseñas no coinciden.');
            return;
        }

        this.guardando.set(true);
        this.error.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error(
                    'La sesión de invitación ha caducado.'
                );
            }

            // No se envía ningún rol ni identificador de usuario.
            // Nest identifica al invitado mediante Supabase.
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/activar-invitacion`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ contrasena })
                }
            );

            if (!respuesta.ok) {
                if (respuesta.status === 401) {
                    throw new Error(
                        'La sesión de invitación no es válida.'
                    );
                }

                if (respuesta.status === 403 || respuesta.status === 409) {
                    throw new Error(
                        'La invitación no está pendiente de activación.'
                    );
                }

                throw new Error(
                    'No se ha podido completar la activación.'
                );
            }

            const resultado: { estado: string } =
                await respuesta.json();

            if (resultado.estado !== 'activa') {
                throw new Error(
                    'El servidor no ha confirmado la activación.'
                );
            }

            // La activación ya se ha confirmado en Nest
            this.activada.set(true);
            this.contrasena.set('');
            this.confirmacion.set('');

            // Terminar la sesión temporal utilizada para la invitación
            const cierre = await this.autenticacion.cerrarSesion();

            if (cierre.error) {
                this.error.set(
                    'La cuenta está activada, pero no se ha podido cerrar ' +
                    'la sesión temporal. Cierra la sesión antes de acceder.'
                );
            }

        } catch (error) {
            this.error.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido activar la cuenta.'
            );

        } finally {
            this.guardando.set(false);
        }
    }
}