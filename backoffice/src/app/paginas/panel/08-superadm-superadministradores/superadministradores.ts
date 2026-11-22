import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Autenticacion } from '../../../servicios/autenticacion';
import { configuracionBackend } from '../../../configuracion/backend';

// Datos autorizados para el listado de superadministradores.
// No se consultan contraseñas ni información privada de otros usuarios.
interface UsuarioSuperadministrador {
    id: string;
    nombre: string;
    apellidos: string | null;
    correo: string;
    estado: string;
    fecha_registro: string;
}

@Component({
    selector: 'app-superadministradores',
    standalone: true,
    imports: [DatePipe],
    templateUrl: './superadministradores.html',
    styleUrl: './superadministradores.scss'
})
export class Superadministradores implements OnInit {

    private readonly autenticacion = inject(Autenticacion);

    readonly usuarios = signal<UsuarioSuperadministrador[]>([]);

    readonly cargando = signal(false);
    readonly error = signal('');

    // Formulario de alta por invitación
    readonly nombreNuevo = signal('');
    readonly apellidosNuevo = signal('');
    readonly correoNuevo = signal('');

    readonly enviandoInvitacion = signal(false);
    readonly errorAlta = signal('');
    readonly mensajeAlta = signal('');


    ngOnInit(): void {
        void this.actualizarSuperadministradores();
    }


    // Consultar los superadministradores desde 
    async actualizarSuperadministradores(): Promise<void> {

        if (this.cargando()) {
            return;
        }

        this.cargando.set(true);
        this.error.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error(
                    'Tu sesión ha caducado. Vuelve a iniciar sesión.'
                );
            }

            // Nest comprueba que quien consulta es un superadministrador activo
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/superadministradores`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {
                if (
                    respuesta.status === 401 ||
                    respuesta.status === 403
                ) {
                    throw new Error(
                        'No tienes permisos para consultar esta sección.'
                    );
                }

                throw new Error(
                    'No se ha podido obtener el listado de superadministradores.'
                );
            }

            const datos: UsuarioSuperadministrador[] =
                await respuesta.json();

            if (!Array.isArray(datos)) {
                throw new Error(
                    'El servidor no ha devuelto un listado válido.'
                );
            }

            this.usuarios.set(datos);

        } catch (error) {
            this.error.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido consultar el listado.'
            );
        } finally {
            this.cargando.set(false);
        }
    }

    // Mostrar los estados internos con un texto más comprensible
    mostrarEstado(estado: string): string {
        switch (estado) {
            case 'activa':
                return 'Activa';

            case 'pendiente_verificacion':
                return 'Pendiente de activación';

            case 'suspendida':
                return 'Suspendida';

            case 'baja':
                return 'Baja';

            default:
                return estado.replaceAll('_', ' ');
        }
    }



    // Crear un superadministrador y enviar su invitación para que lo active
    async enviarInvitacion(): Promise<void> {

        if (
            this.cargando() ||
            this.enviandoInvitacion()
        ) {
            return;
        }

        const nombre = this.nombreNuevo().trim();
        const apellidos = this.apellidosNuevo().trim();
        const correo = this.correoNuevo().trim().toLowerCase();

        if (
            !nombre ||
            nombre.length > 100 ||
            apellidos.length > 150 ||
            !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(correo)
        ) {
            this.errorAlta.set(
                'Introduce un nombre y un correo válidos.'
            );
            return;
        }

        this.enviandoInvitacion.set(true);
        this.errorAlta.set('');
        this.mensajeAlta.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error(
                    'Tu sesión ha caducado. Vuelve a iniciar sesión.'
                );
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/superadministradores`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        nombre,
                        apellidos,
                        correo
                    })
                }
            );

            if (!respuesta.ok) {
                const datosError: { message?: unknown } | null =
                    await respuesta.json().catch(() => null);

                if (
                    respuesta.status === 409 &&
                    typeof datosError?.message === 'string'
                ) {
                    throw new Error(datosError.message);
                }

                throw new Error(
                    'No se ha podido completar la invitación. ' +
                    'Si se ha creado una cuenta pendiente, ' +
                    'actualiza el listado antes de volver a intentarlo.'
                );
            }

            // No recibimos contraseñas ni enlaces de acceso.
            // El servidor solicita el envío a Brevo.
            this.nombreNuevo.set('');
            this.apellidosNuevo.set('');
            this.correoNuevo.set('');

            this.mensajeAlta.set(
                `Se ha enviado la invitación a ${correo}.`
            );

            await this.actualizarSuperadministradores();

        } catch (error) {
            this.errorAlta.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido crear el superadministrador.'
            );

        } finally {
            this.enviandoInvitacion.set(false);
        }
    }


}