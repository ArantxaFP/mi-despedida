import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Autenticacion } from '../servicios/autenticacion';

export const autenticacionGuard: CanActivateFn = async () => {
    const autenticacion = inject(Autenticacion);
    const router = inject(Router);

    try {
        const { data, error } = await autenticacion.obtenerUsuario();

        if (!error && data.user && data.user.email_confirmed_at) {
            return true;
        }
    } catch {

    }

    return router.createUrlTree(['/acceso']);
};
