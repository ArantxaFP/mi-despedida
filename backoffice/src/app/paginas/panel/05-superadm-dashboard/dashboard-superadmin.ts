import { Component, inject, OnInit, signal } from '@angular/core';
import { Autenticacion } from '../../../servicios/autenticacion';
import { RouterLink } from '@angular/router';
import { configuracionBackend } from '../../../configuracion/backend';

interface ResumenSuperadministracion {
    cuentasActivas: number;
    superadministradoresActivos: number;
    superadministradoresEliminados: number;
}

@Component({
    selector: 'app-dashboard-superadmin',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './dashboard-superadmin.html',
    styleUrl: './dashboard-superadmin.scss'
})
export class DashboardSuperadmin implements OnInit {

    private readonly autenticacion = inject(Autenticacion);

    readonly nombreSaludo = signal('');

    // Datos estadísticos del inicio dashboard de superadministración
    readonly resumen = signal<ResumenSuperadministracion | null>(null);
    readonly cargandoResumen = signal(false);
    readonly errorResumen = signal('');

    ngOnInit(): void {

        // Saludo personalizado
        void this.autenticacion.obtenerNombreParaSaludo()
            .then(datos => {
                if (datos) {
                    this.nombreSaludo.set(datos.nombre);
                }
            })
            .catch(() => {
                
            });

        void this.actualizarResumen();
    }

    // Consultar los recuentos autorizados
    async actualizarResumen(): Promise<void> {

        if (this.cargandoResumen()) {
            return;
        }

        this.cargandoResumen.set(true);
        this.errorResumen.set('');

        try {

            const token =
                await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                throw new Error(
                    'Tu sesión ha caducado. Vuelve a iniciar sesión.'
                );
            }

            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/superadmin/resumen`,
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
                        'No tienes permisos para consultar este resumen.'
                    );
                }

                throw new Error(
                    'No se ha podido consultar el resumen de la plataforma.'
                );
            }

            const datos: ResumenSuperadministracion =
                await respuesta.json();

            // No mostrar cifras incorrectas ante una respuesta inesperada
            const cifras = [
                datos.cuentasActivas,
                datos.superadministradoresActivos,
                datos.superadministradoresEliminados
            ];

            if (
                !cifras.every(
                    valor => Number.isSafeInteger(valor) && valor >= 0
                )
            ) {
                throw new Error(
                    'El servidor ha devuelto un resumen no válido.'
                );
            }

            this.resumen.set(datos);

        } catch (error) {

            this.errorResumen.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido cargar el resumen.'
            );

        } finally {
            this.cargandoResumen.set(false);
        }
    }
}