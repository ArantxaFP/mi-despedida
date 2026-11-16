import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';

import { enlaces } from '../../configuracion/enlaces';
import { MenuSuperadmin } from '../panel/componentes/menu-superadmin/menu-superadmin';

@Component({
  selector: 'app-estructura-superadmin',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MenuSuperadmin],
  templateUrl: './estructura-superadmin.html',
  styleUrl: '../panel/componentes/estructura-panel/estructura-panel.scss'
})

export class EstructuraSuperadmin implements OnInit, OnDestroy {

  private router = inject(Router);

  private suscripcionRutas?: Subscription;

  readonly urlWebComercial = enlaces.webComercial;

  menuAbierto = signal(false);

  ngOnInit(): void {

    // Mostrar el menú inicialmente en escritorio
    this.menuAbierto.set(
      window.matchMedia('(min-width: 64rem)').matches
    );

    // En móvil y tablet, cerrar el menú al cambiar de página
    this.suscripcionRutas = this.router.events
      .pipe(filter(evento => evento instanceof NavigationEnd))
      .subscribe(() => {

        if (!window.matchMedia('(min-width: 64rem)').matches) {
          this.menuAbierto.set(false);
        }

      });
  }

  cambiarEstadoMenu(): void {
    this.menuAbierto.update(abierto => !abierto);
  }

  cerrarMenu(): void {
    this.menuAbierto.set(false);
  }

  ngOnDestroy(): void {
    this.suscripcionRutas?.unsubscribe();
  }

}
