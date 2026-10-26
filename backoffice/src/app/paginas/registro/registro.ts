import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registro.html',
  styleUrl: './registro.scss'
})
export class Registro {
  mostrarContrasena = false;
  mostrarConfirmacion = false;
  enviado = false;

  formulario;

  constructor(private constructorFormulario: FormBuilder) {
    this.formulario = this.constructorFormulario.nonNullable.group({
      nombre: ['', [Validators.required, Validators.minLength(2)]],
      correo: ['', [Validators.required, Validators.email, Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)]],
      contrasena: ['', [Validators.required, Validators.minLength(8)]],
      confirmarContrasena: ['', [Validators.required]],
      privacidad: [false, [Validators.requiredTrue]]
    });
  }

  cambiarVisibilidadContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  cambiarVisibilidadConfirmacion(): void {
    this.mostrarConfirmacion = !this.mostrarConfirmacion;
  }

  registrar(): void {
    this.enviado = true;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    if (
      this.formulario.controls.contrasena.value !==
      this.formulario.controls.confirmarContrasena.value
    ) {
      return;
    }


  }
}