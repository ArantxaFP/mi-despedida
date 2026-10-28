import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { MenuLateral } from '../menu-lateral/menu-lateral';

@Component({
  selector: 'app-estructura-panel',
  imports: [RouterOutlet, RouterLink, MenuLateral],
  templateUrl: './estructura-panel.html',
  styleUrl: './estructura-panel.scss'
})
export class EstructuraPanel implements OnInit, OnDestroy {

  private router = inject(Router);
  private suscripcionRutas?: Subscription;

  menuAbierto = signal(false);

  ngOnInit(): void {
    // Mostrar el menú inicialmente en escritorio.
    this.menuAbierto.set(
      window.matchMedia('(min-width: 64rem)').matches
    );

    // En móvil y tablet, cierra el menú al cambiar de página.
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
