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

// Registro histórico de eliminación de un superadministrador que proviene de auditoría
interface RegistroHistoricoSuperadministrador {
    id: string;
    cuenta_afectada_id: string;
    actor_id: string | null;
    correo_cuenta_eliminada: string | null;
    correo_actor: string | null;
    resultado: string;
    fecha_evento: string;
}

interface RespuestaHistoricoSuperadministradores {
    registros: RegistroHistoricoSuperadministrador[];
    total: number;
    pagina: number;
    tamanoPagina: number;
    totalPaginas: number;
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


    // Estado del histórico de superadministradores
    readonly historicoSuperadministradores = signal<RegistroHistoricoSuperadministrador[]>([]);
    readonly cargandoHistorico = signal(false);
    readonly errorHistorico = signal('');
    readonly paginaHistorico = signal(1);
    readonly totalHistorico = signal(0);
    readonly totalPaginasHistorico = signal(1);


    // Estado de las acciones de gestión de superadministradores
    readonly usuarioActualId = signal<string | null>(null);
    readonly reenviandoId = signal<string | null>(null);
    readonly eliminandoId = signal<string | null>(null);
    readonly usuarioAEliminar = signal<UsuarioSuperadministrador | null>(null);
    readonly correoConfirmacion = signal('');
    readonly errorAccion = signal('');
    readonly mensajeAccion = signal('');

    // Formulario de alta por invitación
    readonly nombreNuevo = signal('');
    readonly apellidosNuevo = signal('');
    readonly correoNuevo = signal('');

    readonly enviandoInvitacion = signal(false);
    readonly errorAlta = signal('');
    readonly mensajeAlta = signal('');


    ngOnInit(): void {
        void this.iniciarGestionSuperadministradores();
    }

    // Identificar al superadministrador conectado para impedir que pueda eliminarse desde su propia sesión.
    private async iniciarGestionSuperadministradores(): Promise<void> {

        try {
            const { data } =
                await this.autenticacion.obtenerUsuario();

            this.usuarioActualId.set(data.user?.id ?? null);

        } catch {
            this.usuarioActualId.set(null);
        }

        await this.actualizarSuperadministradores();

        await this.actualizarHistoricoSuperadministradores();
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



    // Reenviar una invitación pendiente
    async reenviarInvitacion(
        usuario: UsuarioSuperadministrador
    ): Promise<void> {

        if (
            this.reenviandoId() ||
            this.eliminandoId() ||
            usuario.estado !== 'pendiente_verificacion'
        ) {
            return;
        }

        this.reenviandoId.set(usuario.id);
        this.errorAccion.set('');
        this.mensajeAccion.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error('Tu sesión ha caducado.');
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/superadministradores/${encodeURIComponent(usuario.id)}/reenviar-invitacion`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            if (!respuesta.ok) {
                const errorServidor: { message?: string } | null =
                    await respuesta.json().catch(() => null);

                throw new Error(
                    typeof errorServidor?.message === 'string'
                        ? errorServidor.message
                        : 'No se ha podido reenviar la invitación.'
                );
            }

            this.mensajeAccion.set(
                `Se ha solicitado el reenvío de la invitación a ${usuario.correo}.`
            );

            await this.actualizarSuperadministradores();

        } catch (error) {
            this.errorAccion.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido reenviar la invitación.'
            );

        } finally {
            this.reenviandoId.set(null);
        }
    }


    // Mostrar la confirmación de eliminación
    seleccionarSuperadministradorAEliminar(
        usuario: UsuarioSuperadministrador
    ): void {

        if (
            this.reenviandoId() ||
            this.eliminandoId() ||
            this.usuarioActualId() === usuario.id
        ) {
            return;
        }

        this.usuarioAEliminar.set(usuario);
        this.correoConfirmacion.set('');
        this.errorAccion.set('');
        this.mensajeAccion.set('');
    }

    cancelarEliminacionSuperadministrador(): void {

        if (this.eliminandoId()) {
            return;
        }

        this.usuarioAEliminar.set(null);
        this.correoConfirmacion.set('');
    }


    // Eliminar definitivamente un superadministrador
    async confirmarEliminacionSuperadministrador(): Promise<void> {

        const usuario = this.usuarioAEliminar();

        if (
            !usuario ||
            this.eliminandoId() ||
            this.reenviandoId()
        ) {
            return;
        }

        // Exigir que se escriba el correo exacto antes de eliminar
        if (
            this.correoConfirmacion().trim().toLowerCase() !==
            usuario.correo.toLowerCase()
        ) {
            this.errorAccion.set(
                'Debes escribir el correo electrónico de la cuenta que deseas eliminar.'
            );
            return;
        }

        if (this.usuarioActualId() === usuario.id) {
            this.errorAccion.set(
                'No puedes eliminar tu propia cuenta.'
            );
            return;
        }

        this.eliminandoId.set(usuario.id);
        this.errorAccion.set('');
        this.mensajeAccion.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error('Tu sesión ha caducado.');
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/superadministradores/${encodeURIComponent(usuario.id)}`,
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            if (!respuesta.ok) {
                const errorServidor: { message?: string } | null =
                    await respuesta.json().catch(() => null);

                throw new Error(
                    typeof errorServidor?.message === 'string'
                        ? errorServidor.message
                        : 'No se ha podido eliminar el superadministrador.'
                );
            }

            this.usuarioAEliminar.set(null);
            this.correoConfirmacion.set('');

            this.mensajeAccion.set(
                `Se ha eliminado la cuenta ${usuario.correo}.`
            );


        } catch (error) {
            this.errorAccion.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido completar la eliminación.'
            );

        } finally {
            this.eliminandoId.set(null);

            // Consultar el estado real tras la operación, también si ha habido fallo entre Postgre y Supabase
            await this.actualizarSuperadministradores();

            // Actualizar también el histórico para mostrar posibles incidencias
            await this.actualizarHistoricoSuperadministradores(1);
        }


    }


    // Consultar el histórico de eliminaciones definitivas de superadministradores
    async actualizarHistoricoSuperadministradores(
        pagina = this.paginaHistorico()
    ): Promise<void> {

        if (this.cargandoHistorico()) {
            return;
        }

        this.cargandoHistorico.set(true);
        this.errorHistorico.set('');

        try {
            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error('Tu sesión ha caducado.');
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/superadministradores/historico?pagina=${pagina}`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {
                throw new Error(
                    'No se ha podido consultar el histórico de superadministradores.'
                );
            }

            const datos: RespuestaHistoricoSuperadministradores =
                await respuesta.json();

            this.historicoSuperadministradores.set(datos.registros);
            this.paginaHistorico.set(datos.pagina);
            this.totalHistorico.set(datos.total);
            this.totalPaginasHistorico.set(datos.totalPaginas);

        } catch (error) {
            this.errorHistorico.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido cargar el histórico.'
            );

        } finally {
            this.cargandoHistorico.set(false);
        }
    }

    // Cambiar de página sin recargar el resto del panel
    async cambiarPaginaHistorico(pagina: number): Promise<void> {

        if (
            this.cargandoHistorico() ||
            pagina < 1 ||
            pagina > this.totalPaginasHistorico() ||
            pagina === this.paginaHistorico()
        ) {
            return;
        }

        await this.actualizarHistoricoSuperadministradores(pagina);
    }

}