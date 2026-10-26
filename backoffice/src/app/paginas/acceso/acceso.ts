import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-acceso',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './acceso.html',
  styleUrl: './acceso.scss'
})
export class Acceso {
  contrasenaVisible = false;

  cambiarVisibilidadContrasena(): void {
    this.contrasenaVisible = !this.contrasenaVisible;
  }
}