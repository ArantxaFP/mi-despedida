import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import type { RespuestaEstadoActivacion } from '../acceso-lanzador/acceso-lanzador';

// Datos que Nest ha autorizado para la sesión actual
export interface SesionEspacioLanzador {
    administradorId: string;
    administradorNombre: string;
    caducaEn: string;
}

@Component({
    selector: 'app-espacio-lanzador',
    imports: [DatePipe],
    templateUrl: './espacio-lanzador.html',
    styleUrl: './espacio-lanzador.scss'
})
export class EspacioLanzador {

    // La sesión se obtiene y valida en el componente de acceso
    readonly sesion = input.required<SesionEspacioLanzador>();

    // Estado de activación obtenido y validado por el componente de acceso
    readonly estadoActivacion =
        input<RespuestaEstadoActivacion | null>(null);

    // Estado de la consulta a Nest
    readonly cargandoEstado = input(false);
    readonly errorEstado = input('');

    // Fecha y hora de la última consulta realizada correctamente
    readonly ultimaActualizacion = input<Date | null>(null);

    // Solicitar al componente de acceso una actualización manual
    readonly actualizarEstado = output<void>();

    // Nombre del estado de activación que se mostrará al lanzador
    readonly tituloEstado = computed(() => {

        const datos = this.estadoActivacion();

        if (!datos) {
            return 'Estado no disponible';
        }

        switch (datos.estado) {

            case 'sin_activacion':
                return 'Sin activación';

            case 'pendiente_validacion':
                return 'Pendiente de validación';

            case 'periodo_seguridad':
                return 'En periodo de seguridad';

            case 'en_procesamiento':
                return 'En procesamiento';

            case 'con_incidencias':
                return 'Con incidencias';

            default:
                return 'Estado no disponible';
        }
    });


    // Explicación del estado según la situación actual del lanzador
    readonly descripcionEstado = computed(() => {

        const datos = this.estadoActivacion();

        if (!datos) {
            return 'Todavía no se dispone de información sobre la activación.';
        }

        switch (datos.estado) {

            case 'sin_activacion':

                if (datos.ultimaSolicitud?.estado === 'cancelada') {
                    return 'La última solicitud de activación fue cancelada. ' +
                        'Actualmente no existe ninguna activación en curso.';
                }

                return 'Actualmente no existe ninguna activación en curso.';

            case 'pendiente_validacion':

                if (datos.esSolicitante) {
                    return 'Has solicitado la activación. ' +
                        'Está pendiente de confirmación por otro contacto lanzador autorizado.';
                }

                return 'Otro contacto lanzador ha solicitado la activación. ' +
                    'La solicitud está pendiente de confirmación.';

            case 'periodo_seguridad':

                return 'La activación ha sido confirmada y se encuentra ' +
                    'en el periodo de seguridad de 24 horas previas al envío de las comunicaciones de esta despedida.';

            case 'en_procesamiento':

                return 'Se está procesando la activación.';

            case 'con_incidencias':

                return 'La activación presenta incidencias y todavía no ha finalizado.';

            default:

                return 'No se ha podido interpretar el estado de activación.';
        }
    });

}