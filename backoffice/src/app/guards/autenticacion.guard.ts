import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Autenticacion } from '../servicios/autenticacion';
import { configuracionBackend } from '../configuracion/backend';

export const autenticacionGuard: CanActivateFn = async () => {

    const autenticacion = inject(Autenticacion);
    const router = inject(Router);

    try {
        // Comprobar la identidad y verificación del correo.
        const { data, error } = await autenticacion.obtenerUsuario();

        if (
            error ||
            !data.user ||
            !data.user.email_confirmed_at
        ) {
            return router.createUrlTree(['/acceso']);
        }

        // Obtener el token de acceso del usuario autenticado.
        const token = await autenticacion.obtenerTokenAcceso();

        if (!token) {
            return router.createUrlTree(['/acceso']);
        }

        // Consultar el rol y estado actuales desde NestJS.
        // No modifica ningún registro.
        const consultarAcceso = async () => {
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/mi-acceso`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            // Permitir recuperar registros pendientes de administradores cuando todavía no existe la cuenta
            if (respuesta.status === 403) {
                return null;
            }

            if (!respuesta.ok) {
                throw new Error('No se ha podido comprobar el acceso.');
            }

            const datos: {
                rol: string;
                estado: string;
            } = await respuesta.json();

            return datos;
        };

        const acceso = await consultarAcceso();

        // Los superadministradores no pueden acceder a las páginas del administrador.
        // Tampoco deben ejecutar la sincronización ordinaria para no machacar datos.
        if (acceso?.rol === 'superadministrador') {
            if (acceso.estado === 'activa') {
                return router.createUrlTree(['/superadmin']);
            }

            return router.createUrlTree(['/acceso']);
        }

        // Rechazar cualquier otro rol no permitido
        if (acceso && acceso.rol !== 'administrador') {
            return router.createUrlTree(['/acceso']);
        }

        // Administrador con cuenta activa
        if (
            acceso?.rol === 'administrador' &&
            acceso.estado === 'activa'
        ) {
            return true;
        }

        // No reactivar cuentas suspendidas, de baja o finalizadas
        if (
            acceso &&
            acceso.estado !== 'pendiente_verificacion'
        ) {
            return router.createUrlTree(['/acceso']);
        }

        // Mantener la sincronización del registro ordinario cuando la cuenta está pendiente o falta el registro
        const estadoCuenta =
            await autenticacion.sincronizarCuenta();

        if (estadoCuenta !== 'activa') {
            return router.createUrlTree(['/acceso']);
        }

        // Comprobar nuevamente que pertenece al rol administrador
        const accesoFinal = await consultarAcceso();

        if (
            accesoFinal?.rol === 'administrador' &&
            accesoFinal.estado === 'activa'
        ) {
            return true;
        }


    } catch {
        // Si falla la comprobación, no se permite el acceso
    }

    return router.createUrlTree(['/acceso']);
};
