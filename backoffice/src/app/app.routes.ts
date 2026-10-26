import { Routes } from '@angular/router';
import { Acceso } from './paginas/acceso/acceso';
import { Registro } from './paginas/registro/registro';

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
  }
];