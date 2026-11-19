import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet, RouterLink, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { MenuLateral } from '../menu-lateral/menu-lateral';
import { MenuSuperadmin } from '../menu-superadmin/menu-superadmin';
import { enlaces } from '../../../../configuracion/enlaces';
import { Autenticacion } from '../../../../servicios/autenticacion';

@Component({
  selector: 'app-estructura-panel',
  imports: [RouterOutlet, RouterLink, MenuLateral, MenuSuperadmin],
  templateUrl: './estructura-panel.html',
  styleUrl: './estructura-panel.scss'
})

export class EstructuraPanel implements OnInit, OnDestroy {

  private router = inject(Router);

  private ruta = inject(ActivatedRoute);

  private readonly autenticacion = inject(Autenticacion);

  // Para usar el mismo panel para ambos roles.
  // El tipo de panel se define desde las rutas de Angular.
  readonly esSuperadmin =
    this.ruta.snapshot.data['tipoPanel'] === 'superadministrador';

  private suscripcionRutas?: Subscription;
  private intervaloEstado?: number;
  private comprobandoEstado = false;
  private destruido = false;

  private readonly alCambiarVisibilidad = (): void => {
    if (document.visibilityState === 'visible') {
      void this.comprobarEstadoCuenta();
    }
  };


  readonly urlWebComercial = enlaces.webComercial;

  menuAbierto = signal(false);

  ngOnInit(): void {
    // Mostrar el menú inicialmente en escritorio
    this.menuAbierto.set(
      window.matchMedia('(min-width: 64rem)').matches
    );

    // En móvil y tablet, cierra el menú al cambiar de página
    this.suscripcionRutas = this.router.events
      .pipe(filter(evento => evento instanceof NavigationEnd))
      .subscribe(() => {
        if (!window.matchMedia('(min-width: 64rem)').matches) {
          this.menuAbierto.set(false);
        }
      });


    // El panel comprueba si la cuenta está suspendida cada 30 segundos.
    // Útil también para mantener el servidor despierto mientras esté el panel visible.  
    if (!this.esSuperadmin) {
      void this.comprobarEstadoCuenta();

      this.intervaloEstado = window.setInterval(() => {
        this.alCambiarVisibilidad();
      }, 30_000);

      document.addEventListener(
        'visibilitychange',
        this.alCambiarVisibilidad
      );
    }
  }

  private async comprobarEstadoCuenta(): Promise<void> {
    if (this.destruido || this.comprobandoEstado) {
      return;
    }

    this.comprobandoEstado = true;

    try {
      const acceso = await this.autenticacion.obtenerMiAcceso();

      if (
        this.destruido ||
        (acceso?.estado !== 'suspendida' && acceso?.estado !== 'baja')
      ) {
        return;
      }

      try {
        await this.autenticacion.cerrarSesion();
      } finally {
        if (!this.destruido) {
          await this.router.navigate(['/acceso'], {
            queryParams: { estadoCuenta: acceso.estado },
            replaceUrl: true
          });
        }
      }
    } finally {
      this.comprobandoEstado = false;
    }
  }

  cambiarEstadoMenu(): void {
    this.menuAbierto.update(abierto => !abierto);
  }

  cerrarMenu(): void {
    this.menuAbierto.set(false);
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.suscripcionRutas?.unsubscribe();

    if (this.intervaloEstado !== undefined) {
      window.clearInterval(this.intervaloEstado);
    }

    document.removeEventListener(
      'visibilitychange',
      this.alCambiarVisibilidad
    );
  }
}