import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Autenticacion } from '../../../../servicios/autenticacion';

@Component({
  selector: 'app-menu-lateral',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './menu-lateral.html',
  styleUrl: './menu-lateral.scss'
})
export class MenuLateral {
  private autenticacion = inject(Autenticacion);
  private router = inject(Router);

  cerrandoSesion = signal(false);
  mensajeError = signal('');

  async cerrarSesion(): Promise<void> {
    if (this.cerrandoSesion()) {
      return;
    }

    this.cerrandoSesion.set(true);
    this.mensajeError.set('');

    try {
      const { error } = await this.autenticacion.cerrarSesion();

      if (error) {
        this.mensajeError.set(
          'No se ha podido cerrar la sesión. Inténtalo de nuevo.'
        );
        return;
      }

      await this.router.navigateByUrl('/acceso', {
        replaceUrl: true
      });

    } catch {
      this.mensajeError.set(
        'No se ha podido cerrar la sesión. Inténtalo de nuevo.'
      );
    } finally {
      this.cerrandoSesion.set(false);
    }
  }
}
