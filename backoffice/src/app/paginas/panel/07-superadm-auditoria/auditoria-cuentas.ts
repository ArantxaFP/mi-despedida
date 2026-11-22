import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Autenticacion } from '../../../servicios/autenticacion';
import { configuracionBackend } from '../../../configuracion/backend';

// Datos identificativos de la cuenta que se está consultando
interface CuentaAuditada {
    id: string;
    nombre: string;
    apellidos: string | null;
    correo: string;
    estado: string;
}

// La auditoría registra operaciones, nunca valores personales modificados
interface RegistroAuditoria {
    id: string;
    actor_id: string | null;
    rol_actor: string;
    accion: string;
    resultado: string;
    campos_modificados: string[];
    motivo_codigo: string | null;
    version_anterior: number | null;
    version_nueva: number | null;
    fecha_evento: string;
}

interface RespuestaAuditoria {
    cuenta: CuentaAuditada;
    registros: RegistroAuditoria[];
    total: number;
    pagina: number;
    tamanoPagina: number;
    totalPaginas: number;
}

@Component({
    selector: 'app-auditoria-cuentas',
    standalone: true,
    imports: [DatePipe, RouterLink],
    templateUrl: './auditoria-cuentas.html',
    styleUrl: './auditoria-cuentas.scss'
})
export class AuditoriaCuentas implements OnInit {

    private readonly autenticacion = inject(Autenticacion);
    private readonly ruta = inject(ActivatedRoute);

    private cuentaId = '';

    readonly cuenta = signal<CuentaAuditada | null>(null);
    readonly registros = signal<RegistroAuditoria[]>([]);

    readonly cargando = signal(false);
    readonly error = signal('');

    readonly pagina = signal(1);
    readonly total = signal(0);
    readonly totalPaginas = signal(1);

    ngOnInit(): void {

        // Obtener la cuenta seleccionada desde la ruta de superadministración
        const cuentaId = this.ruta.snapshot.paramMap.get('id');

        if (!cuentaId) {
            this.error.set(
                'No se ha identificado la cuenta que deseas consultar.'
            );
            return;
        }

        this.cuentaId = cuentaId;
        void this.cargarAuditoria(1);
    }

    
    // Consultar los registros de una única cuenta
    async cargarAuditoria(paginaSolicitada = 1): Promise<void> {

        if (
            this.cargando() ||
            !this.cuentaId ||
            !Number.isSafeInteger(paginaSolicitada) ||
            paginaSolicitada < 1
        ) {
            return;
        }

        this.cargando.set(true);
        this.error.set('');

        try {
            const token = await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error(
                    'Tu sesión ha caducado. Vuelve a iniciar sesión.'
                );
            }

            // Nest comprueba los permisos y filtra por cuenta en Postgre
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/cuentas/${encodeURIComponent(this.cuentaId)}/auditoria?pagina=${paginaSolicitada}`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {

                if (respuesta.status === 404) {
                    throw new Error(
                        'No se ha encontrado la cuenta seleccionada.'
                    );
                }

                if (
                    respuesta.status === 401 ||
                    respuesta.status === 403
                ) {
                    throw new Error(
                        'No tienes autorización para consultar esta auditoría.'
                    );
                }

                throw new Error(
                    'No se ha podido consultar el historial de esta cuenta.'
                );
            }

            const datos: RespuestaAuditoria = await respuesta.json();

            if (
                !datos.cuenta ||
                !Array.isArray(datos.registros) ||
                !Number.isSafeInteger(datos.totalPaginas)
            ) {
                throw new Error(
                    'El servidor ha devuelto una respuesta no válida.'
                );
            }

            // Actualizar únicamente cuando la consulta se completa correctamente
            this.cuenta.set(datos.cuenta);
            this.registros.set(datos.registros);

            this.pagina.set(datos.pagina);
            this.total.set(datos.total);
            this.totalPaginas.set(Math.max(1, datos.totalPaginas));

        } catch (error) {
            this.error.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido cargar la auditoría.'
            );
        } finally {
            this.cargando.set(false);
        }
    }

    // Mostrar los códigos internos de operación de forma más legible
    formatearOperacion(operacion: string): string {
        return operacion.replaceAll('_', ' ');
    }
}