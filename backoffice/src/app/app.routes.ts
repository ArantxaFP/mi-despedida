import { Routes } from '@angular/router';
import { Acceso } from './paginas/acceso/acceso';
import { Registro } from './paginas/registro/registro';
import { RecuperarContrasena } from './paginas/recuperar-contrasena/recuperar-contrasena';
import { AccesoLanzador } from './paginas/acceso-lanzador/acceso-lanzador';

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
  }

];