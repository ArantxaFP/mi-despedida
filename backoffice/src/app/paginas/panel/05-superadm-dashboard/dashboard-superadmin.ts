import { Component, inject, OnInit, signal } from '@angular/core';
import { Autenticacion } from '../../../servicios/autenticacion';

@Component({
  selector: 'app-dashboard-superadmin',
  standalone: true,
  templateUrl: './dashboard-superadmin.html',
  styleUrl: './dashboard-superadmin.scss'
})
export class DashboardSuperadmin implements OnInit {
  private readonly autenticacion = inject(Autenticacion);

  readonly nombreSaludo = signal('');

  ngOnInit(): void {
    void this.autenticacion.obtenerNombreParaSaludo().then(datos => {
      if (datos) {
        this.nombreSaludo.set(datos.nombre);
      }
    });
  }
}