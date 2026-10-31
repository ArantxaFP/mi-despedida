import { Injectable } from '@angular/core';
import { configuracionBackend } from '../configuracion/backend';

export interface EstadoInvitacion {
    valida: boolean;
    estado: string;
    fechaCaducidad?: string;
}

export interface ResultadoInvitacion {
    estado: 'aceptada' | 'rechazada';
    mensaje: string;
}

export interface ResultadoVerificacion {
    credencialVerificacion: string;
}

@Injectable({
    providedIn: 'root'
})

export class InvitacionesLanzadoresApi {

    // Dirección local del backend NestJS.
    // Al desplegar en Render, se configurará la URL pública del backend por entorno.
    private readonly apiUrl = configuracionBackend.url;

    // --------------------------------------------------
    // 1. Consultar el estado de la invitación
    // --------------------------------------------------

    async consultar(
        token: string
    ): Promise<EstadoInvitacion> {

        const url = new URL(
            '/invitaciones-lanzadores/consultar',
            this.apiUrl
        );

        url.searchParams.set('token', token);

        const respuesta = await fetch(url.toString(), {
            method: 'GET',
            cache: 'no-store'
        });

        if (!respuesta.ok) {
            throw new Error(
                'No se ha podido consultar la invitación.'
            );
        }

        return respuesta.json() as Promise<EstadoInvitacion>;
    }

    // --------------------------------------------------
    // 2. Solicitar el código de verificación por correo
    // --------------------------------------------------

    async solicitarCodigo(token: string): Promise<void> {

        const respuesta = await fetch(
            `${this.apiUrl}/invitaciones-lanzadores/solicitar-codigo`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token }),
                cache: 'no-store'
            }
        );

        if (!respuesta.ok) {
            throw new Error(
                'No se ha podido solicitar el código de verificación.'
            );
        }
    }

    // --------------------------------------------------
    // 3. Verificar el código recibido por correo
    // --------------------------------------------------

    async verificarCodigo(
        token: string,
        codigo: string
    ): Promise<ResultadoVerificacion> {

        const respuesta = await fetch(
            `${this.apiUrl}/invitaciones-lanzadores/verificar-codigo`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token,
                    codigo
                }),
                cache: 'no-store'
            }
        );

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            const mensaje = Array.isArray(resultado.message)
                ? resultado.message.join('. ')
                : resultado.message;

            throw new Error(
                typeof mensaje === 'string'
                    ? mensaje
                    : 'No se ha podido verificar el código.'
            );
        }

        if (
            typeof resultado.credencialVerificacion !== 'string' ||
            !resultado.credencialVerificacion
        ) {
            throw new Error(
                'El servidor no ha devuelto una verificación válida.'
            );
        }

        return {
            credencialVerificacion:
                resultado.credencialVerificacion
        };
    }

    // --------------------------------------------------
    // 4. Aceptar o rechazar la invitación
    // --------------------------------------------------

    async responder(
        token: string,
        decision: 'aceptar' | 'rechazar',
        credencialVerificacion: string
    ): Promise<ResultadoInvitacion> {

        if (!credencialVerificacion) {
            throw new Error(
                'Debes verificar tu correo antes de responder.'
            );
        }

        const respuesta = await fetch(
            `${this.apiUrl}/invitaciones-lanzadores/${decision}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token,
                    credencialVerificacion
                }),
                cache: 'no-store'
            }
        );

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            const mensaje = Array.isArray(resultado.message)
                ? resultado.message.join('. ')
                : resultado.message;

            throw new Error(
                typeof mensaje === 'string'
                    ? mensaje
                    : 'No se ha podido procesar la invitación.'
            );
        }

        return resultado as ResultadoInvitacion;
    }
}
