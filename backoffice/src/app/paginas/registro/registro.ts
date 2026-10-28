import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Autenticacion } from '../../servicios/autenticacion';

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registro.html',
  styleUrl: './registro.scss'
})
export class Registro {
  private autenticacion = inject(Autenticacion);

  mostrarContrasena = false;
  mostrarConfirmacion = false;
  enviado = false;
  registrando = false;
  registroCompletado = false;
  mensajeRegistro = '';
  formulario;

  constructor(private constructorFormulario: FormBuilder) {

    this.formulario = this.constructorFormulario.nonNullable.group({
      nombre: ['', [
        Validators.required,
        Validators.minLength(2)
      ]],

      correo: ['', [
        Validators.required,
        Validators.email,
        Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
      ]],

      contrasena: ['', [
        Validators.required,
        Validators.minLength(10),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/)
      ]],

      confirmarContrasena: ['', [
        Validators.required
      ]],

      privacidad: [false, [
        Validators.requiredTrue
      ]]
    });
  }

  cambiarVisibilidadContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  cambiarVisibilidadConfirmacion(): void {
    this.mostrarConfirmacion = !this.mostrarConfirmacion;
  }

  async registrar(): Promise<void> {
    this.enviado = true;
    this.mensajeRegistro = '';
    this.registroCompletado = false;

    if (this.registrando) {
      return;
    }

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const datos = this.formulario.getRawValue();

    if (datos.contrasena !== datos.confirmarContrasena) {
      return;
    }

    this.registrando = true;

    try {
      const { error } = await this.autenticacion.registrar(
        datos.nombre.trim(),
        datos.correo.trim(),
        datos.contrasena
      );

      if (error) {
        console.error('Error al registrar la cuenta:', error.message);
        this.mensajeRegistro =
          'No se ha podido completar el registro. Inténtalo de nuevo.';
        return;
      }

      this.registroCompletado = true;
      this.mensajeRegistro =
        'Solicitud de registro recibida. Revisa tu correo electrónico para confirmar tu cuenta.';

      this.formulario.reset();

    } catch (error) {
      console.error('Error de conexión durante el registro:', error);
      this.mensajeRegistro =
        'No se ha podido conectar con el servicio. Inténtalo de nuevo.';
    } finally {
      this.registrando = false;
    }



  }
}
