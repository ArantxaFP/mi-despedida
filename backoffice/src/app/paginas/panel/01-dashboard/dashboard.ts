import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardApi, LanzadorResumen, DestinatarioResumen, AutorizacionExterna } from '../../../servicios/dashboard-api';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit {

  private readonly api = inject(DashboardApi);

  readonly lanzadores = signal<LanzadorResumen[]>([]);
  readonly destinatarios = signal<DestinatarioResumen[]>([]);
  readonly autorizacionesExternas = signal<AutorizacionExterna[]>([]);
  readonly cargandoLanzadores = signal(true);
  readonly cargandoDestinatarios = signal(true);
  readonly cargandoAutorizaciones = signal(true);
  readonly errorLanzadores = signal('');
  readonly errorDestinatarios = signal('');
  readonly errorAutorizaciones = signal('');
  readonly mostrarAutorizaciones = signal(false);

  readonly totalLanzadores = computed(() =>
    this.lanzadores().filter(l =>
      l.estado === 'pendiente' ||
      l.estado === 'aceptada'
    ).length
  );

  readonly lanzadoresConfirmados = computed(() => {
    const ids = new Set(
      this.lanzadores()
        .filter(l =>
          l.estado === 'aceptada' &&
          l.habilitada !== false
        )
        .map(l => l.lanzadores?.id ?? l.id)
    );

    return ids.size;
  });

  readonly invitacionesPendientes = computed(() =>
    this.lanzadores().filter(l =>
      l.estado === 'pendiente'
    ).length
  );

  readonly faltanLanzadores = computed(() =>
    Math.max(0, 2 - this.lanzadoresConfirmados())
  );

  readonly minimoLanzadoresCumplido = computed(() =>
    this.lanzadoresConfirmados() >= 2
  );

  readonly totalDestinatarios = computed(() =>
    this.destinatarios().length
  );

  readonly destinatariosConMensaje = computed(() =>
    this.destinatarios().filter(d => d.tieneMensaje).length
  );

  readonly destinatariosSinMensaje = computed(() =>
    this.totalDestinatarios() - this.destinatariosConMensaje()
  );

  readonly autorizacionesAceptadas = computed(() =>
    this.autorizacionesExternas().filter(a =>
      a.estado === 'aceptada'
    ).length
  );

  ngOnInit(): void {
    void this.cargarDatos();
  }

  async cargarDatos(): Promise<void> {
    // Peticiones independientes: aunque falle una sección, las demás pueden mostrar sus datos
    await Promise.all([
      this.cargarLanzadores(),
      this.cargarDestinatarios(),
      this.cargarAutorizaciones()
    ]);
  }

  private async cargarLanzadores(): Promise<void> {
    this.cargandoLanzadores.set(true);
    this.errorLanzadores.set('');

    try {
      const datos = await this.api.obtenerLanzadores();
      this.lanzadores.set(datos);
    } catch (error) {
      this.errorLanzadores.set(
        this.obtenerMensajeError(error)
      );
    } finally {
      this.cargandoLanzadores.set(false);
    }
  }

  private async cargarDestinatarios(): Promise<void> {
    this.cargandoDestinatarios.set(true);
    this.errorDestinatarios.set('');

    try {
      const datos = await this.api.obtenerDestinatarios();
      this.destinatarios.set(datos);
    } catch (error) {
      this.errorDestinatarios.set(
        this.obtenerMensajeError(error)
      );
    } finally {
      this.cargandoDestinatarios.set(false);
    }
  }

  private async cargarAutorizaciones(): Promise<void> {
    this.cargandoAutorizaciones.set(true);
    this.errorAutorizaciones.set('');

    try {
      const datos =
        await this.api.obtenerAutorizacionesExternas();

      this.autorizacionesExternas.set(datos);
    } catch {
      this.errorAutorizaciones.set(
        'La consulta de autorizaciones de otras cuentas está pendiente de conexión.'
      );
    } finally {
      this.cargandoAutorizaciones.set(false);
    }
  }

  alternarAutorizaciones(): void {
    this.mostrarAutorizaciones.update(valor => !valor);
  }

  private obtenerMensajeError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'No se han podido consultar los datos.';
  }
}
