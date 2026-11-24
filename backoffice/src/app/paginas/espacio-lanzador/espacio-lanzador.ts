import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

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
}