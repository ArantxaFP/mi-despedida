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

  {
    path: 'invitacion-lanzador',
    component: InvitacionLanzador
  }

];