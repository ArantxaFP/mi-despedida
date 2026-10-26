import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-acceso-lanzador',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './acceso-lanzador.html',
  styleUrl: './acceso-lanzador.scss'
})
export class AccesoLanzador {
  solicitudPreparada = false;
  mostrarCodigo = false;

  formularioCorreo;
  formularioCodigo;

  constructor(private constructorFormulario: FormBuilder) {
    this.formularioCorreo = this.constructorFormulario.nonNullable.group({
      correo: [
        '',
        [
          Validators.required,
          Validators.email,
          Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
        ]
      ]
    });

    this.formularioCodigo = this.constructorFormulario.nonNullable.group({
      codigo: ['', Validators.required]
    });
  }

  solicitarAcceso(): void {
    if (this.formularioCorreo.invalid) {
      this.formularioCorreo.markAllAsTouched();
      return;
    }

    this.solicitudPreparada = true;
  }

  cambiarFormularioCodigo(): void {
    this.mostrarCodigo = !this.mostrarCodigo;
  }
}
