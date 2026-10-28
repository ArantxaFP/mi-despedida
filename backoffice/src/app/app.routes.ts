import { Routes } from '@angular/router';
import { Acceso } from './paginas/acceso/acceso';
import { Registro } from './paginas/registro/registro';
import { RecuperarContrasena } from './paginas/recuperar-contrasena/recuperar-contrasena';
import { AccesoLanzador } from './paginas/acceso-lanzador/acceso-lanzador';
import { NuevaContrasena } from './paginas/nueva-contrasena/nueva-contrasena';

import { EstructuraPanel } from './paginas/panel/componentes/estructura-panel/estructura-panel';
import { Dashboard } from './paginas/panel/01-dashboard/dashboard';
import { Perfil } from './paginas/panel/02-perfil/perfil';

import { autenticacionGuard } from './guards/autenticacion.guard';

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

  {
    path: 'panel',
    component: EstructuraPanel,
    canActivate: [autenticacionGuard],
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
      }
    ]
  }
];