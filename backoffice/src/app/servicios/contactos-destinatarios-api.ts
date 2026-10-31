import { Injectable, inject } from '@angular/core';
import { Autenticacion } from './autenticacion';
import { configuracionBackend } from '../configuracion/backend';

export interface ContactoDestinatario {
    id: string;
    nombre: string;
    correo: string;
    tieneMensaje: boolean;
}

export interface FichaDestinatario extends ContactoDestinatario {
    mensaje: string | null;
}

export interface DatosDestinatario {
    nombre: string;
    correo: string;
}

@Injectable({
    providedIn: 'root'
})
export class ContactosDestinatariosApi {

    private readonly autenticacion = inject(Autenticacion);

    private readonly url =
        `${configuracionBackend.url}/contactos-destinatarios`;

    private async peticion<T>(
        ruta: string,
        metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
        cuerpo?: object
    ): Promise<T> {

        const token =
            await this.autenticacion.obtenerTokenAcceso();

        if (!token) {
            throw new Error('Debes iniciar sesión.');
        }

        let respuesta: Response;

        try {
            respuesta = await fetch(`${this.url}${ruta}`, {
                method: metodo,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(cuerpo
                        ? { 'Content-Type': 'application/json' }
                        : {})
                },
                ...(cuerpo
                    ? { body: JSON.stringify(cuerpo) }
                    : {})
            });
        } catch {
            throw new Error(
                'No se ha podido conectar con el servidor.'
            );
        }

        if (!respuesta.ok) {
            let mensaje =
                'No se ha podido completar la operación.';

            try {
                const error = await respuesta.json();

                if (typeof error.message === 'string') {
                    mensaje = error.message;
                } else if (Array.isArray(error.message)) {
                    mensaje = error.message.join(' ');
                }
            } catch {
                // Mantener el mensaje general
            }

            throw new Error(mensaje);
        }

        if (respuesta.status === 204) {
            return undefined as T;
        }

        return respuesta.json() as Promise<T>;
    }

    // Listado: no devuelve el contenido de los mensajes personalizados
    obtenerContactos(): Promise<ContactoDestinatario[]> {
        return this.peticion<ContactoDestinatario[]>('');
    }

    // Ficha individual donde se incluye el mensaje privado
    obtenerFicha(id: string): Promise<FichaDestinatario> {
        return this.peticion<FichaDestinatario>(
            `/${encodeURIComponent(id)}`
        );
    }

    crearContacto(
        datos: DatosDestinatario
    ): Promise<ContactoDestinatario> {
        return this.peticion<ContactoDestinatario>(
            '', 'POST', datos
        );
    }

    actualizarContacto(
        id: string,
        datos: DatosDestinatario
    ): Promise<ContactoDestinatario> {
        return this.peticion<ContactoDestinatario>(
            `/${encodeURIComponent(id)}`,
            'PATCH',
            datos
        );
    }

    eliminarContacto(id: string): Promise<void> {
        return this.peticion<void>(
            `/${encodeURIComponent(id)}`,
            'DELETE'
        );
    }

    guardarMensaje(
        id: string,
        contenido: string
    ): Promise<void> {
        return this.peticion<void>(
            `/${encodeURIComponent(id)}/mensaje`,
            'PUT',
            { contenido }
        );
    }

    eliminarMensaje(id: string): Promise<void> {
        return this.peticion<void>(
            `/${encodeURIComponent(id)}/mensaje`,
            'DELETE'
        );
    }
}


