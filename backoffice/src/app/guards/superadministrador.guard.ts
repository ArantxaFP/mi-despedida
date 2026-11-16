import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Autenticacion } from '../servicios/autenticacion';
import { configuracionBackend } from '../configuracion/backend';

interface DatosAcceso {
  estado: string;
  rol: string;
}

export const superadministradorGuard: CanActivateFn = async () => {
  const autenticacion = inject(Autenticacion);
  const router = inject(Router);

  try {
    const token = await autenticacion.obtenerTokenAcceso();

    if (!token) {
      return router.createUrlTree(['/acceso']);
    }

    // Consulta el rol y estado actuales en NestJS.
    // OJO Este endpoint se implementará en el siguiente paso.
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

    if (!respuesta.ok) {
      return router.createUrlTree(['/acceso']);
    }

    const datos: DatosAcceso = await respuesta.json();

    if (
      datos.estado === 'activa' &&
      datos.rol === 'superadministrador'
    ) {
      return true;
    }

    if (
      datos.estado === 'activa' &&
      datos.rol === 'administrador'
    ) {
      return router.createUrlTree(['/panel/dashboard']);
    }

  } catch {

  }

  return router.createUrlTree(['/acceso']);
};