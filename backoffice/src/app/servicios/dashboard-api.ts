import { Injectable, inject } from '@angular/core';
import { Autenticacion } from './autenticacion';
import { configuracionBackend } from '../configuracion/backend';

export interface LanzadorResumen {
    id: string;
    estado: string;
    habilitada?: boolean;
    lanzadores?: {
        id: string;
        nombre: string;
        correo: string;
    };
}

export interface DestinatarioResumen {
    id: string;
    nombre: string;
    correo: string;
    tieneMensaje: boolean;
}

export interface AutorizacionExterna {
    id: string;
    administradorNombre: string;
    estado: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardApi {

    private readonly autenticacion = inject(Autenticacion);

    private readonly url = configuracionBackend.url;

    private async obtener<T>(ruta: string): Promise<T> {
        const token = await this.autenticacion.obtenerTokenAcceso();

        if (!token) {
            throw new Error('Debes iniciar sesión.');
        }

        let respuesta: Response;

        try {
            respuesta = await fetch(`${this.url}${ruta}`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
        } catch {
            throw new Error('No se ha podido conectar con el servidor.');
        }

        if (!respuesta.ok) {
            throw new Error(
                `No se han podido consultar los datos (${respuesta.status}).`
            );
        }

        return respuesta.json() as Promise<T>;
    }

    obtenerLanzadores(): Promise<LanzadorResumen[]> {
        return this.obtener<LanzadorResumen[]>(
            '/contactos-lanzadores'
        );
    }

    obtenerDestinatarios(): Promise<DestinatarioResumen[]> {
        return this.obtener<DestinatarioResumen[]>(
            '/contactos-destinatarios'
        );
    }

    obtenerAutorizacionesExternas(): Promise<AutorizacionExterna[]> {
        return this.obtener<AutorizacionExterna[]>(
            '/dashboard/autorizaciones'
        );
    }
}
