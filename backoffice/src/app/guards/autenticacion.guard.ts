import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Autenticacion } from '../servicios/autenticacion';

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

        // Comprobar el estado actual de la cuenta en PostgreSQL a través de NestJS
        const estadoCuenta =
            await autenticacion.sincronizarCuenta();

        if (estadoCuenta === 'activa') {
            return true;
        }

    } catch {
        // Si falla la comprobación, no se permite el acceso
    }

    return router.createUrlTree(['/acceso']);
};
