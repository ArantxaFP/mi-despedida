import { Routes } from '@angular/router';
import { Acceso } from './paginas/acceso/acceso';
import { Registro } from './paginas/registro/registro';
import { RecuperarContrasena } from './paginas/recuperar-contrasena/recuperar-contrasena';
import { AccesoLanzador } from './paginas/acceso-lanzador/acceso-lanzador';
import { NuevaContrasena } from './paginas/nueva-contrasena/nueva-contrasena';
import { InvitacionLanzador } from './paginas/invitacion-lanzador/invitacion-lanzador';

import { EstructuraPanel } from './paginas/panel/componentes/estructura-panel/estructura-panel';
import { Dashboard } from './paginas/panel/01-dashboard/dashboard';
import { Perfil } from './paginas/panel/02-perfil/perfil';
import { ContactosLanzadores } from './paginas/panel/03-contactos-lanzadores/contactos-lanzadores';
import { ContactosDestinatarios } from './paginas/panel/04-contactos-destinatarios/contactos-destinatarios';

import { autenticacionGuard } from './guards/autenticacion.guard';
import { superadministradorGuard } from './guards/superadministrador.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'acceso',
    pathMatch: 'full'
  },
  {
    path: 'acceso',
    component: Acceso
  },
  {
    path: 'registro',
    component: Registro
  },
  {
    path: 'recuperar-contrasena',
    component: RecuperarContrasena
  },
  {
    path: 'acceso-lanzador',
    component: AccesoLanzador
  },
  {
    path: 'nueva-contrasena',
    component: NuevaContrasena
  },

  // Activación inicial de una cuenta de superadministrador
  {
    path: 'activar-superadmin',
    loadComponent: () =>
      import('./paginas/activar-superadmin/activar-superadmin')
        .then(m => m.ActivarSuperadmin)
  },

  {
    path: 'panel',
    component: EstructuraPanel,
    canActivate: [autenticacionGuard],
    canActivateChild: [autenticacionGuard],
    data: {
      tipoPanel: 'administrador'
    },

    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        component: Dashboard
      },
      {
        path: 'perfil',
        component: Perfil
      },
      {
        path: 'contactos-lanzadores',
        component: ContactosLanzadores
      },
      {
        path: 'contactos-destinatarios',
        component: ContactosDestinatarios
      }
    ]
  },

  // PANEL ACCESO SUPERADMINISTRADOR
  {
    path: 'superadmin',
    component: EstructuraPanel,
    canActivate: [superadministradorGuard],
    canActivateChild: [superadministradorGuard],
    data: {
      tipoPanel: 'superadministrador'
    },
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./paginas/panel/05-superadm-dashboard/dashboard-superadmin')
            .then(m => m.DashboardSuperadmin)
      },

      {
        path: 'cuentas',
        loadComponent: () =>
          import('./paginas/panel/06-superadm-cuentas/cuentas-superadmin')
            .then(m => m.CuentasSuperadmin)
      },

      // Auditoría individual de la cuenta seleccionada.
      // Solo pueden acceder los superadministradores.
      {
        path: 'cuentas/:id/auditoria',
        loadComponent: () =>
          import('./paginas/panel/07-superadm-auditoria/auditoria-cuentas')
            .then(m => m.AuditoriaCuentas)
      },

      // Gestión exclusiva de usuarios superadministradores
      {
        path: 'superadministradores',
        loadComponent: () =>
          import('./paginas/panel/08-superadm-superadministradores/superadministradores')
            .then(m => m.Superadministradores)
      }

    ]

  },

  {
    path: 'invitacion-lanzador',
    component: InvitacionLanzador
  }

];