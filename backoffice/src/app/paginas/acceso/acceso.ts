import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../servicios/autenticacion';

@Component({
  selector: 'app-acceso',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './acceso.html',
  styleUrl: './acceso.scss'
})
export class Acceso {
  private autenticacion = inject(Autenticacion);
  private constructorFormulario = inject(FormBuilder);

  contrasenaVisible = false;
  accediendo = false;
  mensajeAcceso = '';

  formulario = this.constructorFormulario.nonNullable.group({
    correo: ['', [
      Validators.required,
      Validators.email,
      Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
    ]],
    contrasena: ['', [Validators.required]]
  });

  cambiarVisibilidadContrasena(): void {
    this.contrasenaVisible = !this.contrasenaVisible;
  }

  async iniciarSesion(): Promise<void> {
    this.mensajeAcceso = '';

    if (this.accediendo) {
      return;
    }

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.accediendo = true;

    try {
      const datos = this.formulario.getRawValue();

      const { error } = await this.autenticacion.iniciarSesion(
        datos.correo.trim(),
        datos.contrasena
      );

      if (error) {
        this.mensajeAcceso =
          'No se ha podido iniciar sesión. Comprueba tus datos y que hayas confirmado tu correo electrónico. Si acabas de registrarte, verifica primero tu cuenta y revisa que no te haya llegado al correo de spam.';
        return;
      }

      this.mensajeAcceso = 'Has iniciado sesión correctamente.';

    } catch {
      this.mensajeAcceso =
        'No se ha podido conectar con el servicio. Vuelve a intentarlo dentro de un rato.';
    } finally {
      this.accediendo = false;
    }
  }
}