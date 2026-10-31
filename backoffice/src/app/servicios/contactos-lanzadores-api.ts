import { Injectable, inject } from '@angular/core';
import { Autenticacion } from './autenticacion';
import { configuracionBackend } from '../configuracion/backend';

export type EstadoAsignacion =
    | 'pendiente'
    | 'aceptada'
    | 'rechazada'
    | 'caducada'
    | 'revocada'
    | 'renunciada'
    | 'inhabilitada';


export interface AsignacionLanzadorApi {
    id: string;
    estado: EstadoAsignacion;
    fecha_invitacion: string;
    fecha_caducidad: string;
    fecha_aceptacion: string | null;
    lanzadores: {
        id: string;
        nombre: string;
        correo: string;
    };
}

export interface NuevaInvitacion {
    nombre: string;
    correo: string;
}

@Injectable({
    providedIn: 'root'
})
export class ContactosLanzadoresApi {

    private readonly autenticacion = inject(Autenticacion);

    private async obtenerToken(): Promise<string> {
        const token =
            await this.autenticacion.obtenerTokenAcceso();

        if (!token) {
            throw new Error('Debes iniciar sesión.');
        }

        return token;
    }

    async obtenerAsignaciones(): Promise<AsignacionLanzadorApi[]> {
        const token = await this.obtenerToken();

        const respuesta = await fetch(
            `${configuracionBackend.url}/contactos-lanzadores`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (!respuesta.ok) {
            throw new Error(
                'No se han podido consultar los lanzadores.'
            );
        }

        return respuesta.json();
    }

    async crearInvitacion(
        datos: NuevaInvitacion
    ): Promise<void> {
        const token = await this.obtenerToken();

        const respuesta = await fetch(
            `${configuracionBackend.url}/contactos-lanzadores/invitaciones`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(datos)
            }
        );

        if (!respuesta.ok) {
            let mensaje =
                'No se ha podido enviar la invitación.';

            try {
                const error = await respuesta.json();

                if (typeof error.message === 'string') {
                    mensaje = error.message;
                }
            } catch {
                // Mantener el mensaje general
            }

            throw new Error(mensaje);
        }
    }

    // Retirar una invitación pendiente
    async retirarInvitacion(asignacionId: string): Promise<void> {
        await this.modificarAsignacion(asignacionId, 'retirar');
    }

    // Revocar una autorización aceptada
    async revocarAutorizacion(asignacionId: string): Promise<void> {
        await this.modificarAsignacion(asignacionId, 'revocar');
    }

    private async modificarAsignacion(
        asignacionId: string,
        accion: 'retirar' | 'revocar'
    ): Promise<void> {

        const token = await this.obtenerToken();

        const respuesta = await fetch(
            `${configuracionBackend.url}/contactos-lanzadores/` +
            `${encodeURIComponent(asignacionId)}/${accion}`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (!respuesta.ok) {
            let mensaje = 'No se ha podido realizar la operación.';

            try {
                const datos = await respuesta.json();

                if (typeof datos.message === 'string') {
                    mensaje = datos.message;
                }
            } catch {
                // Conservar el mensaje general
            }

            throw new Error(mensaje);
        }
    }

}
